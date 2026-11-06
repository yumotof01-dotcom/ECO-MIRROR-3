#!/usr/bin/env python3
"""Fetch only a Tokyo 2km crop from the public ESA WorldCover 2021 COG.

Requirements: pip install rasterio pyproj numpy
Run: python scripts/landscape/ingest_worldcover.py --out /tmp/worldcover-shinjuku.json
Public scientific source (not a mock): ESA WorldCover 2021 v200 N33E138.
No account, paid API or other user inputs. Reads COG byte ranges, not full tile.
Fails closed on missing data, failed network, invalid landcover codes or CRS.
"""
import argparse
import base64
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds, Window
from rasterio.warp import reproject
from rasterio.transform import from_origin
from pyproj import Transformer

URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/"
       "v200/2021/map/ESA_WorldCover_10m_2021_v200_N33E138_Map.tif")
# Center near Shinjuku Gyoen, Tokyo; public study area, NOT user location.
CENTER_LAT, CENTER_LON = 35.685, 139.711
CRS = "EPSG:6677"  # JGD2011 / Japan Plane Rectangular CS IX (Tokyo area).
RESOLUTION = 10
N = 200
VEGETATION = {10, 20, 30, 40, 90, 95, 100}
OTHER = {50, 60, 70, 80}
KNOWN = VEGETATION | OTHER

# Geographically distinct, publicly named test centers. No user locations.
# EPSG codes follow their area's Japanese Plane Rectangular zone.
# Default Shinjuku input/output is deliberately byte-for-byte unchanged.
STRESS_SITES = {
    "shinjuku": (35.685, 139.711, "EPSG:6677", "Tokyo Shinjuku Gyoen"),
    "osaka": (34.6873, 135.5258, "EPSG:6674", "Osaka Castle Park"),
    "nagoya": (35.185, 136.900, "EPSG:6675", "Nagoya Castle"),
    "fukuoka": (33.5882, 130.376, "EPSG:6670", "Fukuoka Ohori Park"),
    "sapporo": (43.053, 141.315, "EPSG:6680", "Sapporo Maruyama Park"),
    "odaiba": (35.629, 139.778, "EPSG:6677", "Tokyo Bay Odaiba"),
}

def tile_url(lat, lon):
    # Official WorldCover 3° x 3° tile naming uses SOUTH-WEST corner.
    south = math.floor(lat / 3) * 3
    west = math.floor(lon / 3) * 3
    if south < 0 or west < 0:
        raise ValueError("Only predefined northern/eastern Japanese sites are supported")
    return (
        "https://esa-worldcover.s3.eu-central-1.amazonaws.com/"
        "v200/2021/map/ESA_WorldCover_10m_2021_v200_"
        f"N{south:02d}E{west:03d}_Map.tif"
    )

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/eco-worldcover-shinjuku.json")
    ap.add_argument("--site", choices=sorted(STRESS_SITES), default="shinjuku",
                    help="An explicitly defined public study area, not the user's address")
    ap.add_argument("--size-cells", type=int, default=200,
                    help="100-400 cells per side at 10m; used for scaling audits")
    ap.add_argument("--emit-compressed-stdout", action="store_true",
                    help="Emit an audit-friendly gzip+base64 record to CI logs")
    args = ap.parse_args()
    if not 100 <= args.size_cells <= 400 or args.size_cells % 2:
        raise ValueError("size-cells must be even and between 100 and 400")
    center_lat, center_lon, site_crs, site_label = STRESS_SITES[args.site]
    source_url = tile_url(center_lat, center_lon)
    size = args.size_cells
    side_m = size * RESOLUTION
    half_m = side_m / 2

    to_metric = Transformer.from_crs("EPSG:4326", site_crs, always_xy=True)
    to_geo = Transformer.from_crs(site_crs, "EPSG:4326", always_xy=True)
    cx, cy = to_metric.transform(center_lon, center_lat)
    left, top = cx - half_m, cy + half_m
    transform = from_origin(left, top, RESOLUTION, RESOLUTION)
    corners = [(left, top), (left + side_m, top), (left + side_m, top - side_m), (left, top - side_m)]
    coord = [to_geo.transform(x, y) for x, y in corners]
    w, e = min(p[0] for p in coord), max(p[0] for p in coord)
    s, n = min(p[1] for p in coord), max(p[1] for p in coord)

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(source_url) as src:
            if src.crs is None or src.count < 1:
                raise ValueError("Source COG CRS/band missing")
            if not src.crs.to_epsg() == 4326:
                raise ValueError("Unexpected source CRS")
            window = from_bounds(w, s, e, n, transform=src.transform)
            # Reprojection needs a halo: bounding only four target corners and
            # rounding the source window clipped 44 target edge pixels in CI.
            # Eight input pixels of padding are loaded, then destination nodata
            # is still checked strictly instead of silently zero-filled.
            window = Window(window.col_off - 8, window.row_off - 8,
                            window.width + 16, window.height + 16)
            window = window.round_offsets().round_lengths()
            clipped = src.read(1, window=window, boundless=False)
            if clipped.size == 0:
                raise ValueError("Empty source window; incorrect tile")
            source_transform = src.window_transform(window)
            values = np.full((size, size), 255, dtype=np.uint8)
            reproject(source=clipped, destination=values,
                      src_transform=source_transform, src_crs=src.crs,
                      dst_transform=transform, dst_crs=site_crs,
                      src_nodata=0, dst_nodata=255,
                      resampling=Resampling.nearest)

    unique, counts = np.unique(values, return_counts=True)
    dist = {str(int(v)): int(c) for v,c in zip(unique,counts)}
    unexpected = [int(v) for v in unique if int(v) not in KNOWN]
    if unexpected:
        raise ValueError("Missing/unknown classes, refusing analysis: " + str(unexpected) + " distribution="+str(dist))
    chars = np.full(values.shape, "O", dtype="U1")
    for k in VEGETATION:
        chars[values == k] = "V"
    rows = ["".join(row.tolist()) for row in chars]
    canonical = "".join(rows).encode("ascii")
    raw_class_hash = hashlib.sha256(values.tobytes(order="C")).hexdigest()
    compact_hash = hashlib.sha256(canonical).hexdigest()
    canonical_id = (
        "esa-worldcover-2021-v200-N33E138-shinjuku-2km"
        if args.site == "shinjuku" and size == 200
        else f"esa-worldcover-2021-v200-{args.site}-{side_m}m"
    )
    canonical_title = (
        "Tokyo Shinjuku Gyoen vicinity, 2km square; 2021 ESA WorldCover class inference"
        if args.site == "shinjuku" and size == 200
        else f"{site_label} vicinity, {side_m}m square; 2021 ESA WorldCover classification"
    )
    result = {
        "schema_version": "worldcover-cropped-grid-v1",
        "dataset_id": canonical_id,
        "title": canonical_title,
        "publisher": "ESA WorldCover consortium",
        "source_url": source_url,
        "source_product": "ESA WorldCover 10m 2021 v200",
        "source_doi": "10.5281/zenodo.7254221",
        "license": "CC BY 4.0",
        "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
        "source_full_tile_sha256": None,
        "source_full_tile_sha256_reason": "Only a COG window was read; full source tile was not downloaded or hashed.",
        "derived_pixel_class_sha256": raw_class_hash,
        "derived_binary_mask_sha256": compact_hash,
        "crs": site_crs,
        "source_crs": "EPSG:4326",
        "resolution_metres": RESOLUTION,
        "width": size, "height": size,
        "center_lon_lat": [center_lon, center_lat],
        "projected_northwest_metres": [round(left,4),round(top,4)],
        "source_class_histogram": dist,
        "source_class_codes_b64": base64.b64encode(values.tobytes(order="C")).decode("ascii"),
        "class_mapping": {
            "vegetation": sorted(VEGETATION),
            "other": sorted(OTHER),
            "unknown_handling": "error instead of interpreting missing as non-vegetation"
        },
        "geometry_limitations": (
            "Fixed 2km window, no external movement buffer; edge effects unmeasured."
            if size == 200 else
            f"Fixed {side_m}m window, no external movement buffer; edge effects unmeasured."
        ),
        "ecological_limitations": "Land cover is not measured bee habitat, food, dispersal or breeding.",
        "rows": rows,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n",encoding="utf-8")
    print("WORLD_COVER_SUCCESS="+json.dumps({
        "source_url":source_url,"pixel_hash":raw_class_hash,"mask_hash":compact_hash,"distribution":dist,
        "width":size,"height":size,"crs":site_crs,"file":str(out)
    },sort_keys=True))
    if args.emit_compressed_stdout:
        compressed = gzip.compress(out.read_bytes(),compresslevel=9,mtime=0)
        print("GRID_RESULT_GZIP_B64="+base64.b64encode(compressed).decode("ascii"))

if __name__ == "__main__":
    main()
