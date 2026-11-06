import { enumerateConditions, LAMBDA_METRES, LOSS_PERCENT, NEIGHBOURHOODS, PATTERNS } from '../features/landscape/scenarios/engine.ts';
import type { ScenarioSettings } from '../features/landscape/scenarios/engine.ts';

/** The frozen 440-condition experiment. No interpolation or nearest-condition fallback. */
export const CONDITION_AXES = Object.freeze({
  lambdaMetres: Object.freeze([...LAMBDA_METRES]), lossPercent: Object.freeze([...LOSS_PERCENT]),
  neighbourhood: Object.freeze([...NEIGHBOURHOODS]), pattern: Object.freeze([...PATTERNS])
});
export function conditionId(s: ScenarioSettings): string {
  if (!s || !PATTERNS.includes(s.pattern) || !NEIGHBOURHOODS.includes(s.neighbourhood) ||
      !(LAMBDA_METRES as readonly number[]).includes(s.lambdaMetres) ||
      !(LOSS_PERCENT as readonly number[]).includes(s.lossPercent)) {
    throw new RangeError('Unsupported condition in the frozen 440-condition experiment');
  }
  return `${s.pattern}-n${s.neighbourhood}-lambda${s.lambdaMetres}-loss${s.lossPercent}`;
}
export const CONDITIONS = Object.freeze(enumerateConditions().map(s => Object.freeze({ ...s, scenarioId: conditionId(s) })));
const BY_ID = new Map(CONDITIONS.map(s => [s.scenarioId, s]));
export function resolveCondition(id: string) {
  const value = BY_ID.get(id);
  if (!value) throw new RangeError('Unknown research condition: ' + id);
  return value;
}
export function sameCondition(a: ScenarioSettings, b: ScenarioSettings): boolean {
  return conditionId(a) === conditionId(b);
}
