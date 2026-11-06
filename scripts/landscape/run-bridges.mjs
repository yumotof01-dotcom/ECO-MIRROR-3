/** Run 12 conceptual connectors + 4 same-area controls against each of 440 scenarios.
 * Node 24's built-in TypeScript type stripping; no new npm dependencies.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyWorldcoverWindow } from "../../src/features/landscape/data/window.ts";
import { runBridgeExperiment } from "../../src/features/landscape/bridges/engine.ts";

const cropPath=process.argv[2], baselinePath=process.argv[3];
const outputPath=process.argv[4] || "/tmp/worldcover-bridge-440-report.json";
if(!cropPath || !baselinePath)throw Error("Usage: node run-bridges.mjs crop.json baseline440.json [out.json]");
const rawCrop=await readFile(cropPath);
const rawBaseline=await readFile(baselinePath);
const crop=JSON.parse(rawCrop.toString("utf8"));
const baseline=JSON.parse(rawBaseline.toString("utf8"));
if(typeof crop.source_class_codes_b64!=="string")throw Error("Source class values missing: cannot distinguish land from water");
const classCodes=Buffer.from(crop.source_class_codes_b64,"base64");
const rawClassHash=createHash("sha256").update(classCodes).digest("hex");
if(rawClassHash!==crop.derived_pixel_class_sha256)throw Error("Original source class raster failed SHA256 audit");
const grid=await verifyWorldcoverWindow(crop);
if(baseline.source_dataset_id!==crop.dataset_id ||
   baseline.derived_binary_mask_sha256!==crop.derived_binary_mask_sha256 ||
   baseline.ensemble?.status!=="complete")throw Error("Baseline data or model completeness mismatch");
const report=runBridgeExperiment(grid,new Uint8Array(classCodes),baseline.ensemble);
const document={
  schema_version:"landscape-bridge-study-v1",
  original_dataset_url:crop.source_url,
  original_dataset_product:crop.source_product,
  original_dataset_license:crop.license,
  original_source_tile_full_sha256:null,
  derived_land_cover_class_sha256:rawClassHash,
  derived_crop_mask_sha256:crop.derived_binary_mask_sha256,
  original_baseline_report_sha256:createHash("sha256").update(rawBaseline).digest("hex"),
  data_time_reference:"2021, not current 2026 vegetation",
  calculated_under_assumed_land_cover_conversions:true,
  permissions_construction_feasibility:"not_assessed",
  real_bee_movements_or_ecological_effects_verified:false,
  result:report
};
const bytes=JSON.stringify(document)+"\n";
await writeFile(outputPath,bytes,"utf8");
const sha=createHash("sha256").update(bytes).digest("hex");
const ranked=report.rankedConnectorIds.map((id,i)=>{
  const e=report.evaluated.find(x=>x.site.id===id);
  return {rank:i+1,id,grid_x:e.site.x,grid_y:e.site.y,source_classes:e.site.sourceClasses,
    lower_decile_delta_pc:e.summary.lowerDecileDeltaPc,
    median_delta_pc:e.summary.medianDeltaPc,
    minimum_delta_pc:e.summary.minimumDeltaPc,
    negative_conditions:e.summary.negativeConditions,
    positive_conditions:e.summary.positiveConditions,
    patch_merge_conditions:e.summary.scenariosWithPatchMerger,
    new_island_conditions:e.summary.scenariosCreatingNewIsland,
    consistent_model_gain:e.summary.assessment==="POSITIVE_UNDER_ALL_DEFINED_CONDITIONS"};
});
console.log("LANDSCAPE_BRIDGE_REPORT="+JSON.stringify({
  candidate_pool:report.sourcePixelCandidatesCount,
  eligible_connector_footprints:report.connectorEligibleFootprintsCount,
  evaluated_connectors:report.selectedConnectorFootprintsCount,
  equal_area_controls:report.selectedReferenceFootprintsCount,
  conditions_per_site:report.scenarioCount,
  total_intervention_runs:report.evaluated.reduce((sum,r)=>sum+r.resultCount,0),
  direct_bridges_in_both_neighbourhoods:report.rankedDirectBridgeIds.length,
  top_five:ranked.slice(0,5),
  reported_sha256:sha,
  output:outputPath,
  warnings:["model-only hypothetical conversions","unverified land access and beekeeping benefit","no exterior movement buffer"]
}));
