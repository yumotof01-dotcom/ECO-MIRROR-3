import { describe, expect, it } from "vitest";
import { applyVegetationLoss, enumerateConditions, runExhaustiveScenarios } from "./engine.ts";
import { detectModelChangeIntervals } from "../thresholds/detect.ts";
import type { LandscapeGrid } from "../core/types.ts";

const grid: LandscapeGrid={
  datasetId:"synthetic-for-math-only",sourceVersion:"unit-test",sourceSha256:"b".repeat(64),
  crs:"EPSG:6677",width:10,height:10,resolutionMetres:10,
  cells:Array.from({length:100},(_,i)=>i%10<4 || i%10>7 ? "vegetation" as const:"other" as const)
};
describe("exhaustive, finite 440-combination landscape stress experiment",()=>{
  it("enumerates exactly 10x11x2x2; never caps at 100",()=>{
    const conditions=enumerateConditions();
    expect(conditions).toHaveLength(440);
    expect(new Set(conditions.map(c=>JSON.stringify(c))).size).toBe(440);
    expect(conditions.map(c=>c.lossPercent).filter(q=>q===50)).toHaveLength(40);
  });
  it("removal is nested and never invents new vegetation cells",()=>{
    const ordered=[0,1,2,3,4,5,6,7,8,9];
    const g:LandscapeGrid={...grid,width:10,height:1,cells:Array(10).fill("vegetation")};
    const a=applyVegetationLoss(g,ordered,10);
    const b=applyVegetationLoss(g,ordered,30);
    expect(g.cells.every(c=>c==="vegetation")).toBe(true);
    expect(a.cells.filter(c=>c==="other")).toHaveLength(1);
    expect(b.cells.filter(c=>c==="other")).toHaveLength(3);
    expect(a.cells.every((c,i)=>c==="vegetation"||b.cells[i]==="other")).toBe(true);
  });
  it("calculates all 440, provenance preserved, no ecological probability",()=>{
    const a=runExhaustiveScenarios(grid);
    expect(a.status).toBe("complete");
    expect(a.calculatedCount).toBe(440);
    expect(a.conditions).toHaveLength(440);
    expect(a.sourceId).toBe(grid.datasetId);
    expect(a.sourceSha256).toBe(grid.sourceSha256);
    expect(a.conditions.every(r=>r.pc!==null && r.pc>=0 && r.pc<=1)).toBe(true);
    expect(a.scientificMeaning).toBe("hypothetical_stress_tests_not_forecast_probabilities");
    const report=detectModelChangeIntervals(a);
    expect(report.testedCurves).toBe(40);
    expect(report.completeCurves).toBe(40);
    expect(report.ecologicalThresholdsValidated).toBe(0);
  });
  it("same inputs always return byte-equivalent conditions",()=>{
    expect(runExhaustiveScenarios(grid)).toEqual(runExhaustiveScenarios(grid));
  });
  it("failure does not drop 440 planned experiments",()=>{
    const bad: LandscapeGrid={...grid,cells:[...grid.cells.slice(0,99),"unknown"]};
    const result=runExhaustiveScenarios(bad);
    expect(result.status).toBe("incomplete");
    expect(result.expectedCount).toBe(440);
    expect(result.calculatedCount).toBe(0);
    expect(result.conditions.every(c=>c.pc===null && c.errorReason==="CLASS_UNKNOWN")).toBe(true);
    const report=detectModelChangeIntervals(result);
    expect(report.status).toBe("incomplete");
    expect(report.curves.every(c=>c.status==="INCOMPLETE_CURVE")).toBe(true);
  });
  it("missing single scenario blocks a complete response curve",()=>{
    const all=runExhaustiveScenarios(grid);
    const shortened={...all,conditions:all.conditions.slice(1)};
    const report=detectModelChangeIntervals(shortened);
    expect(report.status).toBe("incomplete");
    expect(report.curves.some(c=>c.status==="INCOMPLETE_CURVE")).toBe(true);
  });
  it("does not call zero-Pc baseline an ecological tipping point",()=>{
    const none:LandscapeGrid={...grid,cells:Array(100).fill("other")};
    const report=detectModelChangeIntervals(runExhaustiveScenarios(none));
    expect(report.testedCurves).toBe(40);
    expect(report.curves.every(c=>c.status==="UNDEFINED_BASELINE")).toBe(true);
    expect(report.ecologicalThresholdsValidated).toBe(0);
  });
});
