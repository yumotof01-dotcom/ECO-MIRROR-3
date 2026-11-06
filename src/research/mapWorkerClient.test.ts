// @vitest-environment node
import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadResearchStudy} from './study.ts';
import type {ResearchStudy} from './study.ts';
import {prepareResearchMap} from './mapWorkerClient.ts';
import {computeMapFrame} from './mapData.ts';
import type {MapInput} from './mapData.ts';

let study:ResearchStudy;
const selection={pattern:'distributed' as const,lossPercent:0,neighbourhood:4 as const};
beforeAll(async()=>{
  study=await loadResearchStudy('shinjuku',{baseUrl:'https://fixture.invalid/',fetcher:async(input)=>
    new Response(await readFile(resolve('public',new URL(String(input)).pathname.slice(1))))});
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
function workerStub(mode:'ok'|'foreign'|'messageerror'|'error'|'crash'|'silent'|'post-failure') {
  const workers:FakeWorker[]=[];
  class FakeWorker {
    terminated=false;
    onmessage:((event:{data:unknown})=>void)|null=null;
    onerror:(()=>void)|null=null;
    onmessageerror:(()=>void)|null=null;
    constructor(){workers.push(this);}
    terminate(){this.terminated=true;}
    postMessage(input:MapInput) {
      if(mode==='post-failure')throw new Error('DataCloneError');
      queueMicrotask(()=>{
        if(mode==='silent')return;
        if(mode==='crash'){this.onerror?.();return;}
        if(mode==='messageerror'){this.onmessageerror?.();return;}
        if(mode==='error'){this.onmessage?.({data:{status:'error',message:'bad data'}});return;}
        const frame=computeMapFrame(input);
        if(mode==='foreign')frame.regionId='osaka';
        this.onmessage?.({data:{status:'ready',frame}});
      });
    }
  }
  vi.stubGlobal('Worker',FakeWorker);
  return workers;
}
describe('Worker lifecycle and failure boundary',()=>{
  it('resolves the matching dataset and terminates worker after completion',async()=>{
    const workers=workerStub('ok');
    expect((await prepareResearchMap(study,selection)).datasetId).toBe(study.data.index.datasetId);
    expect(workers[0]!.terminated).toBe(true);
  });
  it('fails explicitly for a foreign region, broken payload, worker crash and post failure',async()=>{
    for(const mode of ['foreign','messageerror','error','crash','post-failure'] as const) {
      const workers=workerStub(mode);
      await expect(prepareResearchMap(study,selection)).rejects.toThrow();
      expect(workers[0]!.terminated).toBe(true);
    }
  });
  it('cancels in-flight and pre-cancelled requests without retaining an active worker',async()=>{
    const workers=workerStub('silent');
    const controller=new AbortController();
    const result=prepareResearchMap(study,selection,controller.signal);controller.abort();
    await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(workers[0]!.terminated).toBe(true);
    await expect(prepareResearchMap(study,selection,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(workers).toHaveLength(1);
  });
  it('terminates stalled workers after a bounded timeout and reports missing worker support',async()=>{
    vi.useFakeTimers();const workers=workerStub('silent');
    const result=prepareResearchMap(study,selection);
    const checked=expect(result).rejects.toThrow('30 seconds');
    await vi.advanceTimersByTimeAsync(30000);await checked;
    expect(workers[0]!.terminated).toBe(true);
    vi.stubGlobal('Worker',undefined);
    await expect(prepareResearchMap(study,selection)).rejects.toThrow('Web Worker required');
  });
});
