import type {ResearchStudy} from './study.ts';
import {conditionId} from './conditions.ts';
import {prepareResearchMap} from './mapWorkerClient.ts';
import type {MapFrame,MapSelection} from './mapData.ts';
type Binding={regionId:string;datasetId:string;selection:Readonly<MapSelection>};
export type ResearchMapState=
  | {status:'idle'}
  | ({status:'loading'}&Binding)
  | ({status:'ready';frame:MapFrame}&Binding)
  | ({status:'cancelled'}&Binding)
  | ({status:'error';error:Error}&Binding);
/** Automatically invalidate old map data on condition OR region changes. */
export class ResearchMapSession {
  private current:ResearchMapState=Object.freeze({status:'idle'});
  private revision=0;
  private controller:AbortController|null=null;
  constructor(private readonly loader:typeof prepareResearchMap=prepareResearchMap) {}
  get state():ResearchMapState {return this.current;}
  async select(study:ResearchStudy,selection:MapSelection):Promise<ResearchMapState> {
    conditionId({...selection,lambdaMetres:40});
    const revision=++this.revision;
    this.controller?.abort();const controller=new AbortController();this.controller=controller;
    const binding=Object.freeze({regionId:study.data.regionId,datasetId:study.data.index.datasetId,selection:Object.freeze({...selection})});
    this.current=Object.freeze({status:'loading',...binding});
    try {
      const frame=await this.loader(study,binding.selection,controller.signal);
      if(revision===this.revision&&!controller.signal.aborted) {
        if(frame.datasetId!==binding.datasetId||frame.regionId!==binding.regionId||
          frame.selection.pattern!==binding.selection.pattern||frame.selection.neighbourhood!==binding.selection.neighbourhood||
          frame.selection.lossPercent!==binding.selection.lossPercent)throw new Error('Map result binding mismatch');
        this.current=Object.freeze({status:'ready',...binding,frame});
      }
    } catch(error) {
      if(revision===this.revision)this.current=controller.signal.aborted?Object.freeze({status:'cancelled',...binding}):
        Object.freeze({status:'error',...binding,error:error instanceof Error?error:new Error(String(error))});
    }
    return this.current;
  }
  cancel() {
    ++this.revision;this.controller?.abort();this.controller=null;
    if(this.current.status==='loading') {
      const {regionId,datasetId,selection}=this.current;this.current=Object.freeze({status:'cancelled',regionId,datasetId,selection});
    }
  }
  clear() {this.cancel();this.current=Object.freeze({status:'idle'});}
}
