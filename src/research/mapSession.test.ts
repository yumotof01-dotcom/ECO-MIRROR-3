// @vitest-environment node
import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadResearchStudy} from './study.ts';
import type {ResearchStudy} from './study.ts';
import {ResearchMapSession} from './mapSession.ts';
import {computeMapFrame,mapInput} from './mapData.ts';
import type {MapFrame} from './mapData.ts';
import type {prepareResearchMap} from './mapWorkerClient.ts';
let study:ResearchStudy;
beforeAll(async()=>{study=await loadResearchStudy('shinjuku',{baseUrl:'http://fixture.invalid/',fetcher:async input=>new Response(await readFile(resolve('public','.'+new URL(String(input)).pathname)))});});
const firstSelection={pattern:'distributed' as const,lossPercent:0,neighbourhood:4 as const};
const secondSelection={pattern:'edge_first' as const,lossPercent:50,neighbourhood:8 as const};
it('clears old frames immediately, ignores obsolete completion and snapshots mutable caller settings',async()=>{
  const pending:{resolve:(f:MapFrame)=>void;reject:(e:Error)=>void;signal?:AbortSignal}[]=[];
  const loader:typeof prepareResearchMap=(_s,_q,signal)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal}));
  const session=new ResearchMapSession(loader),mutable={...firstSelection};
  const first=session.select(study,mutable);mutable.lossPercent=50;
  expect('selection' in session.state&&session.state.selection.lossPercent).toBe(0);
  const second=session.select(study,secondSelection);
  expect(pending[0]!.signal!.aborted).toBe(true);expect('frame' in session.state).toBe(false);
  pending[1]!.resolve(computeMapFrame(mapInput(study,secondSelection)));await second;
  pending[0]!.resolve(computeMapFrame(mapInput(study,firstSelection)));await first;
  expect(session.state.status).toBe('ready');expect('selection' in session.state&&session.state.selection.lossPercent).toBe(50);
  const failed=session.select(study,firstSelection);pending[2]!.reject(new Error('worker failed'));await failed;
  expect(session.state.status).toBe('error');expect('frame' in session.state).toBe(false);
  const cancelled=session.select(study,firstSelection);session.cancel();pending[3]!.resolve(computeMapFrame(mapInput(study,firstSelection)));await cancelled;
  expect(session.state.status).toBe('cancelled');session.clear();expect(session.state.status).toBe('idle');
});
it('rejects a worker response from another selection before showing results',async()=>{
  const session=new ResearchMapSession(async()=>computeMapFrame(mapInput(study,secondSelection)));
  await session.select(study,firstSelection);expect(session.state.status).toBe('error');expect('frame' in session.state).toBe(false);
});
