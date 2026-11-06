/**
 * ECO MIRROR 3.0 verified static study reader.
 *
 * The original CLI calculations are precomputed and SHA-256 verified before use.
 * Never replace missing, untrusted, stale or incomplete data with model zero.
 * This module is UI-independent and never assumes real animal movement.
 */
import { verifyWorldcoverWindow, type VerifiedWorldcoverWindow } from "../features/landscape/data/window.ts";
import { enumerateConditions } from "../features/landscape/scenarios/engine.ts";
import type { EnsembleResult } from "../features/landscape/scenarios/engine.ts";
import type { ThresholdReport } from "../features/landscape/thresholds/detect.ts";
import type { LandscapeGrid } from "../features/landscape/core/types.ts";
import type { InterventionResult, InterventionSite, InterventionSummary } from "../features/landscape/bridges/engine.ts";

const SOURCE_COMMIT="9a7fa63bc83f350c80ddf775124cd3cbeb6c112e";
const REGIONS=["shinjuku","osaka","nagoya","fukuoka","sapporo","odaiba"] as const;
const HEX=/^[0-9a-f]{64}$/;
const KNOWN_REGION=new Set<string>(REGIONS);
const MAX_MANIFEST_BYTES=120000;
const MAX_RESOURCE_BYTES=350000;
const PREFIX="studies/worldcover-2021-v200/";

export type RegionId=(typeof REGIONS)[number];
export type StudyResourceKind="crop"|"baseline"|"bridges-summary"|"site";
export interface StudyResource {
  kind:StudyResourceKind;
  path:string;
  sha256:string;
  bytes:number;
  siteId?:string;
}
export interface StudyRegionIndex {
  regionId:RegionId;
  datasetId:string;
  width:200;
  height:200;
  crs:string;
  sourceProduct:"ESA WorldCover 10m 2021 v200";
  observationYear:2021;
  derivedPixelClassSha256:string;
  derivedVegetationMaskSha256:string;
  sourceFullTileSha256:null;
  conditionsCount:440;
  siteCount:16;
  interventionComparisonsCount:7040;
  resources:StudyResource[];
}
export interface StudyIndex {
  schemaVersion:"eco3-study-index-v1";
  sourceYear:2021;
  sourceProduct:"ESA WorldCover 10m 2021 v200";
  license:"CC BY 4.0";
  attribution:string;
  sourceDOI:"10.5281/zenodo.7254221";
  researchSourceCommitSha:string;
  scientificMeaning:"structural_landcover_proxy_not_real_animal_movement_or_forecast";
  model:"centroid-distance-exponential-v1";
  distribution:"immutable_hash_checked_static_assets";
  regionCount:6;
  totalBaselineConditions:2640;
  totalInterventionComparisons:42240;
  regions:StudyRegionIndex[];
}
export interface BridgeSummaryItem {
  site:InterventionSite;
  resultCount:440;
  summary:InterventionSummary;
}
export interface BridgeSummaries {
  schemaVersion:"eco3-intervention-summary-v1";
  originalReportSha256:string;
  reportMetadata:Record<string,unknown>;
  modelMetadata:Record<string,unknown>;
  evaluated:BridgeSummaryItem[];
}
export interface StudyBaseline {
  schema_version:"landscape-phases-1-3-v1";
  source_dataset_id:string;
  derived_binary_mask_sha256:string;
  derived_pixel_class_sha256:string;
  source_full_tile_sha256:null;
  ecological_validation:"not_validated";
  actual_future_probabilities:false;
  ensemble:EnsembleResult;
  thresholds:ThresholdReport;
}
export interface VerifiedStudyRegion {
  regionId:RegionId;
  index:StudyRegionIndex;
  source:VerifiedWorldcoverWindow & { source_class_codes_b64:string };
  grid:LandscapeGrid;
  baseline:StudyBaseline;
  bridges:BridgeSummaries;
  scientificStatus:"structural_only_not_field_validated";
}
export interface VerifiedSiteResults {
  siteId:string;
  sourceDatasetId:string;
  results:InterventionResult[];
  scientificStatus:"hypothetical_conversion_only";
}

export class StudyIntegrityError extends Error {
  constructor(public readonly reason:"NETWORK"|"INVALID_MANIFEST"|"MISSING_RESOURCE"|"HASH_MISMATCH"|"INVALID_DATA"|"CRYPTO_UNAVAILABLE",message:string) {
    super(message);
    this.name="StudyIntegrityError";
  }
}
const invalid=(reason:StudyIntegrityError["reason"],message:string):never=>{
  throw new StudyIntegrityError(reason,message);
};
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const hex=(value:unknown):value is string=>typeof value==="string"&&HEX.test(value);
function pathOk(path:unknown,region:RegionId):path is string {
  return typeof path==="string" &&
    path.startsWith(`regions/${region}/`) && !path.includes("..") &&
    !path.includes("\\") && !path.includes("?") && !path.includes("#") &&
    /^[a-z0-9./_-]+$/.test(path);
}
export interface StudyLoadOptions {
  /** Defaults to the app's Vite base URL; injected in tests. */
  baseUrl?:string;
  fetcher?:typeof fetch;
  signal?:AbortSignal;
}
function resourceRoot(options:StudyLoadOptions):string {
  const base=options.baseUrl ?? import.meta.env.BASE_URL ?? "/";
  return base.replace(/\/?$/,"/")+PREFIX;
}
async function getBytes(url:string,fetcher:typeof fetch,signal:AbortSignal|undefined,max:number):Promise<Uint8Array> {
  let response:Response;
  try { response=await fetcher(url,{signal,cache:"no-store"}); }
  catch(error) { return invalid("NETWORK","Cannot request verified 2021 study resource: "+String(error)); }
  if(!response.ok) return invalid("MISSING_RESOURCE","Study resource unavailable (HTTP "+response.status+").");
  let bytes:Uint8Array;
  try { bytes=new Uint8Array(await response.arrayBuffer()); }
  catch(error) { return invalid("NETWORK","Cannot read study resource: "+String(error)); }
  if(bytes.byteLength>max || bytes.byteLength===0) return invalid("INVALID_DATA","Study resource has unexpected byte length.");
  return bytes;
}
function decode<T>(bytes:Uint8Array,label:string):T {
  try {return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as T;}
  catch {return invalid("INVALID_DATA","Invalid UTF-8 JSON: "+label);}
}
async function digest(bytes:Uint8Array):Promise<string> {
  if(typeof crypto==="undefined" || !crypto.subtle) return invalid("CRYPTO_UNAVAILABLE","Web Crypto SHA-256 is required; refusing unverified data.");
  let result:ArrayBuffer;
  try {result=await crypto.subtle.digest("SHA-256",new Uint8Array(bytes));}
  catch {return invalid("CRYPTO_UNAVAILABLE","Could not calculate SHA-256 of study resource.");}
  return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,"0")).join("");
}
async function loadHashed<T>(descriptor:StudyResource,root:string,options:StudyLoadOptions):Promise<T> {
  const bytes=await getBytes(root+descriptor.path,options.fetcher??fetch,options.signal,MAX_RESOURCE_BYTES);
  if(bytes.length!==descriptor.bytes || await digest(bytes)!==descriptor.sha256)
    return invalid("HASH_MISMATCH","SHA-256 verification failed for "+descriptor.path);
  return decode<T>(bytes,descriptor.path);
}
function lookup(region:StudyRegionIndex,kind:StudyResourceKind,siteId?:string):StudyResource {
  const matches=region.resources.filter(r=>r.kind===kind&&(kind!=="site"||r.siteId===siteId));
  if(matches.length!==1) return invalid("INVALID_MANIFEST","Expected one resource of kind "+kind);
  return matches[0]!;
}

export async function loadStudyIndex(options:StudyLoadOptions={}):Promise<StudyIndex> {
  const root=resourceRoot(options);
  const manifest=decode<unknown>(await getBytes(root+"manifest.json",options.fetcher??fetch,options.signal,MAX_MANIFEST_BYTES),"manifest");
  if(!object(manifest) || manifest.schemaVersion!=="eco3-study-index-v1" ||
    manifest.sourceYear!==2021 || manifest.sourceProduct!=="ESA WorldCover 10m 2021 v200" ||
    manifest.license!=="CC BY 4.0" || manifest.sourceDOI!=="10.5281/zenodo.7254221" ||
    manifest.researchSourceCommitSha!==SOURCE_COMMIT ||
    manifest.scientificMeaning!=="structural_landcover_proxy_not_real_animal_movement_or_forecast" ||
    manifest.model!=="centroid-distance-exponential-v1" ||
    manifest.regionCount!==6 || manifest.totalBaselineConditions!==2640 ||
    manifest.totalInterventionComparisons!==42240 || !Array.isArray(manifest.regions) ||
    manifest.regions.length!==6 || !String(manifest.attribution??"").includes("ESA WorldCover"))
    return invalid("INVALID_MANIFEST","Unexpected 2021 research study index, source, counts or scientific meaning.");
  const seen=new Set<string>();
  for(const maybe of manifest.regions) {
    if(!object(maybe) || typeof maybe.regionId!=="string" ||
      !KNOWN_REGION.has(maybe.regionId) || seen.has(maybe.regionId) ||
      typeof maybe.datasetId!=="string" || !maybe.datasetId.includes("2021-v200") ||
      maybe.width!==200 || maybe.height!==200 ||
      typeof maybe.crs!=="string" || !/^EPSG:66(?:6[9]|7[0-9]|8[0-7])$/.test(maybe.crs) ||
      maybe.observationYear!==2021 || maybe.sourceProduct!=="ESA WorldCover 10m 2021 v200" ||
      maybe.sourceFullTileSha256!==null || !hex(maybe.derivedPixelClassSha256) ||
      !hex(maybe.derivedVegetationMaskSha256) || maybe.conditionsCount!==440 ||
      maybe.siteCount!==16 || maybe.interventionComparisonsCount!==7040 ||
      !Array.isArray(maybe.resources) || maybe.resources.length!==19)
      return invalid("INVALID_MANIFEST","Invalid or missing region and source metadata.");
    seen.add(maybe.regionId);
    const paths=new Set<string>();
    let sites=0;
    for(const r of maybe.resources) {
      if(!object(r) || !["crop","baseline","bridges-summary","site"].includes(String(r.kind)) ||
        !pathOk(r.path,maybe.regionId as RegionId) || paths.has(r.path) ||
        !hex(r.sha256) || !Number.isSafeInteger(r.bytes) || !(r.bytes>0&&r.bytes<=MAX_RESOURCE_BYTES))
        return invalid("INVALID_MANIFEST","Invalid, oversized, repeated or unsafe resource descriptor.");
      paths.add(r.path);
      if(r.kind==="site"){
        sites++;
        if(typeof r.siteId!=="string" || !/^(connector|reference)-x\d+-y\d+$/.test(r.siteId) ||
          !r.path.endsWith("/"+r.siteId+".json"))
          return invalid("INVALID_MANIFEST","Invalid intervention result path/ID.");
      }
    }
    if(sites!==16 || ["crop","baseline","bridges-summary"].some(k=>maybe.resources.filter((r:StudyResource)=>r.kind===k).length!==1))
      return invalid("INVALID_MANIFEST","Missing/duplicate core research resources.");
  }
  if(seen.size!==REGIONS.length) return invalid("INVALID_MANIFEST","Required research region is absent.");
  return manifest as unknown as StudyIndex;
}
function indexFor(index:StudyIndex,site:RegionId):StudyRegionIndex {
  if(!KNOWN_REGION.has(site))return invalid("INVALID_MANIFEST","Unsupported 2021 study region.");
  const r=index.regions.find(x=>x.regionId===site);
  if(!r)return invalid("INVALID_MANIFEST","Selected study region absent.");
  return r;
}
export async function loadVerifiedStudyRegion(site:RegionId,options:StudyLoadOptions={}):Promise<VerifiedStudyRegion> {
  const index=await loadStudyIndex(options);
  const region=indexFor(index,site),root=resourceRoot(options);
  const [crop,baseline,bridges]=await Promise.all([
    loadHashed<VerifiedWorldcoverWindow & {source_class_codes_b64:string}>(lookup(region,"crop"),root,options),
    loadHashed<StudyBaseline>(lookup(region,"baseline"),root,options),
    loadHashed<BridgeSummaries>(lookup(region,"bridges-summary"),root,options)
  ]);
  if(!object(crop) || !object(baseline) || !object(bridges))
    return invalid("INVALID_DATA","One or more study JSON documents are not objects.");
  let grid:LandscapeGrid;
  try {grid=await verifyWorldcoverWindow(crop);}
  catch(error) {return invalid("INVALID_DATA","ESA WorldCover mask failed independent input validation: "+String(error));}
  if(crop.dataset_id!==region.datasetId || grid.width!==200 || grid.height!==200 ||
    grid.crs!==region.crs || grid.sourceSha256!==region.derivedPixelClassSha256 ||
    crop.derived_binary_mask_sha256!==region.derivedVegetationMaskSha256)
    return invalid("INVALID_DATA","Study region source/hashes or CRS mismatch.");
  // The original WorldCover classification and the binary vegetation mask are different byte streams.
  if(typeof crop.source_class_codes_b64!=="string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(crop.source_class_codes_b64))
    return invalid("INVALID_DATA","Original source land-cover values missing.");
  let classes:Uint8Array;
  try { classes=Uint8Array.from(atob(crop.source_class_codes_b64),char=>char.charCodeAt(0)); }
  catch {return invalid("INVALID_DATA","Original source classifications were not valid base64.");}
  if(classes.length!==40000 || await digest(classes)!==region.derivedPixelClassSha256)
    return invalid("INVALID_DATA","Original 2021 land-cover classes failed hash verification.");

  if(baseline.schema_version!=="landscape-phases-1-3-v1" ||
    baseline.source_dataset_id!==region.datasetId ||
    baseline.derived_binary_mask_sha256!==region.derivedVegetationMaskSha256 ||
    baseline.derived_pixel_class_sha256!==region.derivedPixelClassSha256 ||
    baseline.source_full_tile_sha256!==null || baseline.ecological_validation!=="not_validated" ||
    baseline.actual_future_probabilities!==false ||
    baseline.ensemble?.status!=="complete" || baseline.ensemble.expectedCount!==440 ||
    baseline.ensemble.calculatedCount!==440 || baseline.ensemble.conditions?.length!==440 ||
    baseline.ensemble.scientificMeaning!=="hypothetical_stress_tests_not_forecast_probabilities" ||
    baseline.thresholds?.status!=="complete" || baseline.thresholds.curves?.length!==40 ||
    baseline.thresholds.testedCurves!==40 || baseline.thresholds.completeCurves!==40 ||
    baseline.thresholds.ecologicalThresholdsValidated!==0)
    return invalid("INVALID_DATA","Missing/invalid 440 experiment or 40 model-only curves.");

  const expected=new Set(enumerateConditions().map(c=>
    `${c.pattern}-n${c.neighbourhood}-lambda${c.lambdaMetres}-loss${c.lossPercent}`));
  for(const record of baseline.ensemble.conditions) {
    if(!expected.delete(record.scenarioId) || record.status!=="STRUCTURAL_ONLY" ||
      record.pc===null || !Number.isFinite(record.pc) || record.pc<0 || record.pc>1)
      return invalid("INVALID_DATA","Duplicate/missing 440 condition or invalid PC.");
  }
  if(expected.size!==0) return invalid("INVALID_DATA","Incomplete original 440 research conditions.");
  if(bridges.schemaVersion!=="eco3-intervention-summary-v1" ||
    !hex(bridges.originalReportSha256) || bridges.evaluated?.length!==16 ||
    bridges.modelMetadata?.scenarioCount!==440 ||
    bridges.modelMetadata?.sourceDatasetId!==region.datasetId ||
    bridges.modelMetadata?.sourceRasterSha256!==region.derivedPixelClassSha256 ||
    bridges.modelMetadata?.ecologicalInterventionEffectsValidated!==0 ||
    bridges.modelMetadata?.siteFeasibility!=="not_assessed" ||
    bridges.reportMetadata?.real_bee_movements_or_ecological_effects_verified!==false)
    return invalid("INVALID_DATA","Incomplete bridge summary or invented field validation.");
  const siteIds=new Set<string>();
  for(const e of bridges.evaluated){
    if(!e?.site || siteIds.has(e.site.id) ||
      e.resultCount!==440 || e.summary?.count!==440 ||
      e.site.addedAreaM2!==400 ||
      !e.site.sourceClasses?.every(v=>v===50||v===60) ||
      !region.resources.some(r=>r.kind==="site"&&r.siteId===e.site.id))
      return invalid("INVALID_DATA","Bridge shortlist is incomplete or ineligible.");
    siteIds.add(e.site.id);
  }
  return {regionId:site,index:region,source:crop,grid,baseline,bridges,
    scientificStatus:"structural_only_not_field_validated"};
}
export async function loadVerifiedInterventionSite(
  region:VerifiedStudyRegion,siteId:string,options:StudyLoadOptions={}
):Promise<VerifiedSiteResults> {
  const chosen=region.bridges.evaluated.find(s=>s.site.id===siteId);
  if(!chosen)return invalid("INVALID_DATA","Unknown intervention site; not part of audited shortlist.");
  const descriptor=lookup(region.index,"site",siteId);
  const site=await loadHashed<unknown>(descriptor,resourceRoot(options),options);
  if(!object(site) || site.schemaVersion!=="eco3-intervention-site-v1" ||
    site.sourceDatasetId!==region.index.datasetId ||
    site.sourceRasterSha256!==region.index.derivedPixelClassSha256 ||
    site.siteId!==siteId || !Array.isArray(site.results) || site.results.length!==440)
    return invalid("INVALID_DATA","Intervention site dataset incomplete or from a different source.");
  const reference=new Map(region.baseline.ensemble.conditions.map(c=>[c.scenarioId,c]));
  const seen=new Set<string>();
  for(const record of site.results) {
    if(!object(record) || typeof record.scenarioId!=="string" || seen.has(record.scenarioId))
      return invalid("INVALID_DATA","Duplicate or invalid intervention condition.");
    seen.add(record.scenarioId);
    const before=reference.get(record.scenarioId);
    if(!before || before.pc===null || before.vegetationAreaM2===null ||
      typeof record.beforePc!=="number" || typeof record.afterPc!=="number" ||
      typeof record.deltaPc!=="number" ||
      !Number.isFinite(record.beforePc)||!Number.isFinite(record.afterPc)||!Number.isFinite(record.deltaPc) ||
      Math.abs(before.pc-record.beforePc)>1e-12 ||
      Math.abs(record.afterPc-record.beforePc-record.deltaPc)>1e-12 ||
      record.beforeVegetationAreaM2!==before.vegetationAreaM2 ||
      typeof record.afterVegetationAreaM2!=="number" ||
      record.afterVegetationAreaM2-record.beforeVegetationAreaM2!==400 ||
      !Number.isSafeInteger(record.beforePatchCount) || !Number.isSafeInteger(record.afterPatchCount) ||
      record.beforePatchCount<0 || record.afterPatchCount<0 ||
      record.patchesJoined!==Math.max(0,record.beforePatchCount-record.afterPatchCount))
      return invalid("INVALID_DATA","Site and baseline mismatch, invalid PC, or unequal hypothetical area.");
  }
  if(seen.size!==440)return invalid("INVALID_DATA","Missing intervention scenario rows.");
  return {siteId,sourceDatasetId:region.index.datasetId,
    results:site.results as InterventionResult[],scientificStatus:"hypothetical_conversion_only"};
}
