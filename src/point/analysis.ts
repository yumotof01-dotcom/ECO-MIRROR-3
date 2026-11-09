import { extractPatches } from '../features/landscape/core/landscape.ts';
import type { LandscapeGrid } from '../features/landscape/core/types.ts';
import { buildScenarioGridCache, LAMBDA_METRES, type ScenarioSettings } from '../features/landscape/scenarios/engine.ts';
import { CONDITIONS } from '../research/conditions.ts';

export const BASELINE: ScenarioSettings = { pattern: 'distributed', lossPercent: 0, neighbourhood: 4, lambdaMetres: 200 };
export type PointResult = ScenarioSettings & { pc: number; area: number; patches: number };

export function measure(grid: LandscapeGrid, neighbourhood: ScenarioSettings['neighbourhood'], lambdas: readonly number[]) {
  if (grid.cells.includes('unknown')) throw new Error('欠測を含む範囲のPCは算出しません。');
  const patches = extractPatches(grid, neighbourhood);
  const area = patches.reduce((sum, patch) => sum + patch.areaM2, 0);
  const denominator = (grid.cells.length * grid.resolutionMetres ** 2) ** 2;
  const diagonal = patches.reduce((sum, patch) => sum + patch.areaM2 ** 2, 0);
  const sums = lambdas.map(() => diagonal);
  for (let i = 0; i < patches.length; i++) {
    const a = patches[i]!;
    for (let j = i + 1; j < patches.length; j++) {
      const b = patches[j]!;
      const distance = Math.hypot(a.centroidXMetres - b.centroidXMetres, a.centroidYMetres - b.centroidYMetres);
      const weight = 2 * a.areaM2 * b.areaM2;
      for (let k = 0; k < lambdas.length; k++) sums[k]! += weight * Math.exp(-distance / lambdas[k]!);
    }
  }
  return { area, patches: patches.length, values: sums.map(sum => Math.min(1, sum / denominator)) };
}

export function baselineFor(grid: LandscapeGrid): PointResult {
  const result = measure(grid, BASELINE.neighbourhood, [BASELINE.lambdaMetres]);
  return { ...BASELINE, pc: result.values[0]!, area: result.area, patches: result.patches };
}

export function allConditions(grid: LandscapeGrid, report: (done: number) => void, onMask?: (key: string, mask: Uint8Array) => void): PointResult[] {
  // Rank removals once using the same rules as the fixed research data.
  const grids = buildScenarioGridCache(grid);
  if (onMask) {
    for (const [key, scenario] of grids) {
      if (key.endsWith('-0')) continue;
      onMask(key, Uint8Array.from(scenario.cells, (cell, index) => Number(cell === 'other' && grid.cells[index] === 'vegetation')));
    }
  }
  const results: PointResult[] = [];
  const measurements = new Map<string, ReturnType<typeof measure>>();
  for (const condition of CONDITIONS) {
    // At 0%, both removal patterns produce the identical raster.
    const raster = `${condition.lossPercent === 0 ? 'distributed' : condition.pattern}-${condition.lossPercent}`;
    const key = `${raster}-${condition.neighbourhood}`;
    let result = measurements.get(key);
    if (!result) {
      result = measure(grids.get(raster)!, condition.neighbourhood, LAMBDA_METRES);
      measurements.set(key, result);
      report(measurements.size);
    }
    const lambdaIndex = LAMBDA_METRES.findIndex(value => value === condition.lambdaMetres);
    results.push({ ...condition, pc: result.values[lambdaIndex]!, area: result.area, patches: result.patches });
  }
  return results;
}

