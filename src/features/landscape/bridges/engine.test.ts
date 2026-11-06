import { describe, expect, it } from "vitest";
import { runExhaustiveScenarios } from "../scenarios/engine.ts";
import { runBridgeExperiment } from "./engine.ts";
import type { LandscapeGrid } from "../core/types.ts";

function fixture(){
  const w=32,h=32,raw=new Uint8Array(w*h).fill(50);
  const cells:Array<"vegetation"|"other">=Array(w*h).fill("other");
  const plant=(x:number,y:number)=>{
    const i=y*w+x;cells[i]="vegetation";raw[i]=10;
  };
  // Two disjoint 3x3 patches with a 2x2 gap for conversion.
  for(let y=14;y<17;y++)for(let x=9;x<12;x++)plant(x,y);
  for(let y=14;y<17;y++)for(let x=14;x<17;x++)plant(x,y);
  // Deliberate water rectangle (must never become a candidate).
  for(let y=23;y<25;y++)for(let x=23;x<25;x++)raw[y*w+x]=80;
  const grid:LandscapeGrid={width:w,height:h,resolutionMetres:10,crs:"EPSG:6677",
    datasetId:"synthetic-only-phase4",sourceVersion:"test-v1",sourceSha256:"c".repeat(64),cells};
  return {grid,raw};
}
describe("hypothetical 4-cell intervention, all 440 Phase-2 conditions",()=>{
  it("compares all 440 before/after cases for each selected site",()=>{
    const {grid,raw}=fixture();
    const before=runExhaustiveScenarios(grid);
    const report=runBridgeExperiment(grid,raw,before,{maxConnectors:2,maxReferences:1});
    expect(report.status).toBe("complete");
    expect(report.scenarioCount).toBe(440);
    expect(report.selectedConnectorFootprintsCount).toBeGreaterThan(0);
    expect(report.rankedConnectorIds).toHaveLength(report.selectedConnectorFootprintsCount);
    expect(report.ecologicalInterventionEffectsValidated).toBe(0);
    expect(report.rankedDirectBridgeIds.length).toBeGreaterThan(0);
    for(const id of report.rankedDirectBridgeIds){
      const site=report.evaluated.find(x=>x.site.id===id)!.site;
      expect(site.adjacentPatchCount4).toBeGreaterThanOrEqual(2);
      expect(site.adjacentPatchCount8).toBeGreaterThanOrEqual(2);
      expect(site.topologicalEffect).toBe("joins_patches_in_both");
    }
    expect(report.siteFeasibility).toBe("not_assessed");
    for(const result of report.evaluated){
      expect(result.results).toHaveLength(440);
      expect(result.summary.count).toBe(440);
      expect(result.summary.positiveConditions+result.summary.negativeConditions+result.summary.zeroConditions).toBe(440);
      expect(result.summary.scenariosWithPatchMerger+result.summary.scenariosWithoutPatchCountChange+
        result.summary.scenariosCreatingNewIsland).toBe(440);
      expect(result.site.cells).toHaveLength(4);
      expect(result.site.addedAreaM2).toBe(400);
      expect(result.site.sourceClasses.every(c=>c===50||c===60)).toBe(true);
      for(const condition of result.results){
        expect(condition.afterVegetationAreaM2-condition.beforeVegetationAreaM2).toBe(400);
        expect(condition.patchesJoined).toBe(Math.max(0,condition.beforePatchCount-condition.afterPatchCount));
        expect(condition.afterPc-condition.beforePc).toBeCloseTo(condition.deltaPc,14);
      }
    }
  });
  it("is fully deterministic, including shortlist tie-breaking",()=>{
    const {grid,raw}=fixture(),base=runExhaustiveScenarios(grid);
    const a=runBridgeExperiment(grid,raw,base,{maxConnectors:2,maxReferences:1});
    const b=runBridgeExperiment(grid,raw,base,{maxConnectors:2,maxReferences:1});
    expect(a).toEqual(b);
  });
  it("does not permit water or missing raw pixels as conversion sites",()=>{
    const {grid,raw}=fixture(),base=runExhaustiveScenarios(grid);
    const r=runBridgeExperiment(grid,raw,base,{maxConnectors:3,maxReferences:2});
    expect(r.evaluated.flatMap(x=>x.site.cells).every(i=>raw[i]!==80)).toBe(true);
    raw[0]=255;
    expect(()=>runBridgeExperiment(grid,raw,base)).toThrow(/source land-cover code/);
  });
  it("rejects mismatch between raw classes, baseline and derived vegetation mask",()=>{
    const {grid,raw}=fixture(),base=runExhaustiveScenarios(grid);
    raw[0]=10;
    expect(()=>runBridgeExperiment(grid,raw,base)).toThrow(/conflict/);
    raw[0]=50;
    expect(()=>runBridgeExperiment(grid,raw,{...base,status:"incomplete"})).toThrow(/baseline/);
    expect(()=>runBridgeExperiment(grid,raw,{...base,conditions:base.conditions.slice(1)})).toThrow(/missing or duplicated/);
  });
  it("fails explicitly rather than claiming a bridge when there are no two patches",()=>{
    const {grid,raw}=fixture();
    const empty:LandscapeGrid={...grid,cells:grid.cells.map(()=>"other")};
    const noPlants=new Uint8Array(raw.length).fill(50);
    const base=runExhaustiveScenarios(empty);
    expect(()=>runBridgeExperiment(empty,noPlants,base)).toThrow(/no structurally eligible connector/);
  });
});
