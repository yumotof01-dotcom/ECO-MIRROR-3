/** Executes typed landscape modules through Node 24 type stripping. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyWorldcoverWindow } from "../../src/features/landscape/data/window.ts";
import { runExhaustiveScenarios } from "../../src/features/landscape/scenarios/engine.ts";
import { detectModelChangeIntervals } from "../../src/features/landscape/thresholds/detect.ts";

const input=process.argv[2];
const output=process.argv[3] || "/tmp/eco-mirror-worldcover-440-results.json";
if(!input)throw Error("A verified real WorldCover window JSON path is required.");
const sourceText=await readFile(input,"utf8");
const window=JSON.parse(sourceText);
const grid=await verifyWorldcoverWindow(window);
const ensemble=runExhaustiveScenarios(grid);
const thresholds=detectModelChangeIntervals(ensemble);
const report={
  schema_version:"landscape-phases-1-3-v1",
  source_product:window.source_product,
  source_url:window.source_url,
  source_dataset_id:window.dataset_id,
  derived_binary_mask_sha256:window.derived_binary_mask_sha256,
  derived_pixel_class_sha256:window.derived_pixel_class_sha256,
  source_full_tile_sha256:null,
  geographic_quality:"ESA 2021 classified crop, not a verified bee habitat map",
  spatial_limitations:grid.width===200 && grid.height===200 && grid.resolutionMetres===10
    ? "The 2km window was cropped without exterior movement buffer; results may have boundary effects."
    : `The ${grid.width*grid.resolutionMetres}m x ${grid.height*grid.resolutionMetres}m window has no exterior movement buffer; edge effects remain unmeasured.`,
  ecological_validation:"not_validated",
  actual_future_probabilities:false,
  ensemble,
  thresholds
};
const bytes=JSON.stringify(report);
await writeFile(output,bytes+"\n","utf8");
const sha=createHash("sha256").update(bytes+"\n","utf8").digest("hex");
const tally=Object.fromEntries([...new Set(thresholds.curves.map(x=>x.status))]
  .map(s=>[s,thresholds.curves.filter(x=>x.status===s).length]));
const summary={
  source:window.dataset_id,
  input_mask_sha256:window.derived_binary_mask_sha256,
  scenario_count:ensemble.expectedCount,
  calculated_scenarios:ensemble.calculatedCount,
  complete_curves:thresholds.completeCurves,
  potential_model_abruptness_count:thresholds.potentialModelAbruptnessCount,
  ecological_thresholds_validated:thresholds.ecologicalThresholdsValidated,
  classifications:tally,
  report_sha256:sha,
  report_path:output
};
console.log("LANDSCAPE_REAL_DATA_REPORT="+JSON.stringify(summary));
if(ensemble.status!=="complete"||thresholds.status!=="complete")
  throw Error("Exhaustive scenario/threshold validation incomplete; report stored without silent omissions");
