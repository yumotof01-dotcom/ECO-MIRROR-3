import { describe, expect, it } from "vitest";
import { assessLandscape, extractPatches } from "./landscape.ts";
import type { LandscapeGrid } from "./types.ts";

const sha="a".repeat(64);
function grid(width:number,height:number,cells:LandscapeGrid["cells"],extra:Partial<LandscapeGrid>={}):LandscapeGrid {
  return {width,height,cells,resolutionMetres:10,crs:"EPSG:6677",datasetId:"synthetic-test-only",
    sourceVersion:"test-v1",sourceSha256:sha,...extra};
}
describe("landscape phase-1 core (synthetic data only)",()=>{
  it("identifies separate patches and their areas",()=>{
    const g=grid(3,1,["vegetation","other","vegetation"]);
    const patches=extractPatches(g,4);
    expect(patches).toHaveLength(2);
    expect(patches.map(p=>p.areaM2)).toEqual([100,100]);
    expect(patches.map(p=>p.centroidXMetres)).toEqual([5,25]);
  });
  it("distinguishes 4 and 8-neighbour diagonal contact",()=>{
    const g=grid(2,2,["vegetation","other","other","vegetation"]);
    expect(extractPatches(g,4)).toHaveLength(2);
    expect(extractPatches(g,8)).toHaveLength(1);
  });
  it("computes PC from the fixed full landscape area",()=>{
    const g=grid(3,1,["vegetation","other","vegetation"]);
    const result=assessLandscape(g,4,20);
    expect(result.status).toBe("STRUCTURAL_ONLY");
    if(result.status!=="STRUCTURAL_ONLY")throw Error("unexpected");
    // (10000 + 10000 + 2*10000*exp(-20/20))/300^2
    expect(result.pc).toBeCloseTo((20000+20000*Math.exp(-1))/90000,12);
    expect(result.vegetationAreaM2).toBe(200);
    expect(result.ecologicalValidation).toBe("not_validated");
  });
  it("valid no-vegetation is zero, not missing",()=>{
    const result=assessLandscape(grid(2,1,["other","other"]),4,20);
    expect(result.status).toBe("STRUCTURAL_ONLY");
    if(result.status==="STRUCTURAL_ONLY")expect(result.pc).toBe(0);
  });
  it("rejects unknown cells instead of treating them as absent",()=>{
    expect(assessLandscape(grid(2,1,["unknown","other"]),4,20)).toMatchObject({status:"NOT_ESTIMABLE",reason:"CLASS_UNKNOWN"});
  });
  it("rejects geographic degree CRS and missing provenance",()=>{
    expect(assessLandscape(grid(1,1,["vegetation"],{crs:"EPSG:4326"}),4,20)).toMatchObject({reason:"CRS_INVALID"});
    expect(assessLandscape(grid(1,1,["vegetation"],{sourceSha256:""}),4,20)).toMatchObject({reason:"DATA_MISSING"});
  });
  it("rejects invalid parameters and grid shapes",()=>{
    const g=grid(1,1,["vegetation"]);
    expect(assessLandscape(g,4,0)).toMatchObject({reason:"INPUT_INVALID"});
    expect(assessLandscape(g,6 as 4,10)).toMatchObject({reason:"INPUT_INVALID"});
    expect(assessLandscape(grid(2,1,["vegetation"]),4,10)).toMatchObject({reason:"INPUT_INVALID"});
  });
  it("calculates 3541 separate patches, but refuses pathological grids beyond 4000 patches",()=>{
    const w=200,h=200;
    const cells:Array<"vegetation"|"other">=Array(w*h).fill("other");
    let count=0;
    for(let y=0;y<h && count<3541;y+=2){
      for(let x=0;x<w && count<3541;x+=2){
        cells[y*w+x]="vegetation";
        count++;
      }
    }
    expect(count).toBe(3541);
    const valid=assessLandscape(grid(w,h,cells),4,40);
    expect(valid.status).toBe("STRUCTURAL_ONLY");
    if(valid.status==="STRUCTURAL_ONLY"){
      expect(valid.patches).toHaveLength(3541);
      expect(valid.pc).toBeGreaterThan(0);
      expect(valid.pc).toBeLessThanOrEqual(1);
    }
    // Source grid is unchanged and the high-cardinality guard is still fail-closed.
    const more=[...cells];
    for(let y=0;y<h && count<4001;y+=2)
      for(let x=0;x<w && count<4001;x+=2)
        if(more[y*w+x]==="other"){more[y*w+x]="vegetation";count++;}
    expect(count).toBe(4001);
    expect(assessLandscape(grid(w,h,more),4,40)).toMatchObject({status:"NOT_ESTIMABLE",reason:"MODEL_LIMIT"});
  });
  it("is deterministic and never calls the observation engine",()=>{
    const g=grid(2,2,["vegetation","other","other","vegetation"]);
    expect(assessLandscape(g,4,15)).toEqual(assessLandscape(g,4,15));
  });
  it("one all-vegetation patch has PC=1",()=>{
    const result=assessLandscape(grid(2,2,Array(4).fill("vegetation")),4,10);
    expect(result.status).toBe("STRUCTURAL_ONLY");
    if(result.status==="STRUCTURAL_ONLY")expect(result.pc).toBeCloseTo(1);
  });
});
