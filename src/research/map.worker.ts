/// <reference lib="webworker" />
import { computeMapFrame } from './mapData.ts';
import type { MapInput } from './mapData.ts';

declare const self:DedicatedWorkerGlobalScope;
self.onmessage=(event:MessageEvent<MapInput>)=>{
  try {
    const frame=computeMapFrame(event.data);
    self.postMessage({status:'ready',frame},[frame.originalClasses.buffer,frame.displayMask.buffer,frame.patchLabels.buffer]);
  } catch(error) {
    self.postMessage({status:'error',message:error instanceof Error?error.message:'Map preparation failed'});
  }
};
