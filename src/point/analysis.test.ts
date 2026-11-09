// @vitest-environment node
import { expect, it } from 'vitest';
import { allConditions, baselineFor } from './analysis.ts';
import { localProjection, worldCoverTile } from './geometry.ts';
import { assessLandscape } from '../features/landscape/core/landscape.ts';
import { runExhaustiveScenarios } from '../features/landscape/scenarios/engine.ts';
import type { LandscapeGrid } from '../features/landscape/core/types.ts';

it('centres the metric projection and names southern and dateline tiles', () => {
  const point = { lat: 35.738, lon: 139.599 };
  const [lon, lat] = localProjection(point).toGeographic.forward([0, 0]);
  expect(lon).toBeCloseTo(point.lon, 10);
  expect(lat).toBeCloseTo(point.lat, 10);
  expect(worldCoverTile(point.lat, point.lon)).toBe('N33E138');
  expect(worldCoverTile(-23.55, -46.63)).toBe('S24W048');
  expect(worldCoverTile(0, 179.999)).toBe('N00E177');
  expect(worldCoverTile(0, 180)).toBe('N00W180');
});

it('matches the existing PC model for every condition and refuses missing cells', () => {
  const grid: LandscapeGrid = {
    width: 3, height: 3, resolutionMetres: 10, crs: 'EPSG:6677',
    datasetId: 'test-grid', sourceVersion: 'test', sourceSha256: 'a'.repeat(64),
    cells: ['vegetation', 'other', 'vegetation', 'other', 'vegetation', 'other', 'vegetation', 'other', 'other']
  };
  const expected = runExhaustiveScenarios(grid).conditions;
  const masks = new Map<string, Uint8Array>();
  const actual = allConditions(grid, () => {}, (key, mask) => masks.set(key, mask));
  const removed = masks.get('distributed-50')!;
  const scenario = actual.find(row => row.pattern === 'distributed' && row.lossPercent === 50)!;
  expect(removed.reduce((sum, cell) => sum + cell, 0) * 100).toBe(400 - scenario.area);
  expect(removed.every((cell, index) => !cell || grid.cells[index] === 'vegetation')).toBe(true);
  expect(actual).toHaveLength(440);
  for (let index = 0; index < expected.length; index++) expect(actual[index]!.pc).toBeCloseTo(expected[index]!.pc!, 14);
  const baseline = assessLandscape(grid, 4, 200);
  expect(baseline.status).toBe('STRUCTURAL_ONLY');
  if (baseline.status === 'STRUCTURAL_ONLY') expect(baselineFor(grid).pc).toBeCloseTo(baseline.pc, 14);
  expect(() => baselineFor({ ...grid, cells: ['unknown', ...grid.cells.slice(1)] })).toThrow('欠測');
});
