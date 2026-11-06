/**
 * ECO MIRROR 3.0: Produce finite, verified static research packages from
 * frozen 2021 ESA crop and independently audited Phase-2 CLI outputs.
 * No AI, network, rounding, or ecological inferences.
 *
 * Usage: node scripts/landscape/pack-studies.mjs INPUT_DIR OUTPUT_DIR
 * INPUT_DIR/REGION/{crop,baseline,bridges}.json, for six 2km regions.
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { verifyWorldcoverWindow } from "../../src/features/landscape/data/window.ts";

export const REGIONS = ["shinjuku", "osaka", "nagoya", "fukuoka", "sapporo", "odaiba"];
const SOURCE_COMMIT = "9a7fa63bc83f350c80ddf775124cd3cbeb6c112e";
const SHA = /^[a-f0-9]{64}$/;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const fail = message => { throw new Error("STATIC_STUDY_INVALID: " + message); };
function exact(flag, message) { if (!flag) fail(message); }
function parse(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail("unparseable JSON: " + label); }
}
function fileId(site) {
  exact(/^(connector|reference)-x\d+-y\d+$/.test(site), "unsafe or malformed intervention site ID");
  return site;
}
async function writeResource(root, localPath, bytes, resources, kind, siteId=null) {
  exact(!localPath.includes("..") && !localPath.startsWith("/"), "resource path invalid");
  const full=join(root, localPath);
  await mkdir(dirname(full), { recursive:true });
  await writeFile(full,bytes);
  const descriptor={kind,path:localPath,sha256:sha256(bytes),bytes:bytes.length};
  if(siteId)descriptor.siteId=siteId;
  resources.push(descriptor);
}

async function packRegion(input, output, region) {
  const root=join(input,region);
  const [cropBytes,baseBytes,bridgeBytes]=await Promise.all(["crop.json","baseline.json","bridges.json"].map(f=>readFile(join(root,f))));
  const crop=parse(cropBytes,region+" crop"),base=parse(baseBytes,region+" baseline"),bridges=parse(bridgeBytes,region+" bridge");
  const grid=await verifyWorldcoverWindow(crop);
  exact(grid.width===200 && grid.height===200 && grid.resolutionMetres===10,"unexpected 2km research window");
  exact(crop.source_product==="ESA WorldCover 10m 2021 v200" && crop.license==="CC BY 4.0","wrong product or license");
  exact(crop.source_doi==="10.5281/zenodo.7254221","incorrect ESA DOI");
  exact(crop.attribution?.includes("ESA WorldCover"),"ESA attribution missing");
  exact(crop.source_full_tile_sha256===null,"false full-COG hash claim");
  const originalClasses=Buffer.from(crop.source_class_codes_b64 ?? "","base64");
  exact(originalClasses.length===40000, "missing or incomplete original classifications");
  exact(sha256(originalClasses)===crop.derived_pixel_class_sha256,"original class SHA256 invalid");
  exact(base.schema_version==="landscape-phases-1-3-v1" &&
    base.source_dataset_id===crop.dataset_id &&
    base.derived_binary_mask_sha256===crop.derived_binary_mask_sha256 &&
    base.derived_pixel_class_sha256===crop.derived_pixel_class_sha256,
    "source and baseline hash mismatch");
  const ensemble=base.ensemble, thresholds=base.thresholds;
  exact(ensemble.status==="complete" && ensemble.expectedCount===440 &&
    ensemble.calculatedCount===440 && ensemble.conditions?.length===440,"baseline missing experiment conditions");
  exact(ensemble.sourceId===crop.dataset_id &&
    ensemble.sourceSha256===crop.derived_pixel_class_sha256 &&
    ensemble.scientificMeaning==="hypothetical_stress_tests_not_forecast_probabilities",
    "baseline identity or meaning mismatch");
  const conditionMap=new Map();
  for(const record of ensemble.conditions) {
    exact(record.status==="STRUCTURAL_ONLY" && record.pc!==null &&
      Number.isFinite(record.pc) && record.pc>=0 && record.pc<=1 &&
      record.scenarioId && !conditionMap.has(record.scenarioId),"invalid/duplicate baseline condition");
    conditionMap.set(record.scenarioId,record);
  }
  exact(conditionMap.size===440 && thresholds.status==="complete" &&
    thresholds.testedCurves===40 && thresholds.completeCurves===40 &&
    thresholds.curves?.length===40 && thresholds.ecologicalThresholdsValidated===0 &&
    base.actual_future_probabilities===false &&
    base.ecological_validation==="not_validated", "incorrect threshold or field validation status");

  exact(bridges.schema_version==="landscape-bridge-study-v1" &&
    bridges.derived_land_cover_class_sha256===crop.derived_pixel_class_sha256 &&
    bridges.derived_crop_mask_sha256===crop.derived_binary_mask_sha256 &&
    bridges.original_baseline_report_sha256===sha256(baseBytes) &&
    bridges.permissions_construction_feasibility==="not_assessed" &&
    bridges.real_bee_movements_or_ecological_effects_verified===false,
    "bridge provenance, baseline report checksum, or ecological status mismatch");
  const report=bridges.result;
  exact(report.schemaVersion==="landscape-interventions-v1" && report.status==="complete" &&
    report.sourceDatasetId===crop.dataset_id &&
    report.sourceRasterSha256===crop.derived_pixel_class_sha256 &&
    report.scenarioCount===440 &&
    report.evaluated?.length===16 &&
    report.selectedConnectorFootprintsCount===12 && report.selectedReferenceFootprintsCount===4 &&
    report.ecologicalInterventionEffectsValidated===0 &&
    report.siteFeasibility==="not_assessed","bridge metadata/shortlist incomplete");
  const ids=new Set(), siteSummaries=[];
  const resources=[];
  for(const evaluated of report.evaluated){
    const site=evaluated.site;fileId(site.id);
    exact(!ids.has(site.id) && (site.role==="hypothetical_connector"||site.role==="equal_area_reference"),"duplicate/unknown site");
    ids.add(site.id);
    exact(site.cells?.length===4 && site.sourceClasses?.length===4 && site.addedAreaM2===400,
      "not exactly 400 square metres");
    exact(site.sourceClasses.every(v=>v===50||v===60),"ineligible 2021 land-cover class in site");
    exact(site.cells.every((cell,index)=>Number.isSafeInteger(cell)&&cell>=0&&cell<originalClasses.length&&
      originalClasses[cell]===site.sourceClasses[index]),"site classes and original raster disagree");
    exact(evaluated.resultCount===440 && evaluated.results?.length===440 &&
      evaluated.summary?.count===440,"missing site scenario records");
    const outcomes=new Set();
    for(const result of evaluated.results) {
      const expected=conditionMap.get(result.scenarioId);
      exact(expected && !outcomes.has(result.scenarioId),"site has duplicate or unknown condition ID");
      outcomes.add(result.scenarioId);
      exact(Number.isFinite(result.beforePc) && Number.isFinite(result.afterPc) &&
        Math.abs(result.beforePc-expected.pc)<=1e-12 &&
        Math.abs(result.afterPc-result.beforePc-result.deltaPc)<=1e-12,
        "site before/after PC not aligned with original baseline");
      exact(result.afterVegetationAreaM2-result.beforeVegetationAreaM2===400 &&
        result.beforeVegetationAreaM2===expected.vegetationAreaM2 &&
        result.patchesJoined===Math.max(0,result.beforePatchCount-result.afterPatchCount),
        "unequal hypothetical area or patch merger mismatch");
    }
    exact(outcomes.size===440,"incomplete site scenario keys");
    const payload={schemaVersion:"eco3-intervention-site-v1",sourceDatasetId:crop.dataset_id,
      sourceRasterSha256:crop.derived_pixel_class_sha256,siteId:site.id,results:evaluated.results};
    const localPath=`regions/${region}/sites/${site.id}.json`;
    await writeResource(output,localPath,Buffer.from(JSON.stringify(payload)+"\n"),resources,"site",site.id);
    siteSummaries.push({site:evaluated.site,resultCount:evaluated.resultCount,summary:evaluated.summary});
  }
  exact(report.rankedConnectorIds.length===12 && report.rankedConnectorIds.every(id=>ids.has(id)) &&
    report.rankedDirectBridgeIds.every(id=>ids.has(id)),"ranked bridge IDs do not match source shortlist");

  // Original text payloads are preserved byte-for-byte, so their original study SHA256 applies.
  await writeResource(output,`regions/${region}/crop.json`,cropBytes,resources,"crop");
  await writeResource(output,`regions/${region}/baseline.json`,baseBytes,resources,"baseline");
  const summary={schemaVersion:"eco3-intervention-summary-v1",
    originalReportSha256:sha256(bridgeBytes),
    reportMetadata:Object.fromEntries(Object.entries(bridges).filter(([k])=>k!=="result")),
    modelMetadata:Object.fromEntries(Object.entries(report).filter(([k])=>k!=="evaluated")),
    evaluated:siteSummaries};
  await writeResource(output,`regions/${region}/bridges-summary.json`,
    Buffer.from(JSON.stringify(summary)+"\n"),resources,"bridges-summary");

  return {regionId:region,datasetId:crop.dataset_id,width:200,height:200,
    crs:crop.crs,sourceProduct:crop.source_product,observationYear:2021,
    derivedPixelClassSha256:crop.derived_pixel_class_sha256,
    derivedVegetationMaskSha256:crop.derived_binary_mask_sha256,
    sourceFullTileSha256:null,conditionsCount:440,siteCount:16,interventionComparisonsCount:7040,
    resources};
}

export async function build(inputDir,outputDir) {
  const input=resolve(inputDir),output=resolve(outputDir);
  exact(output.endsWith("/public/studies/worldcover-2021-v200"),
    "Output directory must be the explicit public study folder");
  await rm(output,{force:true,recursive:true});
  await mkdir(output,{recursive:true});
  const regions=[];
  for(const region of REGIONS){
    const result=await packRegion(input,output,region);
    regions.push(result);
    console.log("STATIC_STUDY_REGION="+JSON.stringify({region,files:result.resources.length,
      bytes:result.resources.reduce((n,x)=>n+x.bytes,0),scenarios:440,comparisons:7040}));
  }
  const manifest={schemaVersion:"eco3-study-index-v1",sourceYear:2021,
    sourceProduct:"ESA WorldCover 10m 2021 v200",license:"CC BY 4.0",
    attribution:"© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
    sourceDOI:"10.5281/zenodo.7254221",researchSourceCommitSha:SOURCE_COMMIT,
    scientificMeaning:"structural_landcover_proxy_not_real_animal_movement_or_forecast",
    model:"centroid-distance-exponential-v1",distribution:"immutable_hash_checked_static_assets",
    regionCount:6,totalBaselineConditions:2640,totalInterventionComparisons:42240,
    regions};
  await writeFile(join(output,"manifest.json"),JSON.stringify(manifest)+"\n");
  console.log("STATIC_STUDY_INDEX="+JSON.stringify({regions:regions.length,comparisons:42240,
    files:regions.reduce((n,x)=>n+x.resources.length,1),
    manifestSha256:sha256(Buffer.from(JSON.stringify(manifest)+"\n"))}));
}

if(process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)) {
  if(process.argv.length!==4)throw Error("Usage: node scripts/landscape/pack-studies.mjs INPUT_DIR public/studies/worldcover-2021-v200");
  await build(process.argv[2],process.argv[3]);
}
