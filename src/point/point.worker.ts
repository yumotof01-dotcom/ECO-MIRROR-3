import { readPointCrop } from './worldcover.ts';
import { allConditions, baselineFor, type PointResult } from './analysis.ts';
import type { Point } from './geometry.ts';

export interface PointRequest { point: Point; endpoint: string; all: boolean }
export type PointMessage =
  | { type: 'crop'; classes: Uint8Array<ArrayBuffer>; missing: number; tiles: string[]; crs: string; sha256: string }
  | { type: 'baseline'; result: PointResult }
  | { type: 'progress'; done: number }
  | { type: 'complete'; results: PointResult[] }
  | { type: 'error'; message: string };

function send(message: PointMessage) {
  self.postMessage(message);
}

self.onmessage = async ({ data }: MessageEvent<PointRequest>) => {
  try {
    const crop = await readPointCrop(data.point, data.endpoint, AbortSignal.timeout(45000));
    send({ type: 'crop', classes: crop.classes, missing: crop.missing, tiles: crop.tiles,
      crs: crop.grid.crs, sha256: crop.grid.sourceSha256 });
    if (crop.missing) { send({ type: 'complete', results: [] }); return; }
    const baseline = baselineFor(crop.grid);
    send({ type: 'baseline', result: baseline });
    const results = data.all ? allConditions(crop.grid, done => send({ type: 'progress', done })) : [baseline];
    send({ type: 'complete', results });
  } catch {
    send({ type: 'error', message: '土地被覆データの取得または検証に失敗しました。接続を確認するか、別の範囲を選んでください。' });
  }
};
