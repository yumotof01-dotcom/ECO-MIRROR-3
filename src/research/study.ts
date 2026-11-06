import { loadVerifiedStudyRegion, loadVerifiedInterventionSite, StudyIntegrityError } from '../studies/verifiedStudyLoader.ts';
import type { RegionId, StudyLoadOptions, VerifiedStudyRegion, VerifiedSiteResults } from '../studies/verifiedStudyLoader.ts';
import type { ScenarioSettings } from '../features/landscape/scenarios/engine.ts';
import type { CurveDiagnostic } from '../features/landscape/thresholds/detect.ts';
import { CONDITIONS, conditionId, resolveCondition } from './conditions.ts';
import { validateStudy, validateSite, requireStudy } from './validation.ts';

/** Pinned independently of network JSON; updating a dataset is an explicit code review. */
export const STUDY_RELEASE = Object.freeze({
  id: 'worldcover-2021-v200-six-region-v1',
  manifestSha256: 'cddd22e498612611be888a691b5ee5ab637cfcf56539522fec3bb051912c57b5',
  researchCommit: '9a7fa63bc83f350c80ddf775124cd3cbeb6c112e',
  year: 2021, model: 'centroid-distance-exponential-v1', license: 'CC BY 4.0',
  doi: '10.5281/zenodo.7254221', fieldValidation: 'not_performed',
  selectionScope: 'twelve_connectors_and_four_references_per_region_not_all_locations'
} as const);
export const RESEARCH_CAVEATS = Object.freeze([
  '2021年の土地被覆分類。2026年の現況ではありません。',
  'PCは植生候補とパッチ重心距離による構造モデルの指標です。生物の実移動・送粉を実証していません。',
  '440条件は仮定を変えた感度分析です。未来の確率ではありません。',
  '急変区間はモデル診断です。生態系崩壊や絶滅の閾値ではありません。',
  '400㎡の追加は仮想操作です。土地の権利、施工可能性、保全効果は未検証です。',
  '順位は選定した12候補内の比較です。全土地からの推薦ではありません。',
  '2km四方の範囲外バッファがなく、境界の影響は未評価です。'
]);
function freeze<T>(value:T):T {
  if(value && typeof value==='object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for(const child of Object.values(value))freeze(child);
  }
  return value;
}
export function throwIfCancelled(signal?:AbortSignal):void {
  if(signal?.aborted)throw new DOMException('Research request cancelled','AbortError');
}
/** No ambient cache: one immutable model belongs to one verified region/release. */
export class ResearchStudy {
  readonly data:VerifiedStudyRegion;
  private readonly rows;
  private readonly validatedSites=new WeakSet<VerifiedSiteResults>();
  private constructor(data:VerifiedStudyRegion) {
    validateStudy(data);
    // Own the object graph; callers cannot corrupt another consumer through a shared reference.
    this.data=freeze(structuredClone(data));
    this.rows=new Map(this.data.baseline.ensemble.conditions.map(r=>[r.scenarioId,r]));
    Object.freeze(this);
  }
  /** Caller must use the verified loader; this also checks cross-file semantics. */
  static fromVerified(data:VerifiedStudyRegion):ResearchStudy { return new ResearchStudy(data); }
  get provenance() {
    return Object.freeze({release:STUDY_RELEASE,regionId:this.data.regionId,datasetId:this.data.index.datasetId,
      classSha256:this.data.index.derivedPixelClassSha256,maskSha256:this.data.index.derivedVegetationMaskSha256,
      crs:this.data.grid.crs,sourceUrl:this.data.source.source_url,attribution:this.data.source.attribution,
      caveats:RESEARCH_CAVEATS});
  }
  condition(selection:ScenarioSettings|string) {
    const id=typeof selection==='string'?resolveCondition(selection).scenarioId:conditionId(selection);
    const record=this.rows.get(id);
    requireStudy(record, 'missing condition');
    return record;
  }
  conditions(filter:Partial<ScenarioSettings>={}) {
    for(const key of Object.keys(filter)) {
      requireStudy(['pattern','neighbourhood','lambdaMetres','lossPercent'].includes(key),'unknown condition filter');
    }
    const found=CONDITIONS.filter(c=>Object.entries(filter).every(([k,v])=>c[k as keyof ScenarioSettings]===v));
    requireStudy(found.length>0,'unsupported condition filter');
    return Object.freeze(found.map(c=>this.condition(c)));
  }
  compare(a:ScenarioSettings|string,b:ScenarioSettings|string) {
    const before=this.condition(a),after=this.condition(b);
    requireStudy(before.pc!==null && after.pc!==null,'uncomputed PC');
    const deltaPc=after.pc-before.pc;
    const changedAxes=(['pattern','neighbourhood','lambdaMetres','lossPercent'] as const).filter(k=>before[k]!==after[k]);
    return Object.freeze({provenance:this.provenance,before,after,changedAxes:Object.freeze(changedAxes),
      deltaPc,relativeChange:before.pc===0?null:deltaPc/before.pc,
      relativeStatus:before.pc===0?'undefined_zero_baseline' as const:'defined' as const,
      interpretation:'structural_sensitivity_not_causal_or_forecast' as const});
  }
  curve(selection:Omit<ScenarioSettings,'lossPercent'>) {
    conditionId({...selection,lossPercent:0});
    const points=this.conditions({pattern:selection.pattern,neighbourhood:selection.neighbourhood,lambdaMetres:selection.lambdaMetres});
    const diagnostic=this.data.baseline.thresholds.curves.find(c=>c.pattern===selection.pattern &&
      c.neighbourhood===selection.neighbourhood && c.lambdaMetres===selection.lambdaMetres);
    requireStudy(diagnostic && points.length===11,'incomplete curve');
    return Object.freeze({provenance:this.provenance,points,diagnostic,
      ecologicalThresholdValidated:false as const});
  }
  get diagnostics():readonly CurveDiagnostic[] { return this.data.baseline.thresholds.curves; }
  get candidates() { return this.data.bridges.evaluated; }
  rankedCandidates(directInBothNeighbourhoods=false) {
    const ids=this.data.bridges.modelMetadata[directInBothNeighbourhoods?'rankedDirectBridgeIds':'rankedConnectorIds'] as string[];
    return Object.freeze(ids.map(id=>this.candidates.find(e=>e.site.id===id)!));
  }
  intervention(site:VerifiedSiteResults,selection:ScenarioSettings|string) {
    if(!this.validatedSites.has(site)) {
      validateSite(this.data,site);
      if(Object.isFrozen(site)&&Object.isFrozen(site.results)&&site.results.every(Object.isFrozen))this.validatedSites.add(site);
    }
    const baseline=this.condition(selection), result=site.results.find(r=>r.scenarioId===baseline.scenarioId);
    requireStudy(result,'intervention condition missing');
    const entry=this.candidates.find(e=>e.site.id===site.siteId)!;
    return freeze({provenance:this.provenance,site:entry.site,condition:resolveCondition(baseline.scenarioId),
      result:{...result},pcEffect:result.deltaPc>1e-12?'increase':result.deltaPc< -1e-12?'decrease':'within_tolerance',
      topology:result.afterPatchCount<result.beforePatchCount?'patch_merger':
        result.afterPatchCount>result.beforePatchCount?'new_island':'unchanged_patch_count',
      addedAreaM2:400 as const,fieldEcologicalEffect:'not_validated' as const});
  }
  compareCandidates(a:VerifiedSiteResults,b:VerifiedSiteResults,selection:ScenarioSettings|string) {
    const first=this.intervention(a,selection),second=this.intervention(b,selection);
    return freeze({provenance:this.provenance,first,second,addedAreaM2:400 as const,
      deltaPcDifference:second.result.deltaPc-first.result.deltaPc,
      interpretation:'equal_area_shortlist_comparison_not_a_recommendation' as const});
  }
}
/** Pinned release plus existing resource SHA checks. No extra network service or tracking. */
function pinnedOptions(options:StudyLoadOptions):StudyLoadOptions {
  const fetcher=options.fetcher??fetch;
  return {...options,fetcher:async(input,init)=>{
    throwIfCancelled(options.signal);
    const response=await fetcher(input,init);
    if(String(input).endsWith('/manifest.json') && response.ok) {
      const buffer=await response.arrayBuffer();
      throwIfCancelled(options.signal);
      if(buffer.byteLength>120000)throw new StudyIntegrityError('INVALID_MANIFEST','Manifest exceeds release bounds');
      if(!globalThis.crypto?.subtle)throw new StudyIntegrityError('CRYPTO_UNAVAILABLE','SHA-256 required');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==STUDY_RELEASE.manifestSha256)throw new StudyIntegrityError('HASH_MISMATCH','Study index does not match pinned release');
      return new Response(buffer,{status:response.status});
    }
    return response;
  }};
}
export async function loadResearchStudy(region:RegionId,options:StudyLoadOptions={}):Promise<ResearchStudy> {
  throwIfCancelled(options.signal);
  let data:VerifiedStudyRegion;
  try {data=await loadVerifiedStudyRegion(region,pinnedOptions(options));}
  catch(error) {throwIfCancelled(options.signal);throw error;}
  throwIfCancelled(options.signal);
  return ResearchStudy.fromVerified(data);
}
export async function loadResearchSite(study:ResearchStudy,siteId:string,options:StudyLoadOptions={}) {
  throwIfCancelled(options.signal);
  let site:VerifiedSiteResults;
  try {site=await loadVerifiedInterventionSite(study.data,siteId,options);}
  catch(error) {throwIfCancelled(options.signal);throw error;}
  throwIfCancelled(options.signal);
  validateSite(study.data,site);
  return freeze(site);
}
