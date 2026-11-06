/** Falsification-oriented landscape audit. Node 24; no dependencies or artificial data in UI.
 * Real crop is used for corruption attacks; synthetic microgrids for mathematical properties.
 * node --experimental-strip-types scripts/landscape/stress-adversarial.mjs /tmp/crop.json
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { verifyWorldcoverWindow } from "../../src/features/landscape/data/window.ts";
import { assessLandscape, extractPatches } from "../../src/features/landscape/core/landscape.ts";
import { runExhaustiveScenarios, enumerateConditions } from "../../src/features/landscape/scenarios/engine.ts";
import { detectModelChangeIntervals } from "../../src/features/landscape/thresholds/detect.ts";

const source=process.argv[2];
if(!source)throw Error("Pass the path of a real, SHA-audited 2021 COG crop");
const crop=JSON.parse(await readFile(source,"utf8"));
const start=performance.now();
let corruptions=0,properties=0,failClosed=0;
function elapsed(){return Math.round(performance.now()-start);}
async function rejects(window,expected){
  await assert.rejects(verifyWorldcoverWindow(window),expected);
  failClosed++;
}
const grid=await verifyWorldcoverWindow(crop);
assert.equal(grid.width*grid.height,crop.width*crop.height);
assert.equal(enumerateConditions().length,440);

// Mutation/adversarial tests against real geospatial input, each independently hashed.
const fraction=grid.cells.length;
for(let step=0;step<256;step++){
  const pos=(step*8191)%fraction;
  const row=Math.floor(pos/grid.width);
  const column=pos%grid.width;
  const rows=crop.rows.slice();
  const a=rows[row][column],b=a==="V"?"O":"V";
  rows[row]=rows[row].slice(0,column)+b+rows[row].slice(column+1);
  await rejects({...crop,rows},/mask was modified/);
  corruptions++;
}
for(const replacement of [
  {...crop,source_url:"https://not-official.invalid/2021.tif"},
  {...crop,source_product:"ESA WorldCover 2020 v100"},
  {...crop,license:"not a license"},
  {...crop,attribution:""},
  {...crop,source_full_tile_sha256:"0".repeat(64)},
  {...crop,derived_binary_mask_sha256:"0".repeat(64)},
  {...crop,derived_pixel_class_sha256:"??"},
  {...crop,rows:crop.rows.slice(1)},
  {...crop,width:0},
  {...crop,height:0},
  {...crop,resolution_metres:-10},
  {...crop,rows:[crop.rows[0].replace(/./,"?"),...crop.rows.slice(1)]}
]){
  await assert.rejects(verifyWorldcoverWindow(replacement));
  corruptions++;failClosed++;
}
// CRS is accepted as metadata by the dataset loader, rejected by the calculator.
const badCrs={...grid,crs:"EPSG:4326"};
assert.deepEqual(assessLandscape(badCrs,4,100).reason,"CRS_INVALID");failClosed++;
const damagedCells=[...grid.cells];damagedCells[Math.floor(damagedCells.length/2)]="unknown";
const damaged={...grid,cells:damagedCells};
const refusal=runExhaustiveScenarios(damaged);
assert.equal(refusal.calculatedCount,0);
assert.equal(refusal.expectedCount,440);
assert.equal(refusal.conditions.length,440);
assert.ok(refusal.conditions.every(x=>x.pc===null&&x.errorReason==="CLASS_UNKNOWN"));
assert.equal(detectModelChangeIntervals(refusal).status,"incomplete");
failClosed++;

// Valid zero vegetation and invalid nodata are genuinely different.
const meta={datasetId:"synthetic-stress-only",sourceVersion:"test-v1",
  sourceSha256:"a".repeat(64),crs:"EPSG:6677",resolutionMetres:10};
assert.equal(assessLandscape({...meta,width:10,height:10,cells:Array(100).fill("other")},4,100).pc,0);
assert.equal(assessLandscape({...meta,width:10,height:10,cells:Array(100).fill("vegetation")},8,100).pc,1);
assert.equal(assessLandscape({...meta,width:10,height:10,cells:Array(99).fill("vegetation")},4,100).reason,"INPUT_INVALID");
failClosed++;

// 5,000 deterministically generated *synthetic* microgrids; they are not field data.
let rng=0x456789ab;
const next=()=>{
  rng^=rng<<13; rng^=rng>>>17; rng^=rng<<5;
  return rng>>>0;
};
let minPc=1,maxPc=0;
for(let t=0;t<5000;t++){
  const width=8,height=8;
  const cells=Array.from({length:64},()=>next()%100<53?"vegetation":"other");
  const g={...meta,width,height,cells};
  const lower=assessLandscape(g,4,40);
  const upper=assessLandscape(g,4,400);
  assert.equal(lower.status,"STRUCTURAL_ONLY");
  assert.equal(upper.status,"STRUCTURAL_ONLY");
  assert.ok(lower.pc>=-1e-12 && lower.pc<=1+1e-12);
  assert.ok(upper.pc+1e-12>=lower.pc, "Increased lambda decreased PC on fixed patches");
  const vegetated=cells.filter(x=>x==="vegetation").length;
  const pcCeiling=(vegetated/64)**2;
  assert.ok(upper.pc<=pcCeiling+1e-12,
    "Area-normalized PC exceeded an all-patches-fully-connected upper bound");
  const patches=extractPatches(g,4);
  assert.equal(patches.reduce((n,p)=>n+p.cellCount,0),vegetated);
  minPc=Math.min(minPc,lower.pc);
  maxPc=Math.max(maxPc,upper.pc);
  properties+=5;
}
// Deliberate 160,000-cell checkerboard must refuse >3000 patch pairwise work.
const n=400;
const checker=Array.from({length:n*n},(_,i)=>((Math.floor(i/n)+(i%n))%2===0)?"vegetation":"other");
const checkerResult=assessLandscape({...meta,width:n,height:n,cells:checker},4,40);
assert.equal(checkerResult.status,"NOT_ESTIMABLE");
assert.equal(checkerResult.reason,"MODEL_LIMIT");failClosed++;
// One immense patch must remain bounded and have PC=1.
const full=assessLandscape({...meta,width:n,height:n,cells:Array(n*n).fill("vegetation")},4,40);
assert.equal(full.status,"STRUCTURAL_ONLY");
assert.ok(Math.abs(full.pc-1)<1e-12);properties++;
// Caller must not mistake an oversized grid for an empty one.
const tooLarge=assessLandscape({...meta,width:1001,height:1001,cells:Array(1001*1001).fill("other")},4,40);
assert.equal(tooLarge.status,"NOT_ESTIMABLE");
assert.equal(tooLarge.reason,"MODEL_LIMIT");failClosed++;

console.log("LANDSCAPE_ADVERSARIAL_AUDIT="+JSON.stringify({
  realSource:crop.dataset_id,
  genuinePixelCount:grid.cells.length,
  mutatedSourceCases:corruptions,
  deliberateFailureChecks:failClosed,
  syntheticPropertyAssertions:properties,
  syntheticMicrogrids:5000,
  syntheticGridCells:5000*64,
  giantSyntheticProbeCells:n*n,
  invalidGiantProbeCells:1001*1001,
  modelLimitedHighPatchCount:true,
  modelLimitedOversizedGrid:true,
  pureCalculation:"no mutation of original real raster",
  wallMilliseconds:elapsed(),
  peakRssMb:Math.round(process.memoryUsage().rss/1024/1024),
  result:"PASS",
  noFieldEcologyClaim:true
}));
