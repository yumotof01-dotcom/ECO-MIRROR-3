// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadResearchStudy,loadResearchSite,ResearchStudy,STUDY_RELEASE } from './study.ts';
import { CONDITIONS,conditionId } from './conditions.ts';
import { computeMapFrame,mapInput,cellBounds,candidateFootprint } from './mapData.ts';
import { validateSite } from './validation.ts';
import { ResearchSession } from './session.ts';
import { buildScenarioGridCache } from '../features/landscape/scenarios/engine.ts';
import { extractPatches } from '../features/landscape/core/landscape.ts';
import type { RegionId } from '../studies/verifiedStudyLoader.ts';

type Mutable<T> = {-readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K]};
const cloneMutable=<T,>(value:T):Mutable<T>=>structuredClone(value) as Mutable<T>;
const REGIONS:RegionId[]=['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'];
const root=resolve('public/studies/worldcover-2021-v200');
const fetcher:typeof fetch=async(input)=>{
  const path=String(input).split('/studies/worldcover-2021-v200/')[1];
  if(!path||path.includes('..'))return new Response(null,{status:404});
  try{return new Response(await readFile(resolve(root,path)));}catch{return new Response(null,{status:404});}
};
const options={baseUrl:'https://fixture.invalid/',fetcher};
let studies:ResearchStudy[];
beforeAll(async()=>{studies=await Promise.all(REGIONS.map(r=>loadResearchStudy(r,options)));});

describe('Pre-UI foundation: actual immutable six-region research package',()=>{
  it('pins the manifest independently and resolves all 2,640 settings with no interpolated fallback',async()=>{
    expect(createHash('sha256').update(await readFile(resolve(root,'manifest.json'))).digest('hex')).toBe(STUDY_RELEASE.manifestSha256);
    for(const study of studies) {
      expect(study.conditions()).toHaveLength(440);
      for(const c of CONDITIONS)expect(study.condition(c)).toEqual(study.data.baseline.ensemble.conditions.find(r=>r.scenarioId===c.scenarioId));
      expect(study.conditions({pattern:'distributed',neighbourhood:4,lambdaMetres:40})).toHaveLength(11);
      expect(()=>study.condition({...CONDITIONS[0]!,lambdaMetres:41})).toThrow();
      expect(()=>study.conditions({lossPercent:3})).toThrow();
      expect(()=>study.condition('distributed-n4-lambda40-loss00')).toThrow();
      expect(()=>study.conditions({bogus:1} as never)).toThrow();
    }
  });
  it('returns exact same-region comparisons with changed axes and all 240 model diagnostics',()=>{
    for(const study of studies) {
      for(const c of CONDITIONS) {
        const base={...c,lossPercent:0};
        const comparison=study.compare(base,c);
        expect(comparison.deltaPc).toBe(study.condition(c).pc!-study.condition(base).pc!);
        expect(comparison.provenance.datasetId).toBe(study.data.index.datasetId);
        expect(comparison.changedAxes).toEqual(c.lossPercent===0?[]:['lossPercent']);
      }
      for(const d of study.diagnostics) {
        const curve=study.curve(d);
        expect(curve.points).toHaveLength(11);
        expect(curve.diagnostic).toEqual(d);
        expect(curve.ecologicalThresholdValidated).toBe(false);
      }
    }
  });
  it('preserves every one of the 42,240 intervention results and separates PC gain from patch merger',async()=>{
    let count=0,gainWithoutMerger=0;
    for(const study of studies) {
      expect(study.rankedCandidates()).toHaveLength(12);
      expect(study.rankedCandidates(true).every(c=>c.site.topologicalEffect==='joins_patches_in_both')).toBe(true);
      for(const entry of study.candidates) {
        const site=await loadResearchSite(study,entry.site.id,options);
        const footprint=candidateFootprint(study,site.siteId);
        expect(footprint.cells).toHaveLength(4);
        expect(footprint.cells.reduce((n,c)=>n+(c.east-c.west)*(c.north-c.south),0)).toBe(400);
        for(const r of site.results) {
          const view=study.intervention(site,r.scenarioId);
          expect(view.result).toEqual(r);
          expect(view.condition.scenarioId).toBe(r.scenarioId);
          expect(view.addedAreaM2).toBe(400);
          if(r.deltaPc>1e-12 && r.afterPatchCount>=r.beforePatchCount) {
            expect(view.topology).not.toBe('patch_merger');gainWithoutMerger++;
          }
          count++;
        }
      }
    }
    expect(count).toBe(42240);expect(gainWithoutMerger).toBeGreaterThan(0);
    console.log('RESEARCH_VIEW_AUDIT=PASS '+JSON.stringify({regions:6,conditions:2640,curves:240,interventions:count,gainWithoutMerger}));
  },120000);
  it('prepares all 264 raster/topology frames, exactly matching frozen engine masks and patches',()=>{
    let frames=0;
    for(const study of studies) {
      const expectedMasks=buildScenarioGridCache(study.data.grid);
      for(const pattern of ['distributed','edge_first'] as const)for(let lossPercent=0;lossPercent<=50;lossPercent+=5)for(const neighbourhood of [4,8] as const) {
        const frame=computeMapFrame(mapInput(study,{pattern,lossPercent,neighbourhood}));
        const expected=expectedMasks.get(`${pattern}-${lossPercent}`)!;
        const patches=extractPatches(expected,neighbourhood);
        expect(frame.patches.map(p=>({cellCount:p.cellCount,areaM2:p.areaM2,centroidXMetres:p.centroidXMetres,centroidYMetres:p.centroidYMetres})))
          .toEqual(patches.map(p=>({cellCount:p.cellCount,areaM2:p.areaM2,centroidXMetres:p.centroidXMetres,centroidYMetres:p.centroidYMetres})));
        const baseline=study.condition({pattern,lossPercent,neighbourhood,lambdaMetres:40});
        expect(frame.vegetationAreaM2).toBe(baseline.vegetationAreaM2);
        expect(frame.vegetationAreaM2+frame.removedAreaM2+frame.otherAreaM2).toBe(4000000);
        expect(frame.sourceClassCounts.reduce((n,c)=>n+c.cellCount,0)).toBe(40000);
        const labelCounts=new Uint32Array(patches.length+1);
        for(let i=0;i<40000;i++) {
          if((frame.displayMask[i]===1)!==(expected.cells[i]==='vegetation'))throw Error('wrong stress raster cell');
          if((frame.patchLabels[i]!>0)!==(frame.displayMask[i]===1))throw Error('wrong patch mask');
          if(frame.displayMask[i]===2 && study.data.grid.cells[i]!=='vegetation')throw Error('removed nonvegetation');
          labelCounts[frame.patchLabels[i]!]!++;
        }
        for(const patch of frame.patches)expect(labelCounts[patch.id]).toBe(patch.cellCount);
        expect(cellBounds(frame,0,0)).toEqual({west:frame.bounds.west,east:frame.bounds.west+10,north:frame.bounds.north,south:frame.bounds.north-10});
        const last=cellBounds(frame,199,199);
        expect(last.east).toBe(frame.bounds.east);expect(last.south).toBe(frame.bounds.south);
        expect(()=>cellBounds(frame,200,0)).toThrow();
        frames++;
      }
    }
    expect(frames).toBe(264);
    console.log('RESEARCH_MAP_AUDIT=PASS '+JSON.stringify({frames,cells:frames*40000,coordinateConvention:'easting_x_northing_y_rows_south'}));
  },120000);
  it('rejects semantic contradictions even when previously verified data is copied and changed',()=>{
    const source=studies[0]!.data;
    const mutations=[
      (d:Mutable<typeof source>)=>{d.baseline.ensemble.conditions[0]={...d.baseline.ensemble.conditions[0]!,lambdaMetres:60};},
      (d:Mutable<typeof source>)=>{d.baseline.ensemble.conditions[0]={...d.baseline.ensemble.conditions[0]!,pc:NaN};},
      (d:Mutable<typeof source>)=>{d.baseline.ensemble.conditions[0]={...d.baseline.ensemble.conditions[0]!,actualLossPercent:1};},
      (d:Mutable<typeof source>)=>{d.baseline.ensemble.conditions[0]={...d.baseline.ensemble.conditions[0]!,vegetationAreaM2:0};},
      (d:Mutable<typeof source>)=>{d.baseline.thresholds.curves[0]={...d.baseline.thresholds.curves[0]!,maxDropPc:999};},
      (d:Mutable<typeof source>)=>{d.bridges.evaluated[0]!.site={...d.bridges.evaluated[0]!.site,cells:[0,0,200,201]};},
      (d:Mutable<typeof source>)=>{d.bridges.evaluated[0]!.site={...d.bridges.evaluated[0]!.site,topologicalEffect:'no_direct_patch_join'};},
      (d:Mutable<typeof source>)=>{(d.source as unknown as Record<string,unknown>).projected_northwest_metres=[NaN,0];},
      (d:Mutable<typeof source>)=>{d.grid.cells[0]='unknown';},
      (d:Mutable<typeof source>)=>{d.bridges.modelMetadata.rankedConnectorIds=[];}
    ];
    for(const mutate of mutations) {const copy=cloneMutable(source);mutate(copy);expect(()=>ResearchStudy.fromVerified(copy)).toThrow();}
    expect(Object.isFrozen(source.baseline.ensemble.conditions[0])).toBe(true);
    expect(()=>{(source as Mutable<typeof source>).baseline.ensemble.conditions[0]!.pc=0;}).toThrow();
  });
  it('rejects altered site outcomes, changed summaries, foreign regions and unknown candidates',async()=>{
    const study=studies[0]!,site=await loadResearchSite(study,study.candidates[0]!.site.id,options);
    const invalid=cloneMutable(site);invalid.results[0]!.afterPc=1.1;
    expect(()=>validateSite(study.data,invalid)).toThrow();
    const other=cloneMutable(site);other.sourceDatasetId=studies[1]!.data.index.datasetId;
    expect(()=>study.intervention(other,CONDITIONS[0]!)).toThrow();
    expect(()=>candidateFootprint(study,'missing')).toThrow();
    await expect(loadResearchSite(study,'missing',options)).rejects.toThrow();
  });
  it('rejects replaced manifests, modified payloads, missing resources and pre-cancelled loads',async()=>{
    const corrupt:typeof fetch=async(input,init)=>{
      const r=await fetcher(input,init);
      if(String(input).endsWith('/manifest.json'))return new Response((await r.text()).replace('© ESA','changed © ESA'));
      return r;
    };
    await expect(loadResearchStudy('shinjuku',{...options,fetcher:corrupt})).rejects.toMatchObject({reason:'HASH_MISMATCH'});
    const broken:typeof fetch=async(input,init)=>String(input).endsWith('/baseline.json')?new Response('{}'):fetcher(input,init);
    await expect(loadResearchStudy('shinjuku',{...options,fetcher:broken})).rejects.toMatchObject({reason:'HASH_MISMATCH'});
    const absent:typeof fetch=async()=>new Response(null,{status:404});
    await expect(loadResearchStudy('shinjuku',{...options,fetcher:absent})).rejects.toMatchObject({reason:'MISSING_RESOURCE'});
    const controller=new AbortController();controller.abort();
    await expect(loadResearchStudy('shinjuku',{...options,signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
  });
  it('never shows an old region after a newer load, failure, cancellation or clear',async()=>{
    const pending=new Map<RegionId,{resolve:(s:ResearchStudy)=>void;reject:(e:Error)=>void}>();
    const loader:typeof loadResearchStudy=r=>new Promise((resolve,reject)=>pending.set(r,{resolve,reject}));
    const session=new ResearchSession(loader);
    const first=session.select('shinjuku'),second=session.select('osaka');
    expect(session.state).toEqual({status:'loading',regionId:'osaka'});
    pending.get('osaka')!.resolve(studies[1]!);await second;
    pending.get('shinjuku')!.resolve(studies[0]!);await first;
    expect(session.state.status).toBe('ready');expect('regionId' in session.state&&session.state.regionId).toBe('osaka');
    const failed=session.select('nagoya');expect(session.state).toEqual({status:'loading',regionId:'nagoya'});
    pending.get('nagoya')!.reject(new Error('offline'));await failed;expect(session.state.status).toBe('error');
    const cancelled=session.select('sapporo');session.cancel();pending.get('sapporo')!.resolve(studies[4]!);await cancelled;
    expect(session.state).toEqual({status:'cancelled',regionId:'sapporo'});
    session.clear();expect(session.state).toEqual({status:'idle'});
    expect(new Set(CONDITIONS.map(conditionId)).size).toBe(440);
  });
});
