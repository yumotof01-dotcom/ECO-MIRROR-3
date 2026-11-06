import type { VerifiedStudyRegion, VerifiedSiteResults } from '../studies/verifiedStudyLoader.ts';
import type { InterventionResult, InterventionSummary } from '../features/landscape/bridges/engine.ts';
import { detectModelChangeIntervals } from '../features/landscape/thresholds/detect.ts';
import { conditionId, resolveCondition } from './conditions.ts';

export function requireStudy(value: unknown, detail: string): asserts value {
  if (!value) throw new RangeError('INVALID_RESEARCH_STUDY: ' + detail);
}
export const VEGETATION_CODES = [10,20,30,40,90,95,100] as const;
export const OTHER_CODES = [50,60,70,80] as const;
export function isVegetated(code: number): boolean { return (VEGETATION_CODES as readonly number[]).includes(code); }
export function originalClasses(study: VerifiedStudyRegion): Uint8Array {
  const bytes = Uint8Array.from(atob(study.source.source_class_codes_b64), c => c.charCodeAt(0));
  requireStudy(bytes.length === study.grid.cells.length, 'original classification length');
  return bytes;
}
/** Compare JSON objects by meaning, independent of property order. Exact numeric equality is intentional. */
export function equivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length && a.every((v,i) => equivalent(v,b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aa = a as Record<string,unknown>, bb = b as Record<string,unknown>;
    const keys = Object.keys(aa);
    return keys.length === Object.keys(bb).length && keys.every(k => Object.hasOwn(bb,k) && equivalent(aa[k],bb[k]));
  }
  return false;
}
export function validateStudy(study: VerifiedStudyRegion): void {
  const {grid, baseline, bridges, index, source} = study;
  const geo = source as unknown as Record<string,unknown>;
  requireStudy(study.regionId===index.regionId && grid.datasetId===index.datasetId && source.dataset_id===index.datasetId &&
    grid.crs===index.crs && grid.sourceSha256===index.derivedPixelClassSha256 &&
    source.derived_binary_mask_sha256===index.derivedVegetationMaskSha256 &&
    baseline.source_dataset_id===index.datasetId && baseline.derived_pixel_class_sha256===index.derivedPixelClassSha256 &&
    baseline.ecological_validation==='not_validated'&&baseline.actual_future_probabilities===false &&
    study.scientificStatus==='structural_only_not_field_validated','region/source/scientific identity');
  requireStudy(grid.resolutionMetres === 10 && grid.width === 200 && grid.height === 200, 'fixed 2km/10m geometry');
  requireStudy(Array.isArray(geo.projected_northwest_metres) && geo.projected_northwest_metres.length === 2 &&
    geo.projected_northwest_metres.every(Number.isFinite) && geo.source_crs === 'EPSG:4326', 'projected georeference');
  requireStudy(geo.source_doi === '10.5281/zenodo.7254221', 'source DOI');
  const classes = originalClasses(study);
  let vegetationCells = 0;
  const histogram: Record<string,number> = {};
  for (let i=0;i<classes.length;i++) {
    const code=classes[i]!;
    requireStudy(isVegetated(code) || (OTHER_CODES as readonly number[]).includes(code), 'unknown original class');
    requireStudy(grid.cells[i] === (isVegetated(code) ? 'vegetation' : 'other'), 'original classes disagree with mask');
    if (isVegetated(code)) vegetationCells++;
    histogram[code]=(histogram[code]??0)+1;
  }
  requireStudy(equivalent(histogram,geo.source_class_histogram), 'original class histogram');
  const e=baseline.ensemble;
  requireStudy(e.schemaVersion === 'landscape-scenarios-v1' && e.sourceId === index.datasetId &&
    e.sourceSha256 === index.derivedPixelClassSha256 && e.status==='complete' && e.expectedCount===440 &&
    e.calculatedCount===440 && e.conditions.length===440 && new Set(e.conditions.map(c=>c.scenarioId)).size===440 &&
    e.scientificMeaning==='hypothetical_stress_tests_not_forecast_probabilities', 'ensemble provenance/completeness');
  for (const row of e.conditions) {
    const setting=resolveCondition(row.scenarioId);
    requireStudy(conditionId(row) === setting.scenarioId, 'scenario ID and settings disagree');
    requireStudy(row.status==='STRUCTURAL_ONLY'&&row.pc!==null&&Number.isFinite(row.pc)&&row.pc>=0&&row.pc<=1,'scenario PC');
    const removed=Math.round(vegetationCells*setting.lossPercent/100);
    requireStudy(row.vegetationAreaM2 === (vegetationCells-removed)*100 && row.errorReason === null &&
      row.actualLossPercent === (vegetationCells ? 100*removed/vegetationCells : null), 'scenario area or actual loss');
  }
  requireStudy(equivalent(detectModelChangeIntervals(e),baseline.thresholds), '40 diagnostics disagree with baseline');
  const meta=bridges.modelMetadata;
  requireStudy(meta.schemaVersion === 'landscape-interventions-v1' && meta.status === 'complete' &&
    meta.landcoverTimeReference === 'ESA WorldCover 2021' &&
    meta.modelValidation === 'not_validated_for_real_species_or_intervention' &&
    meta.selectedConnectorFootprintsCount === 12 && meta.selectedReferenceFootprintsCount === 4,
    'intervention scientific metadata');
  const baselineResource=index.resources.find(r => r.kind === 'baseline');
  requireStudy(bridges.reportMetadata.original_baseline_report_sha256 === baselineResource?.sha256 &&
    bridges.reportMetadata.derived_land_cover_class_sha256 === index.derivedPixelClassSha256 &&
    bridges.reportMetadata.derived_crop_mask_sha256 === index.derivedVegetationMaskSha256 &&
    bridges.reportMetadata.permissions_construction_feasibility === 'not_assessed', 'intervention report provenance');
  for (const entry of bridges.evaluated) {
    const s=entry.site;
    requireStudy(Number.isSafeInteger(s.x) && Number.isSafeInteger(s.y) && s.x>=8 && s.y>=8 &&
      s.x<=190 && s.y<=190 && s.x%2===0 && s.y%2===0, '2x2 footprint bounds');
    const expected=[s.y*grid.width+s.x,s.y*grid.width+s.x+1,(s.y+1)*grid.width+s.x,(s.y+1)*grid.width+s.x+1];
    requireStudy(equivalent(s.cells,expected) && s.addedAreaM2===400 && s.sourceClasses.length===4 &&
      s.sourceClasses.every((c,i) => (c===50||c===60) && classes[expected[i]!]===c), 'footprint original classes');
    requireStudy(['hypothetical_connector','equal_area_reference'].includes(s.role) &&
      s.id===`${s.role==='hypothetical_connector'?'connector':'reference'}-x${s.x}-y${s.y}` &&
      s.disclaimer==='hypothetical_land_cover_conversion_only', 'site identity');
    requireStudy([s.adjacentPatchCount4,s.adjacentPatchCount8,s.nearbyPatchCount].every(v => Number.isSafeInteger(v)&&v>=0) &&
      Number.isFinite(s.selectionScore) && (s.nearestSecondPatchDistanceM===null ||
        Number.isFinite(s.nearestSecondPatchDistanceM)&&s.nearestSecondPatchDistanceM>=0), 'site counts/distance');
    const both=s.adjacentPatchCount4>=2&&s.adjacentPatchCount8>=2;
    requireStudy(s.topologicalEffect === (both?'joins_patches_in_both':s.adjacentPatchCount4>=2?
      'joins_patches_in_4_only':s.adjacentPatchCount8>=2?'joins_patches_in_8_only':'no_direct_patch_join'), 'source topology label');
    validateSummary(entry.summary);
  }
  const ranked=bridges.evaluated.filter(s => s.site.role==='hypothetical_connector').sort((a,b) =>
    b.summary.lowerDecileDeltaPc-a.summary.lowerDecileDeltaPc || b.summary.medianDeltaPc-a.summary.medianDeltaPc || a.site.id.localeCompare(b.site.id));
  requireStudy(ranked.length===12 && bridges.evaluated.filter(s=>s.site.role==='equal_area_reference').length===4 &&
    equivalent(meta.rankedConnectorIds,ranked.map(s=>s.site.id)) &&
    equivalent(meta.rankedDirectBridgeIds,ranked.filter(s=>s.site.topologicalEffect==='joins_patches_in_both').map(s=>s.site.id)), 'shortlist ranking');
}
function validateSummary(s: InterventionSummary): void {
  requireStudy([s.minimumDeltaPc,s.lowerDecileDeltaPc,s.medianDeltaPc,s.maximumDeltaPc].every(Number.isFinite) &&
    s.minimumDeltaPc<=s.lowerDecileDeltaPc && s.lowerDecileDeltaPc<=s.medianDeltaPc && s.medianDeltaPc<=s.maximumDeltaPc,
    'summary quantiles');
  const counts=[s.positiveConditions,s.negativeConditions,s.zeroConditions,s.scenariosWithPatchMerger,
    s.scenariosWithoutPatchCountChange,s.scenariosCreatingNewIsland];
  requireStudy(s.count===440 && counts.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=440) &&
    counts.slice(0,3).reduce((a,b)=>a+b,0)===440 && counts.slice(3).reduce((a,b)=>a+b,0)===440, 'summary counts');
  requireStudy(s.assessment === (s.positiveConditions===440 ? 'POSITIVE_UNDER_ALL_DEFINED_CONDITIONS' :
    'MIXED_OR_NONPOSITIVE_MODEL_EFFECT'), 'summary interpretation');
}
export function summarizeInterventions(rows: readonly InterventionResult[]): InterventionSummary {
  requireStudy(rows.length===440, '440 intervention results required');
  const deltas=rows.map(r=>r.deltaPc).sort((a,b)=>a-b);
  const q=(v:number) => { const i=(deltas.length-1)*v, lo=Math.floor(i),hi=Math.ceil(i);return deltas[lo]!+(deltas[hi]!-deltas[lo]!)*(i-lo); };
  const pos=deltas.filter(d=>d>1e-12).length, neg=deltas.filter(d=>d< -1e-12).length;
  return {count:440, minimumDeltaPc:deltas[0]!,lowerDecileDeltaPc:q(.1),medianDeltaPc:q(.5),maximumDeltaPc:deltas.at(-1)!,
    positiveConditions:pos,negativeConditions:neg,zeroConditions:440-pos-neg,
    scenariosWithPatchMerger:rows.filter(r=>r.afterPatchCount<r.beforePatchCount).length,
    scenariosWithoutPatchCountChange:rows.filter(r=>r.afterPatchCount===r.beforePatchCount).length,
    scenariosCreatingNewIsland:rows.filter(r=>r.afterPatchCount>r.beforePatchCount).length,
    assessment:pos===440?'POSITIVE_UNDER_ALL_DEFINED_CONDITIONS':'MIXED_OR_NONPOSITIVE_MODEL_EFFECT'};
}
export function validateSite(study: VerifiedStudyRegion, site: VerifiedSiteResults): void {
  const entry=study.bridges.evaluated.find(e=>e.site.id===site.siteId);
  requireStudy(entry && site.sourceDatasetId===study.index.datasetId && site.scientificStatus==='hypothetical_conversion_only', 'site region binding');
  const seen=new Set<string>();
  const baseline=new Map(study.baseline.ensemble.conditions.map(r=>[r.scenarioId,r]));
  const topology=new Map<string,{before:number;after:number}>();
  for (const r of site.results) {
    const setting=resolveCondition(r.scenarioId),before=baseline.get(r.scenarioId);
    const key=`${setting.pattern}-${setting.neighbourhood}-${setting.lossPercent}`;
    const counts=topology.get(key);
    requireStudy(!seen.has(r.scenarioId)&&before&&r.beforePc===before.pc&&r.beforeVegetationAreaM2===before.vegetationAreaM2 &&
      Number.isFinite(r.deltaPc)&&Math.abs(r.afterPc-r.beforePc-r.deltaPc)<=1e-12 &&
      r.afterVegetationAreaM2-r.beforeVegetationAreaM2===400 &&
      Number.isInteger(r.beforePatchCount)&&Number.isInteger(r.afterPatchCount)&&r.beforePatchCount>=0&&r.afterPatchCount>=0&&
      r.patchesJoined===Math.max(0,r.beforePatchCount-r.afterPatchCount), 'site baseline/delta/area binding');
    requireStudy(!counts || counts.before===r.beforePatchCount&&counts.after===r.afterPatchCount,'topology must not depend on lambda');
    topology.set(key,{before:r.beforePatchCount,after:r.afterPatchCount});seen.add(r.scenarioId);
    requireStudy(Number.isFinite(r.afterPc)&&r.beforePc>=0&&r.beforePc<=1&&r.afterPc>=0&&r.afterPc<=1 &&
      r.beforePatchCount<=r.beforeVegetationAreaM2/100 && r.afterPatchCount<=r.afterVegetationAreaM2/100,
      'intervention PC/count bounds');
  }
  requireStudy(equivalent(entry.summary,summarizeInterventions(site.results)), 'site summary differs from all 440 results');
}
