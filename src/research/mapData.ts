import type { LandscapeGrid, Neighbourhood, Patch } from '../features/landscape/core/types.ts';
import type { DisturbancePattern } from '../features/landscape/scenarios/engine.ts';
import { buildScenarioGridCache } from '../features/landscape/scenarios/engine.ts';
import { conditionId } from './conditions.ts';
import { requireStudy, originalClasses, isVegetated } from './validation.ts';
import type { ResearchStudy } from './study.ts';

export const LANDCOVER_LEGEND = Object.freeze([
  [10,'樹木被覆'],[20,'低木地'],[30,'草地'],[40,'農地'],[50,'建造物'],[60,'裸地・疎植生'],
  [70,'雪氷'],[80,'恒久水域'],[90,'草本湿地'],[95,'マングローブ'],[100,'コケ・地衣類']
].map(([code,label])=>Object.freeze({code:code as number,label:label as string,vegetationCandidate:isVegetated(code as number)})));
export interface MapSelection { pattern:DisturbancePattern; lossPercent:number; neighbourhood:Neighbourhood }
export interface MapInput {
  regionId:string; grid:LandscapeGrid; originalClasses:Uint8Array;
  northwest:readonly [number,number]; selection:MapSelection;
}
export interface MapFrame {
  regionId:string; datasetId:string; sourceSha256:string; crs:string; observationYear:2021;
  width:number; height:number; resolutionMetres:number;
  northwest:readonly [number,number]; bounds:Readonly<{west:number;east:number;south:number;north:number}>;
  selection:MapSelection;
  /** Original ESA classes never change under a hypothetical loss scenario. */
  originalClasses:Uint8Array;
  /** Row-major: 0 original other, 1 remaining vegetation candidate, 2 hypothetically removed. */
  displayMask:Uint8Array;
  /** 0 = no vegetation patch; patch IDs start at 1. No biological movement edges. */
  patchLabels:Uint32Array;
  patches:readonly (Patch & {eastingMetres:number;northingMetres:number})[];
  vegetationAreaM2:number; removedAreaM2:number; otherAreaM2:number;
  sourceClassCounts:readonly {code:number;label:string;cellCount:number;areaM2:number}[];
  scientificStatus:'structural_landcover_only';
}
export function mapInput(study:ResearchStudy,selection:MapSelection):MapInput {
  conditionId({...selection,lambdaMetres:40});
  const northwest=(study.data.source as unknown as {projected_northwest_metres:[number,number]}).projected_northwest_metres;
  return {regionId:study.data.regionId,grid:study.data.grid,originalClasses:originalClasses(study.data),
    northwest:[...northwest],selection:{...selection}};
}
/** Worker/CLI only. Never call this raster processing routine on the browser UI thread. */
export function computeMapFrame(input:MapInput):MapFrame {
  const {grid,selection,northwest}=input;
  conditionId({...selection,lambdaMetres:40});
  requireStudy(grid.width===200&&grid.height===200&&grid.resolutionMetres===10&&grid.cells.length===40000 &&
    input.originalClasses.length===40000&&northwest.length===2&&northwest.every(Number.isFinite), 'map input dimensions/affine');
  for(let i=0;i<40000;i++) {
    requireStudy(LANDCOVER_LEGEND.some(c=>c.code===input.originalClasses[i]) &&
      grid.cells[i]===(isVegetated(input.originalClasses[i]!)?'vegetation':'other'), 'map source classification');
  }
  const stressed=buildScenarioGridCache(grid).get(`${selection.pattern}-${selection.lossPercent}`);
  requireStudy(stressed,'missing stress mask');
  const mask=new Uint8Array(40000),labels=new Uint32Array(40000);
  let vegetation=0,removed=0;
  for(let i=0;i<mask.length;i++) {
    mask[i]=stressed.cells[i]==='vegetation'?1:grid.cells[i]==='vegetation'?2:0;
    if(mask[i]===1)vegetation++;
    if(mask[i]===2)removed++;
  }
  const dirs=selection.neighbourhood===4?[[1,0],[-1,0],[0,1],[0,-1]]:
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const patches:MapFrame['patches'][number][]=[];
  // A bounded typed queue makes worst-case raster working memory explicit.
  const queue=new Uint32Array(mask.length);
  for(let start=0;start<mask.length;start++) {
    if(mask[start]!==1||labels[start])continue;
    const id=patches.length+1;
    let tail=1,head=0,sumX=0,sumY=0;
    queue[0]=start;labels[start]=id;
    while(head<tail) {
      const here:number=queue[head++]!,x:number=here%grid.width,y:number=Math.floor(here/grid.width);
      sumX+=(x+.5)*10;sumY+=(y+.5)*10;
      for(const [dx,dy] of dirs) {
        const xx:number=x+dx!,yy:number=y+dy!;
        if(xx<0||yy<0||xx>=grid.width||yy>=grid.height)continue;
        const next=yy*grid.width+xx;
        if(mask[next]===1&&!labels[next]) { labels[next]=id;queue[tail++]=next; }
      }
    }
    patches.push({id,cellCount:tail,areaM2:tail*100,centroidXMetres:sumX/tail,centroidYMetres:sumY/tail,
      eastingMetres:northwest[0]+sumX/tail,northingMetres:northwest[1]-sumY/tail});
  }
  return {regionId:input.regionId,datasetId:grid.datasetId,sourceSha256:grid.sourceSha256,crs:grid.crs,observationYear:2021,
    width:200,height:200,resolutionMetres:10,northwest:[...northwest],
    bounds:{west:northwest[0],east:northwest[0]+2000,north:northwest[1],south:northwest[1]-2000},
    selection:{...selection},originalClasses:new Uint8Array(input.originalClasses),displayMask:mask,patchLabels:labels,patches,
    vegetationAreaM2:vegetation*100,removedAreaM2:removed*100,otherAreaM2:(40000-vegetation-removed)*100,
    sourceClassCounts:LANDCOVER_LEGEND.map(c=>{const count=input.originalClasses.reduce((n,v)=>n+(v===c.code?1:0),0);
      return {...c,cellCount:count,areaM2:count*100};}),scientificStatus:'structural_landcover_only'};
}
/** Grid columns increase east; rows increase south. EPSG native axis order is not used here. */
export function cellBounds(frame:Pick<MapFrame,'width'|'height'|'northwest'|'resolutionMetres'>,column:number,row:number) {
  requireStudy(Number.isInteger(column)&&Number.isInteger(row)&&column>=0&&row>=0&&column<frame.width&&row<frame.height,'cell outside map');
  const west=frame.northwest[0]+column*frame.resolutionMetres,north=frame.northwest[1]-row*frame.resolutionMetres;
  return Object.freeze({west,east:west+frame.resolutionMetres,north,south:north-frame.resolutionMetres});
}
export function candidateFootprint(study:ResearchStudy,siteId:string) {
  const site=study.candidates.find(c=>c.site.id===siteId)?.site;
  requireStudy(site,'candidate not from selected region');
  const northwest=(study.data.source as unknown as {projected_northwest_metres:[number,number]}).projected_northwest_metres;
  const geometry={width:200,height:200,northwest,resolutionMetres:10};
  return Object.freeze({provenance:study.provenance,siteId,addedAreaM2:400 as const,
    cells:Object.freeze(site.cells.map(index=>Object.freeze({index,sourceClass:originalClasses(study.data)[index]!,
      ...cellBounds(geometry,index%200,Math.floor(index/200))}))),
    feasibility:'not_assessed' as const});
}
