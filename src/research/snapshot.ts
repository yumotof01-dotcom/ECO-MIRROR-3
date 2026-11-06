import { conditionId, resolveCondition } from './conditions.ts';
import { loadResearchSite, loadResearchStudy, STUDY_RELEASE, throwIfCancelled } from './study.ts';
import type { ResearchStudy } from './study.ts';
import type { RegionId, StudyLoadOptions } from '../studies/verifiedStudyLoader.ts';
import type { ScenarioSettings } from '../features/landscape/scenarios/engine.ts';
import { equivalent } from './validation.ts';

export const SNAPSHOT_VERSION='eco3-research-snapshot-v1' as const;
export const MAX_SNAPSHOT_BYTES=128000;
export type ResearchQuery =
  | {kind:'condition';conditionId:string}
  | {kind:'comparison';beforeId:string;afterId:string}
  | {kind:'curve';pattern:ScenarioSettings['pattern'];neighbourhood:ScenarioSettings['neighbourhood'];lambdaMetres:number}
  | {kind:'intervention';siteId:string;conditionId:string}
  | {kind:'candidates';firstSiteId:string;secondSiteId:string;conditionId:string};
type SnapshotPayload={
  schemaVersion:typeof SNAPSHOT_VERSION;
  createdAt:string;
  producerContract:'eco3-research-view-v1';
  provenance:ResearchStudy['provenance'];
  resources:ResearchStudy['data']['index']['resources'];
  query:ResearchQuery;
  result:unknown;
};
export type ResearchSnapshot={
  canonicalization:'eco3-sorted-json-v1';
  sha256:string;
  payload:SnapshotPayload;
};
export class SnapshotError extends Error {
  constructor(readonly reason:'TOO_LARGE'|'INVALID_FORMAT'|'UNSUPPORTED_VERSION'|'CHECKSUM_MISMATCH'|'REPLAY_MISMATCH',detail:string) {
    super(detail);this.name='SnapshotError';
  }
}
function fail(reason:SnapshotError['reason'],detail:string):never {throw new SnapshotError(reason,detail);}
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exactKeys(v:Record<string,unknown>,keys:readonly string[]):boolean {
  return Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
}
/** Bounded JSON only. Never treat imported text as HTML, URLs, code or executable expressions. */
function checkTree(root:unknown) {
  const stack=[{value:root,depth:0}];let nodes=0;
  while(stack.length) {
    const {value,depth}=stack.pop()!;
    if(++nodes>16000||depth>24)fail('INVALID_FORMAT','Snapshot nesting/size exceeds contract');
    if(value===null||typeof value==='string'||typeof value==='boolean')continue;
    if(typeof value==='number') {if(!Number.isFinite(value))fail('INVALID_FORMAT','Non-finite snapshot number');continue;}
    if(Array.isArray(value)) {for(const v of value)stack.push({value:v,depth:depth+1});continue;}
    if(isObject(value)) {
      if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_FORMAT','Snapshot must contain plain JSON objects');
      for(const [key,v] of Object.entries(value)) {
        if(['__proto__','prototype','constructor'].includes(key))fail('INVALID_FORMAT','Unsafe snapshot key');
        stack.push({value:v,depth:depth+1});
      }
      continue;
    }
    fail('INVALID_FORMAT','Snapshot must contain JSON values only');
  }
}
export function canonicalSnapshotJson(value:unknown):string {
  checkTree(value);
  const encode=(v:unknown):string=>{
    if(Array.isArray(v))return '['+v.map(encode).join(',')+']';
    if(isObject(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}';
    return JSON.stringify(v);
  };
  return encode(value);
}
async function hash(payload:unknown):Promise<string> {
  if(!globalThis.crypto?.subtle)fail('INVALID_FORMAT','Web Crypto is required for snapshots');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSnapshotJson(payload)))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function validateResearchQuery(value:unknown):ResearchQuery {
  if(!isObject(value)||typeof value.kind!=='string')fail('INVALID_FORMAT','Unknown research query');
  const keys:Record<ResearchQuery['kind'],string[]>={condition:['kind','conditionId'],comparison:['kind','beforeId','afterId'],
    curve:['kind','pattern','neighbourhood','lambdaMetres'],intervention:['kind','siteId','conditionId'],
    candidates:['kind','firstSiteId','secondSiteId','conditionId']};
  if(!Object.hasOwn(keys,value.kind)||!exactKeys(value,keys[value.kind as ResearchQuery['kind']]!))fail('INVALID_FORMAT','Unexpected query fields');
  try {
    if(value.kind==='curve')conditionId({...value,lossPercent:0} as unknown as ScenarioSettings);
    else if(value.kind==='comparison') {resolveCondition(value.beforeId as string);resolveCondition(value.afterId as string);}
    else resolveCondition(value.conditionId as string);
    for(const k of ['siteId','firstSiteId','secondSiteId'])if(k in value &&
      (typeof value[k]!=='string'||!/^(connector|reference)-x\d+-y\d+$/.test(value[k] as string)))throw Error('Invalid candidate ID');
  } catch {fail('INVALID_FORMAT','Query is outside the fixed research experiment');}
  return Object.freeze({...value}) as unknown as ResearchQuery;
}
async function evaluate(study:ResearchStudy,query:ResearchQuery,options:StudyLoadOptions) {
  const siteIds=query.kind==='intervention'?[query.siteId]:query.kind==='candidates'?[query.firstSiteId,query.secondSiteId]:[];
  // Validate all candidate IDs before issuing a single request.
  if(siteIds.some(id=>!study.candidates.some(c=>c.site.id===id)))fail('INVALID_FORMAT','Candidate is not from the selected region');
  const ids=[...new Set(siteIds)];
  const loaded=await Promise.all(ids.map(id=>loadResearchSite(study,id,options)));
  throwIfCancelled(options.signal);
  const site=(id:string)=>loaded.find(s=>s.siteId===id)!;
  let result:unknown;
  switch(query.kind) {
    case 'condition':result=study.condition(query.conditionId);break;
    case 'comparison':result=study.compare(query.beforeId,query.afterId);break;
    case 'curve':result=study.curve(query);break;
    case 'intervention':result=study.intervention(site(query.siteId),query.conditionId);break;
    case 'candidates':result=study.compareCandidates(site(query.firstSiteId),site(query.secondSiteId),query.conditionId);break;
  }
  const resources=study.data.index.resources.filter(r=>r.kind!=='site'||ids.includes(r.siteId!));
  return {result,resources};
}
export async function createResearchSnapshot(study:ResearchStudy,query:ResearchQuery,options:StudyLoadOptions={},createdAt=new Date()):Promise<ResearchSnapshot> {
  throwIfCancelled(options.signal);
  const normalized=validateResearchQuery(query),{result,resources}=await evaluate(study,normalized,options);
  const payload:SnapshotPayload={schemaVersion:SNAPSHOT_VERSION,createdAt:createdAt.toISOString(),producerContract:'eco3-research-view-v1',
    provenance:study.provenance,resources,query:normalized,result};
  const snapshot:ResearchSnapshot={canonicalization:'eco3-sorted-json-v1',sha256:await hash(payload),payload};
  throwIfCancelled(options.signal);
  return snapshot;
}
export function serializeResearchSnapshot(snapshot:ResearchSnapshot):string {
  const text=canonicalSnapshotJson(snapshot)+'\n';
  if(new TextEncoder().encode(text).length>MAX_SNAPSHOT_BYTES)fail('TOO_LARGE','Snapshot exceeds 128000 UTF-8 bytes');
  return text;
}
/** Integrity checked is not scientifically verified. replayResearchSnapshot is required before displaying results. */
export async function parseResearchSnapshot(text:string,signal?:AbortSignal):Promise<ResearchSnapshot> {
  throwIfCancelled(signal);
  if(typeof text!=='string')fail('INVALID_FORMAT','Expected JSON text');
  if(text.length>MAX_SNAPSHOT_BYTES||new TextEncoder().encode(text).length>MAX_SNAPSHOT_BYTES)fail('TOO_LARGE','Snapshot exceeds byte limit');
  let value:unknown;
  try {value=JSON.parse(text);}catch {fail('INVALID_FORMAT','Invalid JSON');}
  checkTree(value);
  if(!isObject(value)||!exactKeys(value,['canonicalization','sha256','payload']) || value.canonicalization!=='eco3-sorted-json-v1' ||
    typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/.test(value.sha256)||!isObject(value.payload))fail('INVALID_FORMAT','Invalid snapshot envelope');
  const p=value.payload;
  if(p.schemaVersion!==SNAPSHOT_VERSION||p.producerContract!=='eco3-research-view-v1')fail('UNSUPPORTED_VERSION','Snapshot version is not supported');
  if(!exactKeys(p,['schemaVersion','createdAt','producerContract','provenance','resources','query','result'])||
    typeof p.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.createdAt)||
    !Number.isFinite(Date.parse(p.createdAt))||new Date(p.createdAt).toISOString()!==p.createdAt ||
    !isObject(p.provenance)||!equivalent(p.provenance.release,STUDY_RELEASE)||
    !['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'].includes(String(p.provenance.regionId))||!Array.isArray(p.resources))
    fail('INVALID_FORMAT','Invalid snapshot metadata or release');
  validateResearchQuery(p.query);
  if(await hash(p)!==value.sha256)fail('CHECKSUM_MISMATCH','Snapshot contents were changed');
  throwIfCancelled(signal);
  return value as unknown as ResearchSnapshot;
}
export async function readResearchSnapshot(file:Blob,signal?:AbortSignal):Promise<ResearchSnapshot> {
  if(file.size>MAX_SNAPSHOT_BYTES)fail('TOO_LARGE','Selected file exceeds byte limit');
  throwIfCancelled(signal);
  return parseResearchSnapshot(await file.text(),signal);
}
/** No imported URL is ever fetched. All results are rebuilt from this app's pinned local/static package. */
export async function replayResearchSnapshot(text:string,options:StudyLoadOptions={}) {
  const saved=await parseResearchSnapshot(text,options.signal);
  const study=await loadResearchStudy(saved.payload.provenance.regionId as RegionId,options);
  if(!equivalent(saved.payload.provenance,study.provenance))fail('REPLAY_MISMATCH','Imported source attribution or metadata differs');
  const {result,resources}=await evaluate(study,saved.payload.query,options);
  if(!equivalent(saved.payload.resources,resources)||!equivalent(saved.payload.result,result))
    fail('REPLAY_MISMATCH','Saved results do not match the pinned research package');
  throwIfCancelled(options.signal);
  return Object.freeze({status:'verified_replay' as const,study,query:validateResearchQuery(saved.payload.query),result,
    provenance:study.provenance,createdAt:saved.payload.createdAt});
}
/** A local file value for UI download; no upload, localStorage or implicit overwrite. */
export function snapshotFile(snapshot:ResearchSnapshot):{filename:string;blob:Blob} {
  const region=snapshot.payload.provenance.regionId;
  if(!['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'].includes(region))fail('INVALID_FORMAT','Unknown region');
  return {filename:`eco-mirror-${region}-${snapshot.payload.createdAt.slice(0,10)}.json`,
    blob:new Blob([serializeResearchSnapshot(snapshot)],{type:'application/json;charset=utf-8'})};
}
