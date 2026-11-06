import type { LandscapeGrid } from "../core/types.ts";

/** Serializable, independently reproducible crop from an ESA WorldCover COG. */
export interface VerifiedWorldcoverWindow {
  readonly schema_version: "worldcover-cropped-grid-v1";
  readonly dataset_id: string;
  readonly source_product: "ESA WorldCover 10m 2021 v200";
  readonly source_url: string;
  readonly derived_binary_mask_sha256: string;
  /** Hash of derived classified source pixel bytes, not entire source COG. */
  readonly derived_pixel_class_sha256: string;
  readonly source_full_tile_sha256: string | null;
  readonly license: string;
  readonly attribution: string;
  readonly crs: string;
  readonly resolution_metres: number;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
}
const SHA=/^[0-9a-f]{64}$/;
const COG_URL=/^https:\/\/esa-worldcover\.s3\.eu-central-1\.amazonaws\.com\/v200\/2021\/map\/ESA_WorldCover_10m_2021_v200_[NS][0-9]{2}[EW][0-9]{3}_Map\.tif$/;
function fail(message: string): never { throw new RangeError("INVALID_WORLDCOVER_WINDOW: "+message); }

export async function verifyWorldcoverWindow(value: VerifiedWorldcoverWindow): Promise<LandscapeGrid> {
  if (!value || value.schema_version !== "worldcover-cropped-grid-v1" ||
    !value.dataset_id?.trim() || value.source_product !== "ESA WorldCover 10m 2021 v200" ||
    !COG_URL.test(value.source_url) || !value.attribution?.includes("ESA WorldCover") ||
    value.license !== "CC BY 4.0" || !SHA.test(value.derived_binary_mask_sha256) ||
    !SHA.test(value.derived_pixel_class_sha256) || value.source_full_tile_sha256 !== null) {
    fail("provenance or source product did not match the declared ESA crop schema");
  }
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) ||
    value.width < 1 || value.height < 1 || !Number.isFinite(value.resolution_metres) ||
    value.resolution_metres <= 0 || !Array.isArray(value.rows) ||
    value.rows.length !== value.height || value.width*value.height > 1_000_000) {
    fail("invalid dimensions or resolution");
  }
  for (const row of value.rows) {
    if (typeof row !== "string" || row.length !== value.width || /[^VO?]/.test(row)) {
      fail("unknown/missing row code or inconsistent row length");
    }
  }
  if (value.rows.some(row=>row.includes("?"))) fail("no-data cannot be treated as non-vegetation");
  if (typeof crypto === "undefined" || !crypto.subtle) fail("SHA-256 Web Crypto is required");
  const bytes = new TextEncoder().encode(value.rows.join(""));
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
    .map(b=>b.toString(16).padStart(2,"0")).join("");
  if (sha !== value.derived_binary_mask_sha256) fail("derived vegetation mask was modified");
  return {
    width:value.width, height:value.height, resolutionMetres:value.resolution_metres,
    crs:value.crs, datasetId:value.dataset_id, sourceVersion:value.source_product,
    // Deliberately source window's derived pixel SHA, never the unavailable full-tile hash.
    sourceSha256:value.derived_pixel_class_sha256,
    cells: Array.from(value.rows.join(""),c=>c==="V"?"vegetation":"other")
  };
}
