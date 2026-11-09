import { readPointCrop } from './worldcover.ts';
import { allConditions, baselineFor, type PointResult } from './analysis.ts';
import type { Point } from './geometry.ts';

export interface PointRequest { point: Point; endpoint: string; all: boolean }
export type PointMessage =
  | { type: 'crop'; classes: Uint8Array<ArrayBuffer>; missing: number; tiles: string[]; crs: string; sha256: string }
  | { type: 'baseline'; result: PointResult }
  | { type: 'progress'; done: number }
  | { type: 'complete'; results: PointResult[]; masks?: Record<string, Uint8Array> }
  | { type: 'error'; message: string };

function send(message: PointMessage) {
  self.postMessage(message);
}

self.onmessage = async ({ data }: MessageEvent<PointRequest>) => {
  const signal = AbortSignal.timeout(45000);
  try {
    const crop = await readPointCrop(data.point, data.endpoint, signal);
    send({ type: 'crop', classes: crop.classes, missing: crop.missing, tiles: crop.tiles,
      crs: crop.grid.crs, sha256: crop.grid.sourceSha256 });
    if (crop.missing) { send({ type: 'complete', results: [] }); return; }
    const baseline = baselineFor(crop.grid);
    send({ type: 'baseline', result: baseline });
    const masks: Record<string, Uint8Array> = {};
    const results = data.all ? allConditions(crop.grid, done => send({ type: 'progress', done }),
      (key, mask) => { masks[key] = mask; }) : [baseline];
    send({ type: 'complete', results, masks });
  } catch {
    send({ type: 'error', message: signal.aborted
      ? 'データの取得が時間内に終わりませんでした。接続を確認して、もう一度お試しください。'
      : 'この範囲の土地被覆データを取得・確認できませんでした。接続を確認し、続く場合は別の範囲を選んでください。' });
  }
};
