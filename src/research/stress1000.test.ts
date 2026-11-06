// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadResearchStudy,loadResearchSite} from './study.ts';
import type {ResearchStudy} from './study.ts';
import {CONDITIONS} from './conditions.ts';
import {createResearchSnapshot,serializeResearchSnapshot,parseResearchSnapshot,replayResearchSnapshot,canonicalSnapshotJson} from './snapshot.ts';
import type {ResearchQuery,ResearchSnapshot} from './snapshot.ts';
import {computeMapFrame,mapInput,cellBounds,candidateFootprint} from './mapData.ts';
import {ResearchSession} from './session.ts';
import {ResearchMapSession} from './mapSession.ts';
import {buildScenarioGridCache} from '../features/landscape/scenarios/engine.ts';
import {extractPatches} from '../features/landscape/core/landscape.ts';
import type {RegionId} from '../studies/verifiedStudyLoader.ts';

type Mutable<T>={-readonly [K in keyof T]:T[K] extends object?Mutable<T[K]>:T[K]};
const SEED=0xeca32026;
const REGIONS:RegionId[]=['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'];
const NOW=new Date('2026-11-06T12:00:00.000Z');
const bytes=new Map<string,Uint8Array>();
const studies:ResearchStudy[]=[];
const root=resolve('public/studies/worldcover-2021-v200');
const digest=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
const fixtureFetch:typeof fetch=async input=>{
  const path=new URL(String(input)).pathname.replace('/studies/worldcover-2021-v200/','');
  const found=bytes.get(path);
  return found?new Response(Uint8Array.from(found).buffer):new Response(null,{status:404});
};
const options={baseUrl:'https://fixture.invalid/',fetcher:fixtureFetch};
let rng=SEED;
function next(max:number) {rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%max;}
type Case={id:string;category:string;input:Record<string,unknown>;run:()=>void|Promise<void>};
const cases:Case[]=[];
function add(category:string,id:string,input:Record<string,unknown>,run:Case['run']) {cases.push({category,id:`${category}/${id}`,input,run});}
const clone=<T,>(value:T)=>structuredClone(value) as Mutable<T>;
function rehash(saved:ResearchSnapshot):string {
  const copy=clone(saved);copy.sha256=digest(canonicalSnapshotJson(copy.payload));return JSON.stringify(copy);
}
async function rejectExpected(call:Promise<unknown>,reason:string):Promise<void> {
  try {await call;}
  catch(error) {expect(error).toMatchObject({reason});return;}
  throw new Error(`Expected ${reason} rejection, but the operation resolved`);
}
async function loadFixtures(dir:string,prefix='') {
  for(const file of await readdir(dir,{withFileTypes:true})) {
    const relative=prefix+file.name;
    if(file.isDirectory())await loadFixtures(join(dir,file.name),relative+'/');
    else bytes.set(relative,new Uint8Array(await readFile(join(dir,file.name))));
  }
}
let sourceFingerprint='';
beforeAll(async()=>{
  await loadFixtures(root);
  for(const region of REGIONS)studies.push(await loadResearchStudy(region,options));
  const inputs:string[]=[];
  async function sourceFiles(dir:string) {
    for(const f of await readdir(dir,{withFileTypes:true})) {
      const path=join(dir,f.name);
      if(f.isDirectory())await sourceFiles(path);
      else if(!/\.test\./.test(path)&&path.endsWith('.ts'))inputs.push(path);
    }
  }
  await sourceFiles('src/research');await sourceFiles('src/features/landscape');inputs.push('src/studies/verifiedStudyLoader.ts','package-lock.json');
  const hashes=await Promise.all(inputs.sort().map(async path=>path+':'+digest(await readFile(path))));
  sourceFingerprint=digest(hashes.join('\n'));
});

// 440: every defined axis tuple. Metamorphic invariants are independent of UI presentation.
for(const [i,c] of CONDITIONS.entries()) {
  const r=i%6,other=CONDITIONS[(i*37+17)%440]!;
  add('conditions',`${REGIONS[r]}-${c.scenarioId}`,{region:REGIONS[r],condition:c.scenarioId,other:other.scenarioId},()=>{
    const study=studies[r]!,raw=study.data.baseline.ensemble.conditions.find(x=>x.scenarioId===c.scenarioId)!;
    expect(study.condition(c)).toEqual(raw);
    const ab=study.compare(c,other),ba=study.compare(other,c),self=study.compare(c,c);
    expect(ab.deltaPc+ba.deltaPc).toBe(0);expect(self.deltaPc).toBe(0);expect(self.changedAxes).toEqual([]);
    expect(ab.provenance.regionId).toBe(REGIONS[r]);expect(Number.isFinite(raw.pc)).toBe(true);
    const curve=study.curve(c);expect(curve.points).toHaveLength(11);
    expect(curve.points.find(p=>p.scenarioId===c.scenarioId)).toEqual(raw);
    expect(study.condition({...c,lossPercent:50}).vegetationAreaM2!).toBeLessThanOrEqual(study.condition({...c,lossPercent:0}).vegetationAreaM2!);
  });
}
// 120: 6 regions x 5 query kinds x 4 parameter sets, with a reproducible seed.
const roundtripKeys=new Set<string>();
for(let r=0;r<6;r++)for(const kind of ['condition','comparison','curve','intervention','candidates'] as const)for(let variant=0;variant<4;variant++) {
  let a=next(440);
  const b=(a+1+next(439))%440,site=next(16),otherSite=(site+1+next(15))%16;
  // Curves omit lossPercent: different full settings can otherwise resolve to the same query.
  const effectiveKey=()=>JSON.stringify([r,kind,...(kind==='curve'?[Math.floor(a/11)]:kind==='condition'?[a]:
    kind==='comparison'?[a,b]:kind==='intervention'?[a,site]:[a,site,otherSite])]);
  while(roundtripKeys.has(effectiveKey()))a=(a+(kind==='curve'?11:1))%440;
  roundtripKeys.add(effectiveKey());
  add('roundtrip',`${REGIONS[r]}-${kind}-${variant}`,{region:REGIONS[r],kind,a,b,site,otherSite},async()=>{
    const study=studies[r]!,condition=CONDITIONS[a]!,conditionId=condition.scenarioId;
    const query:ResearchQuery=kind==='condition'?{kind,conditionId}:kind==='comparison'?{kind,beforeId:conditionId,afterId:CONDITIONS[b]!.scenarioId}:
      kind==='curve'?{kind,pattern:condition.pattern,neighbourhood:condition.neighbourhood,lambdaMetres:condition.lambdaMetres}:
      kind==='intervention'?{kind,conditionId,siteId:study.candidates[site]!.site.id}:
      {kind,conditionId,firstSiteId:study.candidates[site]!.site.id,secondSiteId:study.candidates[otherSite]!.site.id};
    const saved=await createResearchSnapshot(study,query,options,NOW),text=serializeResearchSnapshot(saved);
    const replay=await replayResearchSnapshot(text,options);
    expect(replay.status).toBe('verified_replay');expect(replay.result).toEqual(saved.payload.result);
    expect(replay.query).toEqual(query);expect(replay.provenance).toEqual(study.provenance);
    expect((await parseResearchSnapshot(JSON.stringify(JSON.parse(text),null,2))).sha256).toBe(saved.sha256);
  });
}
const mutationNames=['pc','area','status','actual_loss','error_reason','different_valid_condition','source_url','attribution','caveats','class_sha',
  'mask_sha','crs','region','dataset','year','resource_sha','resource_bytes','extra_result_field','curve_array_to_object','empty_array_to_object'];
for(let r=0;r<6;r++)for(let mutation=0;mutation<20;mutation++) {
  const a=next(440);
  add('tamper',`${REGIONS[r]}-${mutationNames[mutation]}`,{region:REGIONS[r],mutation:mutationNames[mutation],conditionIndex:a},async()=>{
    const study=studies[r]!,c=CONDITIONS[a]!;
    const query:ResearchQuery=mutation===18?{kind:'curve',pattern:c.pattern,neighbourhood:c.neighbourhood,lambdaMetres:c.lambdaMetres}:
      mutation===19?{kind:'comparison',beforeId:c.scenarioId,afterId:c.scenarioId}:{kind:'condition',conditionId:c.scenarioId};
    const saved=clone(await createResearchSnapshot(study,query,options,NOW)),p=saved.payload;
    const result=p.result as Record<string,unknown>;
    switch(mutation) {
      case 0:result.pc=0.999999;break;
      case 1:result.vegetationAreaM2=Number(result.vegetationAreaM2)+100;break;
      case 2:result.status='NOT_ESTIMABLE';break;
      case 3:result.actualLossPercent=Number(result.actualLossPercent)+1;break;
      case 4:result.errorReason='invented';break;
      case 5:p.query={kind:'condition',conditionId:CONDITIONS[(a+1)%440]!.scenarioId};break;
      case 6:p.provenance.sourceUrl='https://not-a-source.invalid/data';break;
      case 7:p.provenance.attribution='changed';break;
      case 8:p.provenance.caveats=[];break;
      case 9:p.provenance.classSha256='0'.repeat(64);break;
      case 10:p.provenance.maskSha256='0'.repeat(64);break;
      case 11:p.provenance.crs=p.provenance.crs==='EPSG:6677'?'EPSG:6674':'EPSG:6677';break;
      case 12:p.provenance.regionId=REGIONS[(r+1)%6]!;break;
      case 13:p.provenance.datasetId+='-other';break;
      case 14:(p.provenance.release as unknown as {year:number}).year=2026;break;
      case 15:p.resources[0]!.sha256='0'.repeat(64);break;
      case 16:p.resources[0]!.bytes++;break;
      case 17:result.invented=true;break;
      case 18:result.points={...(result.points as unknown[])};break;
      case 19:result.changedAxes={};break;
    }
    const requests:string[]=[];
    const fetcher:typeof fetch=(url,init)=>{requests.push(String(url));return fixtureFetch(url,init);};
    const expected=[12,14].includes(mutation)?'INVALID_FORMAT':'REPLAY_MISMATCH';
    await rejectExpected(replayResearchSnapshot(rehash(saved),{...options,fetcher}),expected);
    expect(requests.every(url=>url.startsWith('https://fixture.invalid/studies/'))).toBe(true);
  });
}
// 36: six distinct distribution failures for every region.
for(let r=0;r<6;r++)for(let failure=0;failure<6;failure++) {
  add('distribution',`${REGIONS[r]}-${failure}`,{region:REGIONS[r],failure},async()=>{
    const study=studies[r]!,site=study.candidates[0]!.site.id;
    const target=failure===0||failure===5?'manifest.json':failure===1?`regions/${REGIONS[r]}/crop.json`:
      failure===2?`regions/${REGIONS[r]}/baseline.json`:failure===3?`regions/${REGIONS[r]}/bridges-summary.json`:
      `regions/${REGIONS[r]}/sites/${site}.json`;
    const fetcher:typeof fetch=async(url,init)=>{
      if(!String(url).endsWith('/'+target))return fixtureFetch(url,init);
      if(failure===0||failure===3)return new Response(null,{status:failure===0?404:500});
      if(failure===1)throw new Error('Injected transport failure');
      const original=bytes.get(target)!;
      if(failure===5)return new Response(new TextDecoder().decode(original).replace('"sourceYear":2021','"sourceYear":2026'));
      return new Response(original.slice(0,original.length-1).buffer);
    };
    const call=failure===4?loadResearchSite(study,site,{...options,fetcher}):loadResearchStudy(REGIONS[r]!,{...options,fetcher});
    await rejectExpected(call,[0,3].includes(failure)?'MISSING_RESOURCE':failure===1?'NETWORK':'HASH_MISMATCH');
  });
}
// 88: all 44 distinct masks/near-neighbour combinations, at two different regions each.
let mapNumber=0;
for(const pattern of ['distributed','edge_first'] as const)for(let lossPercent=0;lossPercent<=50;lossPercent+=5)for(const neighbourhood of [4,8] as const)for(let slot=0;slot<2;slot++) {
  const r=(Math.floor(mapNumber/2)+slot*3)%6;mapNumber++;
  const selection={pattern,lossPercent,neighbourhood};
  add('maps',`${REGIONS[r]}-${pattern}-${lossPercent}-n${neighbourhood}`,{region:REGIONS[r],...selection},()=>{
    const study=studies[r]!,input=mapInput(study,selection),frame=computeMapFrame(input);
    const original=buildScenarioGridCache(study.data.grid).get(`${pattern}-${lossPercent}`)!;
    const patches=extractPatches(original,neighbourhood);
    expect(frame.patches.map(p=>p.cellCount)).toEqual(patches.map(p=>p.cellCount));
    expect(frame.vegetationAreaM2).toBe(study.condition({...selection,lambdaMetres:40}).vegetationAreaM2);
    expect(frame.vegetationAreaM2+frame.removedAreaM2+frame.otherAreaM2).toBe(4000000);
    for(let i=0;i<40000;i++) {
      if((frame.displayMask[i]===1)!==(original.cells[i]==='vegetation'))throw Error('Raster cell differs from the frozen model');
      if((frame.patchLabels[i]!>0)!==(frame.displayMask[i]===1))throw Error('Patch label differs from mask');
      if(frame.originalClasses[i]!==input.originalClasses[i])throw Error('Original source classification changed');
    }
    const a=cellBounds(frame,0,0),b=cellBounds(frame,199,199);
    expect(a.west).toBe(frame.bounds.west);expect(a.north).toBe(frame.bounds.north);
    expect(b.east).toBe(frame.bounds.east);expect(b.south).toBe(frame.bounds.south);
  });
}
// 60 cross-region out-of-order outcomes + 6 cancellation/clear + 6 out-of-order map cases.
for(let a=0;a<6;a++)for(let b=0;b<6;b++)if(a!==b)for(const outcome of ['success','failure'] as const) {
  add('races',`${REGIONS[a]}-then-${REGIONS[b]}-${outcome}`,{first:REGIONS[a],last:REGIONS[b],outcome},async()=>{
    const pending:{resolve:(s:ResearchStudy)=>void;reject:(e:Error)=>void;signal?:AbortSignal}[]=[];
    const session=new ResearchSession((_r,o)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal:o?.signal})));
    const old=session.select(REGIONS[a]!),latest=session.select(REGIONS[b]!);
    expect(pending[0]!.signal?.aborted).toBe(true);expect('study' in session.state).toBe(false);
    if(outcome==='success')pending[1]!.resolve(studies[b]!);else pending[1]!.reject(new Error('Injected newer request failure'));
    await latest;pending[0]!.resolve(studies[a]!);await old;
    expect(session.state.status).toBe(outcome==='success'?'ready':'error');
    expect('regionId' in session.state&&session.state.regionId).toBe(REGIONS[b]);
    if(outcome==='failure')expect('study' in session.state).toBe(false);
  });
}
for(let r=0;r<6;r++) {
  add('races',`${REGIONS[r]}-cancel-clear`,{region:REGIONS[r],operation:'cancel_clear'},async()=>{
    let complete!:(s:ResearchStudy)=>void;
    const session=new ResearchSession(()=>new Promise(resolve=>{complete=resolve;}));
    const pending=session.select(REGIONS[r]!);session.cancel();expect(session.state.status).toBe('cancelled');
    session.clear();complete(studies[r]!);await pending;expect(session.state.status).toBe('idle');
  });
  add('races',`${REGIONS[r]}-map-selection`,{region:REGIONS[r],operation:'map_selection'},async()=>{
    const study=studies[r]!,first={pattern:'distributed' as const,lossPercent:0,neighbourhood:4 as const},last={pattern:'edge_first' as const,lossPercent:50,neighbourhood:8 as const};
    const pending:((f:ReturnType<typeof computeMapFrame>)=>void)[]=[];
    const session=new ResearchMapSession(()=>new Promise(resolve=>pending.push(resolve)));
    const old=session.select(study,first),latest=session.select(study,last);
    expect('frame' in session.state).toBe(false);
    pending[1]!(computeMapFrame(mapInput(study,last)));await latest;
    pending[0]!(computeMapFrame(mapInput(study,first)));await old;
    expect(session.state.status).toBe('ready');expect('selection' in session.state&&session.state.selection).toEqual(last);
  });
}
const invalidSettings=[{lambdaMetres:0},{lambdaMetres:-1},{lambdaMetres:NaN},{lambdaMetres:41},
  {lossPercent:-5},{lossPercent:55},{lossPercent:2.5},{neighbourhood:6}];
for(let r=0;r<6;r++)for(let invalid=0;invalid<8;invalid++)add('invalid_settings',`${REGIONS[r]}-${invalid}`,{region:REGIONS[r],invalid},()=>{
  expect(()=>studies[r]!.condition({...CONDITIONS[0]!,...invalidSettings[invalid]} as never)).toThrow();
});
// 48: six connector and two reference sites per region, under distinct conditions.
for(let r=0;r<6;r++)for(let slot=0;slot<8;slot++) {
  const siteIndex=slot<6?slot:12+(slot-6),a=next(440);
  add('bridges',`${REGIONS[r]}-${siteIndex}`,{region:REGIONS[r],siteIndex,conditionIndex:a},async()=>{
    const study=studies[r]!,entry=study.candidates[siteIndex]!,site=await loadResearchSite(study,entry.site.id,options);
    const result=study.intervention(site,CONDITIONS[a]!),raw=site.results.find(s=>s.scenarioId===CONDITIONS[a]!.scenarioId)!;
    expect(result.result).toEqual(raw);expect(result.addedAreaM2).toBe(400);
    expect(site.results).toHaveLength(440);
    const gains=site.results.map(s=>s.deltaPc).sort((x,y)=>x-y);
    expect(entry.summary.minimumDeltaPc).toBe(gains[0]);expect(entry.summary.maximumDeltaPc).toBe(gains.at(-1));
    const count=site.results.filter(s=>s.afterPatchCount<s.beforePatchCount).length;
    expect(entry.summary.scenariosWithPatchMerger).toBe(count);
    expect(result.topology).toBe(raw.afterPatchCount<raw.beforePatchCount?'patch_merger':raw.afterPatchCount>raw.beforePatchCount?'new_island':'unchanged_patch_count');
    expect(candidateFootprint(study,site.siteId).cells.reduce((sum,c)=>sum+(c.east-c.west)*(c.north-c.south),0)).toBe(400);
    expect(entry.site.sourceClasses.every(c=>c===50||c===60)).toBe(true);
  });
}
const badFiles:[string,()=>string][]=[
  ['empty',()=> ''],['space',()=> ' '],['null',()=> 'null'],['array',()=> '[]'],['object',()=> '{}'],
  ['true',()=> 'true'],['false',()=> 'false'],['zero',()=> '0'],['string',()=> '"hello"'],
  ['truncated',()=> '{'],['missing_value',()=> '{"a":}'],['trailing_comma',()=> '{"a":1,}'],
  ['NaN',()=> '{"a":NaN}'],['Infinity',()=> '{"a":Infinity}'],['overflow_number',()=> '{"a":1e999}'],
  ['comment',()=> '/* JSON? */{}'],['bom',()=> '\uFEFF{}'],['two_objects',()=> '{}{}'],['html',()=> '<html>not JSON</html>'],
  ['proto',()=> '{"__proto__":{}}'],['constructor',()=> '{"constructor":{}}'],['prototype',()=> '{"prototype":{}}'],
  ['ascii_byte_limit',()=> 'x'.repeat(128001)],['utf8_byte_limit',()=> '界'.repeat(43000)],
  ['nesting',()=> '['.repeat(26)+'0'+']'.repeat(26)],['nodes',()=> JSON.stringify(Array(16001).fill(null))],
  ['unsupported_envelope',()=> '{"canonicalization":"different","sha256":"00","payload":{}}'],
  ['missing_payload',()=> '{"canonicalization":"eco3-sorted-json-v1","sha256":"'+'0'.repeat(64)+'"}']
];
for(const [name,value] of badFiles)add('file_bounds',name,{variant:name},async()=>{await expect(parseResearchSnapshot(value())).rejects.toThrow();});

if(cases.length!==1000||new Set(cases.map(c=>c.id)).size!==1000||roundtripKeys.size!==120)throw Error('Expected exactly 1000 unique cases and 120 distinct round-trip queries');
type Observation={id:string;category:string;status:'passed'|'failed';milliseconds:number;error?:string};
const observed:Observation[]=[];
describe('1000 distinct reproducible research cases',()=>{
  for(const c of cases)it(c.id,async()=>{
    const start=performance.now();
    try {await c.run();observed.push({id:c.id,category:c.category,status:'passed',milliseconds:Math.round(performance.now()-start)});}
    catch(error) {
      observed.push({id:c.id,category:c.category,status:'failed',milliseconds:Math.round(performance.now()-start),error:(error instanceof Error?error.message:String(error)).slice(0,320)});
      throw error;
    }
  },30000);
});
afterAll(async()=>{
  const plan=cases.map(({id,category,input})=>({id,category,input}));
  const counts=Object.fromEntries([...new Set(cases.map(c=>c.category))].map(category=>{
    const group=observed.filter(c=>c.category===category);return [category,{planned:cases.filter(c=>c.category===category).length,
      executed:group.length,passed:group.filter(c=>c.status==='passed').length,failed:group.filter(c=>c.status==='failed').length}];
  }));
  const report={schemaVersion:'eco3-stress-1000-v1',seed:SEED,planSha256:digest(JSON.stringify(plan)),sourceFingerprint,
    runtime:process.version,expected:1000,executed:observed.length,passed:observed.filter(c=>c.status==='passed').length,
    failed:observed.filter(c=>c.status==='failed').length,categories:counts,
    limitations:['native_runtime_cases_not_1000_physical_device_runs','browser_matrix_is_a_separate_CI_gate','not_field_ecological_validation'],
    cases:observed};
  await mkdir('.artifacts',{recursive:true});await writeFile('.artifacts/stress-1000.json',JSON.stringify(report,null,2)+'\n');
  console.log('STRESS_1000_AUDIT='+JSON.stringify({...report,cases:undefined}));
  expect(observed).toHaveLength(1000);
});
