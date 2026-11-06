// @vitest-environment node
import {beforeAll,describe,expect,it,vi,afterEach} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {loadResearchStudy} from './study.ts';
import type {ResearchStudy} from './study.ts';
import {CONDITIONS} from './conditions.ts';
import {canonicalSnapshotJson,createResearchSnapshot,serializeResearchSnapshot,parseResearchSnapshot,
  readResearchSnapshot,replayResearchSnapshot,snapshotFile,MAX_SNAPSHOT_BYTES} from './snapshot.ts';
import type {ResearchQuery} from './snapshot.ts';
import {researchActions,researchErrorMessage,researchCapabilities,RESEARCH_UI_CONTRACT} from './uiContract.ts';
import {StudyIntegrityError} from '../studies/verifiedStudyLoader.ts';

type Mutable<T>={-readonly [K in keyof T]:T[K] extends object?Mutable<T[K]>:T[K]};
const names=['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'] as const;
const fetcher:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname;
  if(!path.startsWith('/studies/')||path.includes('..'))return new Response(null,{status:404});
  try {return new Response(await readFile(resolve('public','.'+path)));} catch {return new Response(null,{status:404});}
};
const options={baseUrl:'https://fixture.invalid/',fetcher};
const date=new Date('2026-11-06T12:00:00.000Z');
let studies:ResearchStudy[];
beforeAll(async()=>{studies=await Promise.all(names.map(id=>loadResearchStudy(id,options)));});
afterEach(()=>vi.unstubAllGlobals());
const rehash=(record:unknown)=>{
  const v=record as {payload:unknown;sha256:string};
  v.sha256=createHash('sha256').update(canonicalSnapshotJson(v.payload)).digest('hex');
  return JSON.stringify(v);
};
function queries(study:ResearchStudy):ResearchQuery[] {
  return [{kind:'condition',conditionId:CONDITIONS[0]!.scenarioId},
    {kind:'comparison',beforeId:CONDITIONS[0]!.scenarioId,afterId:CONDITIONS[1]!.scenarioId},
    {kind:'curve',pattern:'edge_first',neighbourhood:8,lambdaMetres:200},
    {kind:'intervention',siteId:study.candidates[0]!.site.id,conditionId:CONDITIONS[0]!.scenarioId},
    {kind:'candidates',firstSiteId:study.candidates[0]!.site.id,secondSiteId:study.candidates[1]!.site.id,conditionId:CONDITIONS[20]!.scenarioId}];
}
describe('Saved research results and verified replay',()=>{
  it('round-trips all five query types for all six regions, preserving provenance and results',async()=>{
    let files=0;
    for(const study of studies)for(const query of queries(study)) {
      const saved=await createResearchSnapshot(study,query,options,date);
      const text=serializeResearchSnapshot(saved);
      expect(new TextEncoder().encode(text).length).toBeLessThan(MAX_SNAPSHOT_BYTES);
      const parsed=await parseResearchSnapshot(text);
      expect(parsed.payload.provenance.release.year).toBe(2021);
      expect(parsed.payload.provenance.caveats.length).toBeGreaterThan(0);
      expect(parsed.payload.resources).toHaveLength(query.kind==='candidates'?5:query.kind==='intervention'?4:3);
      const replay=await replayResearchSnapshot(text,options);
      expect(replay.status).toBe('verified_replay');expect(replay.query).toEqual(query);
      expect(replay.result).toEqual(saved.payload.result);expect(replay.provenance).toEqual(study.provenance);
      const file=snapshotFile(saved);
      expect(file.filename).toBe(`eco-mirror-${study.data.regionId}-2026-11-06.json`);
      expect(await readResearchSnapshot(file.blob)).toEqual(parsed);
      files++;
    }
    console.log('SNAPSHOT_ROUNDTRIP_AUDIT=PASS '+JSON.stringify({regions:6,queryKinds:5,files}));
  },60000);
  it('serializes and integrity-checks every baseline condition',async()=>{
    let count=0;
    for(const study of studies)for(const c of CONDITIONS) {
      const saved=await createResearchSnapshot(study,{kind:'condition',conditionId:c.scenarioId},options,date);
      const parsed=await parseResearchSnapshot(serializeResearchSnapshot(saved));
      expect(parsed.payload.result).toEqual(study.condition(c));count++;
    }
    expect(count).toBe(2640);
    console.log('SNAPSHOT_CONDITION_AUDIT=PASS '+JSON.stringify({conditions:count}));
  },60000);
  it('rejects modified values even if an editor recomputes the file checksum',async()=>{
    const saved=await createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,options,date);
    const altered=structuredClone(saved) as typeof saved&{payload:{result:{pc:number}}};
    altered.payload.result.pc=.99;
    await expect(parseResearchSnapshot(JSON.stringify(altered))).rejects.toMatchObject({reason:'CHECKSUM_MISMATCH'});
    await expect(replayResearchSnapshot(rehash(altered),options)).rejects.toMatchObject({reason:'REPLAY_MISMATCH'});
  });
  it('rejects source, region, disclaimer and resource-hash substitutions after rehashing',async()=>{
    const saved=await createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,options,date);
    const mutations=[
      (v:Mutable<typeof saved>)=>{v.payload.provenance.sourceUrl='https://attacker.invalid/data';},
      (v:Mutable<typeof saved>)=>{v.payload.provenance.regionId='osaka';},
      (v:Mutable<typeof saved>)=>{v.payload.provenance.caveats=[];},
      (v:Mutable<typeof saved>)=>{v.payload.resources[0]!.sha256='0'.repeat(64);}
    ];
    const requested:string[]=[];
    const recording:typeof fetch=(input,init)=>{requested.push(String(input));return fetcher(input,init);};
    for(const [i,change] of mutations.entries()) {
      const altered=structuredClone(saved) as Mutable<typeof saved>;change(altered);
      await expect(replayResearchSnapshot(rehash(altered),{...options,fetcher:recording})).rejects.toMatchObject({reason:i===1?'INVALID_FORMAT':'REPLAY_MISMATCH'});
    }
    expect(requested.every(url=>url.startsWith('https://fixture.invalid/studies/'))).toBe(true);
  });
  it('rejects unknown versions, query axes/IDs, metadata fields, dates and oversized JSON before loading',async()=>{
    const saved=await createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,options,date);
    const invalid:unknown[]=[null,[],{},JSON.parse(JSON.stringify(saved).replace('eco3-research-snapshot-v1','v999')),
      {...saved,extra:true},{...saved,payload:{...saved.payload,createdAt:'2026-02-31T12:00:00.000Z'}},
      {...saved,payload:{...saved.payload,query:{kind:'condition',conditionId:'missing'}}},
      {...saved,payload:{...saved.payload,query:{kind:'curve',pattern:'distributed',neighbourhood:6,lambdaMetres:40}}},
      {...saved,payload:{...saved.payload,query:{...saved.payload.query,url:'https://attacker.invalid'}}}];
    const fetcher=vi.fn(async()=>new Response('{}'));
    for(const value of invalid)await expect(replayResearchSnapshot(JSON.stringify(value),{fetcher})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(parseResearchSnapshot('x'.repeat(MAX_SNAPSHOT_BYTES+1))).rejects.toMatchObject({reason:'TOO_LARGE'});
    await expect(readResearchSnapshot(new Blob(['x'.repeat(MAX_SNAPSHOT_BYTES+1)]))).rejects.toMatchObject({reason:'TOO_LARGE'});
    await expect(parseResearchSnapshot('{"__proto__": {"polluted":true}}')).rejects.toThrow();
    await expect(parseResearchSnapshot('['.repeat(30)+'0'+']'.repeat(30))).rejects.toThrow();
    expect(()=>canonicalSnapshotJson({pc:NaN})).toThrow();
    expect(()=>canonicalSnapshotJson({pc:undefined})).toThrow();
  });
  it('does not promote a valid file to verified results when pinned assets are offline or damaged',async()=>{
    const saved=await createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,options,date),text=serializeResearchSnapshot(saved);
    expect((await parseResearchSnapshot(text)).payload).toBeDefined();
    await expect(replayResearchSnapshot(text,{...options,fetcher:async()=>new Response(null,{status:404})})).rejects.toMatchObject({reason:'MISSING_RESOURCE'});
    const corrupt:typeof fetch=async(input,init)=>String(input).endsWith('/baseline.json')?new Response('{}'):fetcher(input,init);
    await expect(replayResearchSnapshot(text,{...options,fetcher:corrupt})).rejects.toMatchObject({reason:'HASH_MISMATCH'});
  });
  it('supports cancelled save/import/replay and refuses snapshots without crypto verification',async()=>{
    const saved=await createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,options,date),text=serializeResearchSnapshot(saved);
    const controller=new AbortController();controller.abort();
    await expect(createResearchSnapshot(studies[0]!,queries(studies[0]!)[0]!,{...options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    await expect(parseResearchSnapshot(text,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    await expect(replayResearchSnapshot(text,{...options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    vi.stubGlobal('crypto',undefined);
    await expect(parseResearchSnapshot(text)).rejects.toThrow('Web Crypto');
  });
  it('rejects cross-region or malformed candidate queries without fetching any site',async()=>{
    const fetcher=vi.fn(async()=>new Response('{}'));
    await expect(createResearchSnapshot(studies[0]!,{kind:'intervention',siteId:'connector-x999-y999',conditionId:CONDITIONS[0]!.scenarioId},{fetcher})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('UI handoff state/evidence contract',()=>{
  it('reports unsupported capabilities instead of silently enabling unverified work',()=>{
    vi.stubGlobal('Worker',undefined);
    expect(researchCapabilities()).toMatchObject({cryptoAvailable:true,canPrepareMap:false,canSaveAndReplay:true});
    vi.stubGlobal('Worker',class {});
    expect(researchCapabilities().canPrepareMap).toBe(true);
    vi.stubGlobal('crypto',undefined);
    expect(researchCapabilities()).toMatchObject({canVerify:false,canPrepareMap:false,canSaveAndReplay:false});
  });
  it('enables scientific actions only for verified ready state',()=>{
    for(const status of RESEARCH_UI_CONTRACT.states) {
      const actions=researchActions(status);
      expect(actions.export).toBe(status==='ready');expect(actions.compare).toBe(status==='ready');
      expect(actions.cancel).toBe(status==='loading');expect(actions.selectRegion).toBe(true);
    }
    expect(RESEARCH_UI_CONTRACT.sourceYear).toBe(2021);
    expect(RESEARCH_UI_CONTRACT.requiredEvidence).toContain('caveats');
    expect(researchActions('loading',{regionVerified:true})).toMatchObject({selectCondition:true,compare:false,export:false});
  });
  it('gives stable non-technical error text while preserving cancellation and retry rules',async()=>{
    const bad=new StudyIntegrityError('HASH_MISMATCH','secret/internal-path');
    expect(researchErrorMessage(bad)).toMatchObject({code:'integrity',retryable:false});
    expect(researchErrorMessage(bad).message).not.toContain('secret');
    expect(researchErrorMessage(new DOMException('cancel','AbortError')).code).toBe('cancelled');
    expect(researchErrorMessage(new StudyIntegrityError('NETWORK','offline')).retryable).toBe(true);
    expect(researchErrorMessage(new StudyIntegrityError('CRYPTO_UNAVAILABLE','crypto')).retryable).toBe(false);
    expect(researchErrorMessage(new Error('<script>alert(1)</script>')).message).not.toContain('<script>');
  });
});
