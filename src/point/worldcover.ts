import { fromUrl } from 'geotiff';
import { CELL_METRES, HALF, SIZE, localProjection, worldCoverTile, wrapLongitude, type Point } from './geometry.ts';
import type { LandscapeGrid } from '../features/landscape/core/types.ts';

const VEGETATION = new Set([10, 20, 30, 40, 90, 95, 100]);
const OTHER = new Set([50, 60, 70, 80]);
const SOURCE_VERSION = 'ESA WorldCover 2021 v200';
const SOURCE_ROOT = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/';

export interface PointCrop {
  grid: LandscapeGrid;
  classes: Uint8Array<ArrayBuffer>;
  tiles: string[];
  missing: number;
}

export async function readPointCrop(point: Point, endpoint: string, signal?: AbortSignal): Promise<PointCrop> {
  const { definition, toGeographic } = localProjection(point);
  const samples = new Map<string, { index: number; lon: number; lat: number }[]>();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [longitude, lat] = toGeographic.forward([(x + 0.5) * CELL_METRES - HALF, HALF - (y + 0.5) * CELL_METRES]);
      if (lat > 82.75 || lat <= -60) continue;
      const lon = wrapLongitude(longitude);
      const tile = worldCoverTile(lat, lon);
      const group = samples.get(tile) ?? [];
      group.push({ index: y * SIZE + x, lon, lat });
      samples.set(tile, group);
    }
  }

  const classes = new Uint8Array(SIZE * SIZE);
  const tiles: string[] = [];
  for (const [tile, group] of samples) {
    signal?.throwIfAborted();
    const url = new URL(endpoint);
    url.searchParams.set('tile', tile);
    const options = { allowFullFile: false, blockSize: 65536, cacheSize: 16 };
    const file = await fromUrl(url.href, options, signal);
    try {
      const image = await file.getImage();
      const keys = image.getGeoKeys();
      const [west, north] = image.getOrigin();
      const [stepX, stepY] = image.getResolution();
      if (keys?.GeographicTypeGeoKey !== 4326 || !(stepX > 0 && stepY < 0)) {
        throw new Error('土地被覆データの座標情報を検証できません。');
      }
      const pixels = group.map(sample => ({
        index: sample.index,
        x: Math.floor((sample.lon - west) / stepX),
        y: Math.floor((sample.lat - north) / stepY)
      })).filter(({ x, y }) => x >= 0 && y >= 0 && x < image.getWidth() && y < image.getHeight());
      if (!pixels.length) continue;
      const left = Math.min(...pixels.map(p => p.x));
      const top = Math.min(...pixels.map(p => p.y));
      const right = Math.max(...pixels.map(p => p.x)) + 1;
      const bottom = Math.max(...pixels.map(p => p.y)) + 1;
      if ((right - left) * (bottom - top) > 2_000_000) throw new Error('読み出し範囲が大きすぎます。');
      const data = await image.readRasters({ samples: [0], window: [left, top, right, bottom], interleave: true, signal });
      for (const { index, x, y } of pixels) classes[index] = data[(y - top) * (right - left) + x - left]!;
      tiles.push(SOURCE_ROOT + `ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`);
    } finally {
      await file.close();
    }
  }
  const cells = Array.from(classes, value => VEGETATION.has(value) ? 'vegetation' as const :
    OTHER.has(value) ? 'other' as const : 'unknown' as const);
  const missing = cells.filter(cell => cell === 'unknown').length;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', classes));
  return {
    grid: {
      width: SIZE, height: SIZE, resolutionMetres: CELL_METRES, crs: definition,
      datasetId: `worldcover-v200-point-${point.lat},${point.lon}`, sourceVersion: SOURCE_VERSION,
      sourceSha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join(''), cells
    },
    classes, tiles, missing
  };
}
