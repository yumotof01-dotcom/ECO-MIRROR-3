import { expect, it } from 'vitest';
import { canPlace, evaluateDesign, footprint, gapDistances } from './design.ts';
import { SIZE } from './geometry.ts';

it('enforces footprint, land class, overlap and budget, and adds exactly 400 square metres', () => {
  const classes = new Uint8Array(SIZE * SIZE).fill(50);
  classes[0] = 10;
  expect(canPlace(classes, [], 0)).toBe(false);
  expect(canPlace(classes, [], SIZE - 1)).toBe(false);
  expect(canPlace(classes, [10], 11)).toBe(false);
  expect(footprint(10)).toEqual([10, 11, SIZE + 10, SIZE + 11]);
  expect(evaluateDesign(classes, [10]).area - evaluateDesign(classes, []).area).toBe(400);
  expect(() => evaluateDesign(classes, [10, 20, 30, 40])).toThrow();
});

it('counts horizontal and vertical steps without wrapping rows', () => {
  const classes = new Uint8Array(SIZE * SIZE).fill(50);
  expect(gapDistances(classes)[10]).toBe(-1);
  classes[0] = 10;
  const distance = gapDistances(classes);
  expect(distance[SIZE + 2]).toBe(3);
  expect(distance[SIZE - 1]).toBe(SIZE - 1);
});
