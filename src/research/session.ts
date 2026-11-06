import { loadResearchStudy, throwIfCancelled } from './study.ts';
import type { ResearchStudy } from './study.ts';
import type { RegionId, StudyLoadOptions } from '../studies/verifiedStudyLoader.ts';

export type ResearchState =
  | {status:'idle'}
  | {status:'loading';regionId:RegionId}
  | {status:'ready';regionId:RegionId;study:ResearchStudy}
  | {status:'error';regionId:RegionId;error:Error}
  | {status:'cancelled';regionId:RegionId};
/** UI-independent latest-request state. Changing region clears old results immediately. */
export class ResearchSession {
  private current:ResearchState=Object.freeze({status:'idle'});
  private revision=0;
  private controller:AbortController|null=null;
  get state():ResearchState {return this.current;}
  constructor(private readonly loader:typeof loadResearchStudy=loadResearchStudy) {}
  async select(regionId:RegionId,options:Omit<StudyLoadOptions,'signal'>={}):Promise<ResearchState> {
    const revision=++this.revision;
    this.controller?.abort();
    const controller=new AbortController();this.controller=controller;
    this.current=Object.freeze({status:'loading',regionId});
    try {
      const study=await this.loader(regionId,{...options,signal:controller.signal});
      throwIfCancelled(controller.signal);
      if(revision===this.revision) {
        if(study.data.regionId!==regionId)throw new Error('Selected region and loaded study disagree');
        this.current=Object.freeze({status:'ready',regionId,study});
      }
    } catch(error) {
      if(revision===this.revision) this.current=controller.signal.aborted?
        Object.freeze({status:'cancelled',regionId}):
        Object.freeze({status:'error',regionId,error:error instanceof Error?error:new Error(String(error))});
    }
    return this.current;
  }
  cancel():void {
    ++this.revision;this.controller?.abort();this.controller=null;
    if(this.current.status==='loading')this.current=Object.freeze({status:'cancelled',regionId:this.current.regionId});
  }
  clear():void {this.cancel();this.current=Object.freeze({status:'idle'});}
}
