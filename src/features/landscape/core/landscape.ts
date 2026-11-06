import type { CellClass, LandscapeAssessment, LandscapeGrid, Neighbourhood, Patch } from "./types.ts";

const SHA256 = /^[a-f0-9]{64}$/i;
const EPSG_METRIC_JAPAN = /^EPSG:(?:66(?:6[9]|7[0-9]|8[0-7]))$/;
/** Accept only known JGD2011 Japan Plane Rectangular CS zones EPSG:6669–6687. */
function checkGrid(grid: LandscapeGrid): { reason: "DATA_MISSING" | "CLASS_UNKNOWN" | "CRS_INVALID" | "INPUT_INVALID" | "MODEL_LIMIT"; detail: string } | null {
  if (!grid || !Array.isArray(grid.cells) || !grid.datasetId?.trim() || !grid.sourceVersion?.trim() || !SHA256.test(grid.sourceSha256 ?? "")) {
    return { reason: "DATA_MISSING", detail: "A complete, hashed source dataset and grid are required." };
  }
  if (!EPSG_METRIC_JAPAN.test(grid.crs ?? "")) {
    return { reason: "CRS_INVALID", detail: "Only verified JGD2011 Japan Plane Rectangular metric CRS zones are supported in v1." };
  }
  if (!Number.isSafeInteger(grid.width) || !Number.isSafeInteger(grid.height) || grid.width < 1 || grid.height < 1 ||
      !Number.isFinite(grid.resolutionMetres) || grid.resolutionMetres <= 0 ||
      grid.width * grid.height !== grid.cells.length) {
    return { reason: "INPUT_INVALID", detail: "Invalid dimensions, resolution or cell count." };
  }
  if (grid.cells.length > 1_000_000) {
    return { reason: "MODEL_LIMIT", detail: "This first version supports at most one million cells." };
  }
  if (grid.cells.some((cell: CellClass) => cell !== "vegetation" && cell !== "other" && cell !== "unknown")) {
    return { reason: "INPUT_INVALID", detail: "Unexpected land-cover classification." };
  }
  if (grid.cells.includes("unknown")) {
    return { reason: "CLASS_UNKNOWN", detail: "Unknown or no-data cells cannot be treated as non-vegetation." };
  }
  return null;
}

export function extractPatches(grid: LandscapeGrid, neighbourhood: Neighbourhood): readonly Patch[] {
  if (neighbourhood !== 4 && neighbourhood !== 8) throw new RangeError("Neighbourhood must be 4 or 8");
  const seen = new Uint8Array(grid.cells.length);
  const patches: Patch[] = [];
  const dirs = neighbourhood === 4 ? [[1,0],[-1,0],[0,1],[0,-1]] :
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  for (let start=0; start<grid.cells.length; start++) {
    if (grid.cells[start] !== "vegetation" || seen[start]) continue;
    const queue=[start]; seen[start]=1;
    let count=0, sumX=0, sumY=0;
    for(let head=0;head<queue.length;head++){
      const index=queue[head]!;
      const x=index%grid.width, y=Math.floor(index/grid.width);
      count++; sumX+=(x+0.5)*grid.resolutionMetres; sumY+=(y+0.5)*grid.resolutionMetres;
      for(const [dx,dy] of dirs){
        const nx=x+dx!,ny=y+dy!;
        if(nx<0||nx>=grid.width||ny<0||ny>=grid.height)continue;
        const next=ny*grid.width+nx;
        if(!seen[next] && grid.cells[next]==="vegetation"){seen[next]=1;queue.push(next);}
      }
    }
    patches.push({id:patches.length,cellCount:count,areaM2:count*grid.resolutionMetres**2,
      centroidXMetres:sumX/count,centroidYMetres:sumY/count});
  }
  return patches;
}

/**
 * Structural connectivity proxy, not an animal movement probability.
 * Direct centroid distances satisfy the triangle inequality, so the
 * max-product path closure equals the direct exponential link.
 */
export function assessLandscape(grid: LandscapeGrid, neighbourhood: Neighbourhood, lambdaMetres: number): LandscapeAssessment {
  const error=checkGrid(grid);
  if(error)return {status:"NOT_ESTIMABLE",...error};
  if(neighbourhood!==4 && neighbourhood!==8 || !Number.isFinite(lambdaMetres) || lambdaMetres<=0) {
    return {status:"NOT_ESTIMABLE",reason:"INPUT_INVALID",detail:"Neighbourhood must be 4/8 and lambda must be positive."};
  }
  const patches=extractPatches(grid,neighbourhood);
  if(patches.length>4000) {
    return {status:"NOT_ESTIMABLE",reason:"MODEL_LIMIT",detail:"Too many patches for the initial pairwise calculation."};
  }
  const landscapeAreaM2=grid.width*grid.height*grid.resolutionMetres**2;
  const vegetationAreaM2=patches.reduce((sum,p)=>sum+p.areaM2,0);
  let numerator=0;
  for(let i=0;i<patches.length;i++){
    const a=patches[i]!;
    numerator+=a.areaM2**2;
    for(let j=i+1;j<patches.length;j++){
      const b=patches[j]!;
      const distance=Math.hypot(a.centroidXMetres-b.centroidXMetres,a.centroidYMetres-b.centroidYMetres);
      numerator+=2*a.areaM2*b.areaM2*Math.exp(-distance/lambdaMetres);
    }
  }
  const pc=numerator/(landscapeAreaM2**2);
  if(!Number.isFinite(pc) || pc < 0 || pc>1+1e-10) {
    return {status:"NOT_ESTIMABLE",reason:"INPUT_INVALID",detail:"Non-finite or out-of-bounds connectivity result."};
  }
  return {status:"STRUCTURAL_ONLY",model:"centroid-distance-exponential-v1",ecologicalValidation:"not_validated",
    neighbourhood,patches,landscapeAreaM2,vegetationAreaM2,pc:Math.min(1,pc),
    datasetId:grid.datasetId,sourceVersion:grid.sourceVersion,sourceSha256:grid.sourceSha256,
    caveat:"This is a structural proxy based on vegetation candidate cells and patch centroid distances. It does not establish habitat suitability, real animal movement, pollination or ecological tipping points."};
}
