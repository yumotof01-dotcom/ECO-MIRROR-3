import type { ResearchStudy } from './study.ts';
import { throwIfCancelled } from './study.ts';
import { mapInput } from './mapData.ts';
import type { MapFrame, MapSelection } from './mapData.ts';

/** One cancellable worker per request; terminating it interrupts even synchronous CPU work. */
export async function prepareResearchMap(study:ResearchStudy,selection:MapSelection,signal?:AbortSignal):Promise<MapFrame> {
  throwIfCancelled(signal);
  const input=mapInput(study,selection);
  return new Promise((resolve,reject)=>{
    if(typeof Worker==='undefined') {reject(new Error('Web Worker required for raster processing'));return;}
    const worker=new Worker(new URL('./map.worker.ts',import.meta.url),{type:'module'});
    let done=false;
    const finish=(error:Error|null,frame?:MapFrame)=>{
      if(done)return;
      done=true;clearTimeout(timeout);signal?.removeEventListener('abort',cancel);worker.terminate();
      if(error)reject(error);else resolve(frame!);
    };
    const cancel=()=>finish(new DOMException('Map request cancelled','AbortError'));
    const timeout=setTimeout(()=>finish(new Error('Map preparation exceeded 30 seconds')),30000);
    signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>{
      const msg=event.data;
      if(msg?.status==='error')finish(new Error(msg.message));
      else if(msg?.status==='ready' && msg.frame?.regionId===study.data.regionId && msg.frame?.datasetId===study.data.index.datasetId &&
        msg.frame?.sourceSha256===study.data.index.derivedPixelClassSha256 &&
        msg.frame?.selection.pattern===selection.pattern && msg.frame?.selection.lossPercent===selection.lossPercent &&
        msg.frame?.selection.neighbourhood===selection.neighbourhood)finish(null,msg.frame);
      else finish(new Error('Map worker returned an unexpected region or selection'));
    };
    worker.onerror=()=>finish(new Error('Map worker failed'));
    worker.onmessageerror=()=>finish(new Error('Map worker response could not be decoded'));
    if(signal?.aborted){cancel();return;}
    try {worker.postMessage(input,[input.originalClasses.buffer]);} catch(error) {finish(error instanceof Error?error:new Error(String(error)));}
  });
}
