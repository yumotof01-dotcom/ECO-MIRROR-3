import { baselineFor } from './analysis.ts';
import { CELL_METRES, SIZE } from './geometry.ts';

export const PARK_BUDGET = 3;
const vegetation = new Set([10, 20, 30, 40, 90, 95, 100]);

export function footprint(index: number) {
  return [index, index + 1, index + SIZE, index + SIZE + 1];
}

export function canPlace(classes: Uint8Array, parks: number[], index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= SIZE * (SIZE - 1) || index % SIZE === SIZE - 1) return false;
  const occupied = new Set(parks.flatMap(footprint));
  return footprint(index).every(cell => !occupied.has(cell) && [50, 60].includes(classes[cell]!));
}

export function evaluateDesign(classes: Uint8Array, parks: number[]) {
  if (classes.length !== SIZE * SIZE || parks.length > PARK_BUDGET ||
      parks.some((index, i) => !canPlace(classes, parks.slice(0, i), index))) throw new Error('配置を確認してください。');
  const additions = new Set(parks.flatMap(footprint));
  return baselineFor({
    width: SIZE, height: SIZE, resolutionMetres: CELL_METRES,
    crs: 'local-metric', datasetId: 'point-design', sourceVersion: 'WorldCover 2021 v200',
    sourceSha256: '',
    cells: Array.from(classes, (code, i) => additions.has(i) || vegetation.has(code) ? 'vegetation' :
      [50, 60, 70, 80].includes(code) ? 'other' : 'unknown')
  });
}

export function gapDistances(classes: Uint8Array) {
  const distance = new Int16Array(classes.length).fill(-1);
  const queue = new Int32Array(classes.length);
  let tail = 0;
  for (let i = 0; i < classes.length; i++) {
    if (vegetation.has(classes[i]!)) { distance[i] = 0; queue[tail++] = i; }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]!;
    const neighbours = [i % SIZE ? i - 1 : -1, i % SIZE < SIZE - 1 ? i + 1 : -1, i - SIZE, i + SIZE];
    for (const next of neighbours) {
      if (next >= 0 && next < classes.length && distance[next] === -1) {
        distance[next] = distance[i]! + 1;
        queue[tail++] = next;
      }
    }
  }
  return distance;
}
