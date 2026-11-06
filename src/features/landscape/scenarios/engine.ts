import { assessLandscape } from "../core/landscape.ts";
import type { LandscapeGrid, Neighbourhood } from "../core/types.ts";

export type DisturbancePattern = "distributed" | "edge_first";
/** Scientific sensitivity settings, NOT measured dispersal ranges or climate forecasts. */
export const LAMBDA_METRES = [40,60,90,135,200,300,450,675,1000,1500] as const;
/** Fraction of original vegetation cells converted to other: 0 through 50%, step 5%. */
export const LOSS_PERCENT = [0,5,10,15,20,25,30,35,40,45,50] as const;
export const NEIGHBOURHOODS = [4,8] as const;
export const PATTERNS = ["distributed","edge_first"] as const;

export interface ScenarioSettings {
  readonly lambdaMetres: number;
  readonly lossPercent: number;
  readonly neighbourhood: Neighbourhood;
  readonly pattern: DisturbancePattern;
}
export interface ScenarioRecord extends ScenarioSettings {
  readonly scenarioId: string;
  readonly status: "STRUCTURAL_ONLY" | "NOT_ESTIMABLE";
  readonly pc: number | null;
  readonly vegetationAreaM2: number | null;
  readonly errorReason: string | null;
  readonly actualLossPercent: number | null;
}
export interface EnsembleResult {
  readonly schemaVersion: "landscape-scenarios-v1";
  readonly status: "complete" | "incomplete";
  readonly expectedCount: number;
  readonly calculatedCount: number;
  readonly sourceId: string;
  readonly sourceSha256: string;
  readonly conditions: readonly ScenarioRecord[];
  readonly scientificMeaning: "hypothetical_stress_tests_not_forecast_probabilities";
}

/** No random API: stable integer hash ranking indexed by row-major coordinate. */
function mix32(index: number, seed: number): number {
  let x = Math.imul((index+1) ^ seed, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
function vegetationIndices(grid: LandscapeGrid, pattern: DisturbancePattern): number[] {
  const indices:number[]=[];
  for (let i=0;i<grid.cells.length;i++)if(grid.cells[i]==="vegetation")indices.push(i);
  const width=grid.width,height=grid.height;
  const edgeScore=(index:number):number=>{
    const x=index%width,y=Math.floor(index/width);
    let contacts=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=x+dx,ny=y+dy;
      if(nx<0||nx>=width||ny<0||ny>=height||grid.cells[ny*width+nx]!=="vegetation")contacts++;
    }
    return contacts;
  };
  const seed=0x42e1bade;
  if (pattern==="distributed")indices.sort((a,b)=>mix32(a,seed)-mix32(b,seed)||a-b);
  else indices.sort((a,b)=>edgeScore(b)-edgeScore(a)||mix32(a,seed)-mix32(b,seed)||a-b);
  return indices;
}
/** Nested stress condition: cells already removed at 5% remain removed at 10%. */
export function applyVegetationLoss(grid:LandscapeGrid, orderedVegetation:readonly number[], lossPercent:number):LandscapeGrid {
  if(!Number.isInteger(lossPercent)||lossPercent<0||lossPercent>100)throw new RangeError("invalid vegetation loss");
  const removeCount=Math.round(orderedVegetation.length*lossPercent/100);
  const cells=grid.cells.slice();
  for(let i=0;i<removeCount;i++)cells[orderedVegetation[i]!] = "other";
  return {...grid,cells};
}
export function enumerateConditions(): readonly ScenarioSettings[] {
  const conditions:ScenarioSettings[]=[];
  for (const pattern of PATTERNS)
    for (const neighbourhood of NEIGHBOURHOODS)
      for (const lambdaMetres of LAMBDA_METRES)
        for (const lossPercent of LOSS_PERCENT)
          conditions.push({pattern,neighbourhood,lambdaMetres,lossPercent});
  return conditions;
}
function idFor(x:ScenarioSettings):string{
  return x.pattern+"-n"+x.neighbourhood+"-lambda"+x.lambdaMetres+"-loss"+x.lossPercent;
}
/** Shared source of truth for the EXACT Phase 2 disturbance masks.
 * Using this for interventions prevents baseline/after scenario drift.
 * Cache keys are pattern+"-"+lossPercent.
 */
export function buildScenarioGridCache(grid:LandscapeGrid):ReadonlyMap<string,LandscapeGrid> {
  const ranks=Object.fromEntries(PATTERNS.map(pattern=>[pattern,vegetationIndices(grid,pattern)])) as Record<DisturbancePattern,number[]>;
  const stressed=new Map<string,LandscapeGrid>();
  for(const pattern of PATTERNS)for(const lossPercent of LOSS_PERCENT)
    stressed.set(pattern+"-"+lossPercent,applyVegetationLoss(grid,ranks[pattern],lossPercent));
  return stressed;
}
export function runExhaustiveScenarios(grid:LandscapeGrid):EnsembleResult {
  const conditions=enumerateConditions();
  const output:ScenarioRecord[]=[];
  // Strict initial preflight; failure still records every defined experiment as not estimable.
  const preflight=assessLandscape(grid,4,LAMBDA_METRES[0]);
  if(preflight.status!=="STRUCTURAL_ONLY"){
    for(const x of conditions)output.push({...x,scenarioId:idFor(x),status:"NOT_ESTIMABLE",
      pc:null,vegetationAreaM2:null,actualLossPercent:null,errorReason:preflight.reason});
    return {schemaVersion:"landscape-scenarios-v1",status:"incomplete",
      expectedCount:conditions.length,calculatedCount:0,
      sourceId:grid.datasetId,sourceSha256:grid.sourceSha256,conditions:output,
      scientificMeaning:"hypothetical_stress_tests_not_forecast_probabilities"};
  }
  const originalVegetation=grid.cells.filter(c=>c==="vegetation").length;
  // Cache vegetation rankings per pattern to avoid changing the removal ordering with q.
  const stressed=buildScenarioGridCache(grid);
  for(const x of conditions){
    const altered=stressed.get(x.pattern+"-"+x.lossPercent)!;
    const result=assessLandscape(altered,x.neighbourhood,x.lambdaMetres);
    const remaining=altered.cells.filter(c=>c==="vegetation").length;
    output.push({...x,scenarioId:idFor(x),status:result.status,
      pc:result.status==="STRUCTURAL_ONLY"?result.pc:null,
      vegetationAreaM2:result.status==="STRUCTURAL_ONLY"?result.vegetationAreaM2:null,
      errorReason:result.status==="NOT_ESTIMABLE"?result.reason:null,
      actualLossPercent:originalVegetation?100*(originalVegetation-remaining)/originalVegetation:null
    });
  }
  const count=output.filter(r=>r.status==="STRUCTURAL_ONLY").length;
  return {schemaVersion:"landscape-scenarios-v1",
    status:count===conditions.length?"complete":"incomplete",
    expectedCount:conditions.length,calculatedCount:count,
    sourceId:grid.datasetId,sourceSha256:grid.sourceSha256,conditions:output,
    scientificMeaning:"hypothetical_stress_tests_not_forecast_probabilities"};
}
