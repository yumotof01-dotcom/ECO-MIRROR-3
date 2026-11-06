import { assessLandscape, extractPatches } from "../core/landscape.ts";
import type { LandscapeGrid, Neighbourhood } from "../core/types.ts";
import { buildScenarioGridCache, enumerateConditions } from "../scenarios/engine.ts";
import type { EnsembleResult, ScenarioSettings } from "../scenarios/engine.ts";

/** Class numbers are unchanged ESA WorldCover 2021 v200 source pixel values. */
const VEGETATED = new Set([10, 20, 30, 40, 90, 95, 100]);
const NOT_VEGETATED = new Set([50, 60, 70, 80]);
/** Only built-up and bare/sparse are used for hypothetical conversions.
 * Excludes source water code 80, woodland, crops and other pre-existing vegetation.
 * This does NOT imply the land can legally or practically be converted.
 */
const HYPOTHETICALLY_CONVERTIBLE = new Set([50, 60]);
const LARGEST_CANDIDATES = 12;
const CONTROL_CANDIDATES = 4;
const FOOTPRINT_SIDE_CELLS = 2;
const MIN_EDGE_MARGIN_CELLS = 8;
const NEARBY_RADIUS_CELLS = 5;
const MIN_NEARBY_PATCH_CELLS = 3;

export type CandidateRole = "hypothetical_connector" | "equal_area_reference";
export interface InterventionSite {
  readonly id: string;
  readonly role: CandidateRole;
  readonly x: number;
  readonly y: number;
  readonly cells: readonly number[];
  readonly sourceClasses: readonly number[];
  readonly addedAreaM2: number;
  readonly nearbyPatchCount: number;
  readonly adjacentPatchCount4: number;
  readonly adjacentPatchCount8: number;
  readonly topologicalEffect: "joins_patches_in_both" | "joins_patches_in_4_only" | "joins_patches_in_8_only" | "no_direct_patch_join";
  readonly nearestSecondPatchDistanceM: number | null;
  readonly selectionScore: number;
  readonly disclaimer: "hypothetical_land_cover_conversion_only";
}
export interface InterventionResult {
  readonly scenarioId: string;
  readonly beforePc: number;
  readonly afterPc: number;
  readonly deltaPc: number;
  readonly beforeVegetationAreaM2: number;
  readonly afterVegetationAreaM2: number;
  readonly beforePatchCount: number;
  readonly afterPatchCount: number;
  /** Positive only when formerly separate landscape patches are joined. */
  readonly patchesJoined: number;
}
export interface InterventionSummary {
  readonly count: number;
  readonly minimumDeltaPc: number;
  readonly lowerDecileDeltaPc: number;
  readonly medianDeltaPc: number;
  readonly maximumDeltaPc: number;
  readonly positiveConditions: number;
  readonly negativeConditions: number;
  readonly zeroConditions: number;
  readonly scenariosWithPatchMerger: number;
  readonly scenariosWithoutPatchCountChange: number;
  readonly scenariosCreatingNewIsland: number;
  readonly assessment: "POSITIVE_UNDER_ALL_DEFINED_CONDITIONS" | "MIXED_OR_NONPOSITIVE_MODEL_EFFECT";
}
export interface EvaluatedIntervention {
  readonly site: InterventionSite;
  readonly resultCount: number;
  readonly results: readonly InterventionResult[];
  readonly summary: InterventionSummary;
}
export interface BridgeExperiment {
  readonly schemaVersion: "landscape-interventions-v1";
  readonly status: "complete";
  readonly sourceDatasetId: string;
  readonly sourceRasterSha256: string;
  readonly landcoverTimeReference: "ESA WorldCover 2021";
  readonly scenarioCount: number;
  readonly sourcePixelCandidatesCount: number;
  readonly connectorEligibleFootprintsCount: number;
  readonly selectedConnectorFootprintsCount: number;
  readonly selectedReferenceFootprintsCount: number;
  readonly selectionMethod: "all_even_2x2_footprints_then_tile_stratified_deterministic_shortlist";
  readonly evaluated: readonly EvaluatedIntervention[];
  readonly rankedConnectorIds: readonly string[];
  readonly rankedDirectBridgeIds: readonly string[];
  readonly modelValidation: "not_validated_for_real_species_or_intervention";
  readonly siteFeasibility: "not_assessed";
  readonly ecologicalInterventionEffectsValidated: 0;
  readonly interpretation: string;
}

function require(condition: unknown, reason: string): asserts condition {
  if(!condition)throw new RangeError("LANDSCAPE_INTERVENTION_INVALID: "+reason);
}
function validateOriginalClasses(grid:LandscapeGrid, classCodes:Uint8Array): void {
  require(classCodes instanceof Uint8Array && classCodes.length===grid.cells.length,"original 2021 class codes are required");
  for(let i=0;i<grid.cells.length;i++){
    const code=classCodes[i]!;
    require(VEGETATED.has(code)||NOT_VEGETATED.has(code),"unrecognized source land-cover code");
    const derived=VEGETATED.has(code)?"vegetation":"other";
    require(grid.cells[i]===derived,"raw classes conflict with independently hashed vegetation mask");
  }
}
function nearbyLabels(grid:LandscapeGrid, neighbourhood:Neighbourhood):{ ids:Int32Array;sizes:number[] } {
  const ids=new Int32Array(grid.cells.length); // 0 means non-vegetation
  const sizes:number[]=[];
  for(let start=0;start<ids.length;start++){
    if(ids[start]||grid.cells[start]!=="vegetation")continue;
    const id=sizes.length+1,queue=[start];ids[start]=id;
    for(let head=0;head<queue.length;head++){
      const here=queue[head]!,x=here%grid.width,y=Math.floor(here/grid.width);
      const moves=neighbourhood===4 ? [[1,0],[-1,0],[0,1],[0,-1]] :
        [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      for(const [dx,dy] of moves){
        const nx=x+dx!,ny=y+dy!;
        if(nx<0||ny<0||nx>=grid.width||ny>=grid.height)continue;
        const next=ny*grid.width+nx;
        if(!ids[next]&&grid.cells[next]==="vegetation"){ids[next]=id;queue.push(next);}
      }
    }
    sizes.push(queue.length);
  }
  return {ids,sizes};
}
function constructSite(grid:LandscapeGrid,classes:Uint8Array,labels:Int32Array,labels8:Int32Array,
  sizes:readonly number[],x:number,y:number):InterventionSite | null {
  const cells=[y*grid.width+x,y*grid.width+x+1,(y+1)*grid.width+x,(y+1)*grid.width+x+1];
  if(!cells.every(i=>grid.cells[i]==="other"&&HYPOTHETICALLY_CONVERTIBLE.has(classes[i]!)))return null;
  const nearby=new Map<number,number>();
  const r=NEARBY_RADIUS_CELLS;
  for(let yy=Math.max(0,y-r);yy<Math.min(grid.height,y+FOOTPRINT_SIDE_CELLS+r);yy++){
    for(let xx=Math.max(0,x-r);xx<Math.min(grid.width,x+FOOTPRINT_SIDE_CELLS+r);xx++){
      const label=labels[yy*grid.width+xx]!;
      if(!label||sizes[label-1]!<MIN_NEARBY_PATCH_CELLS)continue;
      const distance=Math.hypot(
        Math.max(0,xx-(x+0.5), (x+0.5)-(xx+1)),
        Math.max(0,yy-(y+0.5), (y+0.5)-(yy+1))
      );
      if(!nearby.has(label)||distance<nearby.get(label)!)nearby.set(label,distance);
    }
  }
  const distances=[...nearby.values()].sort((a,b)=>a-b);
  const nearbyPatchCount=distances.length;
  const orthogonal=[[x-1,y],[x-1,y+1],[x+2,y],[x+2,y+1],
    [x,y-1],[x+1,y-1],[x,y+2],[x+1,y+2]];
  const all8:number[][]=[];
  for(let yy=y-1;yy<=y+2;yy++)for(let xx=x-1;xx<=x+2;xx++){
    if(xx>=x && xx<=x+1 && yy>=y && yy<=y+1)continue;
    all8.push([xx,yy]);
  }
  const adjacentLabels=(positions:readonly (readonly number[])[],map:Int32Array)=>{
    const found=new Set<number>();
    for(const [xx,yy] of positions){
      if(xx<0||yy<0||xx>=grid.width||yy>=grid.height)continue;
      const index=map[yy*grid.width+xx]!;
      if(index>0)found.add(index);
    }
    return found.size;
  };
  const adjacentPatchCount4=adjacentLabels(orthogonal,labels);
  const adjacentPatchCount8=adjacentLabels(all8,labels8);
  const topologicalEffect=adjacentPatchCount4>=2 && adjacentPatchCount8>=2 ?
    "joins_patches_in_both" : adjacentPatchCount4>=2 ? "joins_patches_in_4_only" :
    adjacentPatchCount8>=2 ? "joins_patches_in_8_only" : "no_direct_patch_join";
  const role:CandidateRole=nearbyPatchCount>=2?"hypothetical_connector":"equal_area_reference";
  const second=distances.length>=2?distances[1]!:null;
  const selectionScore=role==="hypothetical_connector"
    ? 1000*(adjacentPatchCount4>=2 ? 1 : 0)+1000*(adjacentPatchCount8>=2 ? 1 : 0)+
      100*nearbyPatchCount-10*(second??10)-Math.min(...distances)
    : (distances[0]??100);
  return {
    id:(role==="hypothetical_connector"?"connector":"reference")+"-x"+x+"-y"+y,
    role,x,y,cells,sourceClasses:cells.map(i=>classes[i]!),
    addedAreaM2:cells.length*grid.resolutionMetres**2,
    nearbyPatchCount,adjacentPatchCount4,adjacentPatchCount8,topologicalEffect,
    nearestSecondPatchDistanceM:second===null?null:second*grid.resolutionMetres,
    selectionScore,disclaimer:"hypothetical_land_cover_conversion_only"
  };
}
function selectTileDiverse(sites:readonly InterventionSite[],max:number,w:number,h:number,role:CandidateRole):InterventionSite[] {
  if(max===0)return [];
  const eligible=sites.filter(s=>s.role===role);
  const sorted=[...eligible].sort((a,b)=>{
    const diff=role==="hypothetical_connector" ? b.selectionScore-a.selectionScore : b.selectionScore-a.selectionScore;
    return diff || a.y-b.y || a.x-b.x;
  });
  const selected:InterventionSite[]=[],visited=new Set<string>();
  for(const site of sorted){
    const key=Math.floor(site.x/(w/5))+"-"+Math.floor(site.y/(h/5));
    if(visited.has(key))continue;
    selected.push(site);visited.add(key);
    if(selected.length===max)break;
  }
  return selected;
}
function quantile(values:readonly number[],q:number):number{
  require(values.length>0,"quantile needs data");
  const sorted=[...values].sort((a,b)=>a-b);
  const index=(sorted.length-1)*q,lower=Math.floor(index),higher=Math.ceil(index);
  return sorted[lower]!+(sorted[higher]!-sorted[lower]!)*(index-lower);
}
function summarize(results:readonly InterventionResult[]):InterventionSummary{
  require(results.length>0,"empty candidate result");
  const gains=results.map(x=>x.deltaPc);
  const epsilon=1e-12;
  const positive=gains.filter(d=>d>epsilon).length;
  const negative=gains.filter(d=>d< -epsilon).length;
  const zero=gains.length-positive-negative;
  return {count:gains.length,minimumDeltaPc:Math.min(...gains),
    lowerDecileDeltaPc:quantile(gains,0.10),
    medianDeltaPc:quantile(gains,0.5),
    maximumDeltaPc:Math.max(...gains),
    positiveConditions:positive,negativeConditions:negative,zeroConditions:zero,
    scenariosWithPatchMerger:results.filter(r=>r.afterPatchCount<r.beforePatchCount).length,
    scenariosWithoutPatchCountChange:results.filter(r=>r.afterPatchCount===r.beforePatchCount).length,
    scenariosCreatingNewIsland:results.filter(r=>r.afterPatchCount>r.beforePatchCount).length,
    assessment:negative===0&&zero===0?"POSITIVE_UNDER_ALL_DEFINED_CONDITIONS":"MIXED_OR_NONPOSITIVE_MODEL_EFFECT"};
}
function key(x:ScenarioSettings):string{
  return x.pattern+"-n"+x.neighbourhood+"-lambda"+x.lambdaMetres+"-loss"+x.lossPercent;
}
/** Fair, identical 4-cell additions on every one of the Phase-2 scenarios. */
export function runBridgeExperiment(grid:LandscapeGrid,rawClassCodes:Uint8Array,
  baseline:EnsembleResult,options?:{maxConnectors?:number;maxReferences?:number}):BridgeExperiment {
  validateOriginalClasses(grid,rawClassCodes);
  const conditions=enumerateConditions();
  require(baseline.status==="complete"&&baseline.sourceId===grid.datasetId&&
    baseline.sourceSha256===grid.sourceSha256,"baseline identity or completeness mismatch");
  const indices=new Map(baseline.conditions.map((r)=>[r.scenarioId,r]));
  require(indices.size===conditions.length&&baseline.conditions.length===conditions.length&&
    baseline.calculatedCount===conditions.length,"missing or duplicated 440-condition reference");
  for(const s of conditions){
    const r=indices.get(key(s));
    require(r && r.status==="STRUCTURAL_ONLY" && r.pc!==null &&
      Number.isFinite(r.pc) && r.vegetationAreaM2!==null &&
      r.lambdaMetres===s.lambdaMetres&&r.lossPercent===s.lossPercent&&
      r.pattern===s.pattern&&r.neighbourhood===s.neighbourhood,"invalid reference row");
  }
  const maxConnectors=options?.maxConnectors??LARGEST_CANDIDATES;
  const maxReferences=options?.maxReferences??CONTROL_CANDIDATES;
  require(Number.isInteger(maxConnectors)&&maxConnectors>=1&&maxConnectors<=32 &&
    Number.isInteger(maxReferences)&&maxReferences>=0&&maxReferences<=8,"invalid candidate bounds");
  const {ids,sizes}=nearbyLabels(grid,4);
  const {ids:ids8}=nearbyLabels(grid,8);
  const eligible:InterventionSite[]=[];
  // Even-grid anchors provide disjoint 2×2 cells and a deterministic, auditable search universe.
  for(let y=MIN_EDGE_MARGIN_CELLS;y+FOOTPRINT_SIDE_CELLS<=grid.height-MIN_EDGE_MARGIN_CELLS;y+=2)
    for(let x=MIN_EDGE_MARGIN_CELLS;x+FOOTPRINT_SIDE_CELLS<=grid.width-MIN_EDGE_MARGIN_CELLS;x+=2){
      const site=constructSite(grid,rawClassCodes,ids,ids8,sizes,x,y);
      if(site)eligible.push(site);
    }
  const bridges=selectTileDiverse(eligible,maxConnectors,grid.width,grid.height,"hypothetical_connector");
  const references=selectTileDiverse(eligible,maxReferences,grid.width,grid.height,"equal_area_reference");
  require(bridges.length>0,"no structurally eligible connector candidates");
  const stressed=buildScenarioGridCache(grid);
  // Source maps are identical for every lambda. Count patches once per pattern/loss/neighbourhood.
  const originalPatchCounts=new Map<string,number>();
  for(const setting of conditions){
    const maskKey=setting.pattern+"-"+setting.lossPercent;
    const countKey=maskKey+"-n"+setting.neighbourhood;
    if(!originalPatchCounts.has(countKey))
      originalPatchCounts.set(countKey,extractPatches(stressed.get(maskKey)!,setting.neighbourhood).length);
  }
  const evaluated:EvaluatedIntervention[]=[];
  for(const site of [...bridges,...references]){
    const records:InterventionResult[]=[];
    for(const setting of conditions){
      const id=key(setting),original=indices.get(id)!;
      const stressedGrid=stressed.get(setting.pattern+"-"+setting.lossPercent)!;
      require(site.cells.every(i=>stressedGrid.cells[i]==="other"),"site footprint changed in scenario");
      const cells=stressedGrid.cells.slice();
      for(const i of site.cells)cells[i]="vegetation";
      const after=assessLandscape({...stressedGrid,cells},setting.neighbourhood as Neighbourhood,setting.lambdaMetres);
      require(after.status==="STRUCTURAL_ONLY","candidate intervention could not be calculated");
      require(Math.abs((after.vegetationAreaM2-original.vegetationAreaM2!)-site.addedAreaM2)<1e-8,
        "unequal or missing-area intervention");
      const countBefore=originalPatchCounts.get(setting.pattern+"-"+setting.lossPercent+"-n"+setting.neighbourhood)!;
      const countAfter=after.patches.length;
      records.push({scenarioId:id,beforePc:original.pc!,afterPc:after.pc,deltaPc:after.pc-original.pc!,
        beforeVegetationAreaM2:original.vegetationAreaM2!,afterVegetationAreaM2:after.vegetationAreaM2,
        beforePatchCount:countBefore,afterPatchCount:countAfter,
        patchesJoined:Math.max(0,countBefore-countAfter)});
    }
    evaluated.push({site,resultCount:records.length,results:records,summary:summarize(records)});
  }
  const ranked=[...evaluated].filter(x=>x.site.role==="hypothetical_connector").sort((a,b)=>
    b.summary.lowerDecileDeltaPc-a.summary.lowerDecileDeltaPc ||
    b.summary.medianDeltaPc-a.summary.medianDeltaPc ||
    a.site.id.localeCompare(b.site.id));
  return {
    schemaVersion:"landscape-interventions-v1",status:"complete",
    sourceDatasetId:grid.datasetId,sourceRasterSha256:grid.sourceSha256,
    landcoverTimeReference:"ESA WorldCover 2021",scenarioCount:conditions.length,
    sourcePixelCandidatesCount:eligible.length,
    connectorEligibleFootprintsCount:eligible.filter(x=>x.role==="hypothetical_connector").length,
    selectedConnectorFootprintsCount:bridges.length,selectedReferenceFootprintsCount:references.length,
    selectionMethod:"all_even_2x2_footprints_then_tile_stratified_deterministic_shortlist",
    evaluated,rankedConnectorIds:ranked.map(x=>x.site.id),
    rankedDirectBridgeIds:ranked.filter(x=>x.site.topologicalEffect==="joins_patches_in_both").map(x=>x.site.id),
    modelValidation:"not_validated_for_real_species_or_intervention",
    siteFeasibility:"not_assessed",ecologicalInterventionEffectsValidated:0,
    interpretation:"These are identical 2x2-cell hypothetical land-cover conversions. Each scenario separately records whether patch components actually merge, remain unchanged, or create a new isolated patch; a positive PC score alone does not prove bridging. Only sites that merge distinct source patches in BOTH 4 and 8 connectivity may be called direct topological bridges; other candidates are stepping-stones or area extensions. Rankings cover a transparent shortlist, NOT every physically possible location. All 440 sensitivity conditions were computed for each selected site. Built-up/bare classes do not establish land access, suitability or ecological effect. Baseline has no movement buffer, and connectivity uses centroid distances."
  };
}
