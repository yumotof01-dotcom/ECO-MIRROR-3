/**
 * Audits every published static study byte, recreates the original 1.9MB
 * bridge documents from their 16 lazy shards and compares original SHA-256.
 * This is deliberately independent of pack-studies.mjs.
 *
 * node scripts/landscape/audit-static-packages.mjs public/studies/worldcover-2021-v200
 */
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const hash=x=>createHash("sha256").update(x).digest("hex");
const ok=(condition,msg)=>{if(!condition)throw Error("STATIC_PACKAGE_AUDIT_FAILED: "+msg);};
const root=resolve(process.argv[2]??"public/studies/worldcover-2021-v200");
const manifest=JSON.parse(await readFile(join(root,"manifest.json"),"utf8"));
const regions=["shinjuku","osaka","nagoya","fukuoka","sapporo","odaiba"];
ok(manifest.schemaVersion==="eco3-study-index-v1" &&
  manifest.researchSourceCommitSha==="9a7fa63bc83f350c80ddf775124cd3cbeb6c112e" &&
  manifest.sourceYear===2021 && manifest.sourceProduct==="ESA WorldCover 10m 2021 v200" &&
  manifest.license==="CC BY 4.0" && manifest.regionCount===6 &&
  manifest.totalBaselineConditions===2640 && manifest.totalInterventionComparisons===42240 &&
  manifest.scientificMeaning==="structural_landcover_proxy_not_real_animal_movement_or_forecast",
  "unexpected study manifest declaration");

let resourceCount=0,scenarios=0,comparisons=0;
for(const region of manifest.regions){
  ok(regions.includes(region.regionId),"invalid region ID");
  ok(region.resources?.length===19 && region.siteCount===16 && region.conditionsCount===440,
    "resource count or experiment count mismatch "+region.regionId);
  const files=new Map();
  for(const descriptor of region.resources) {
    ok(descriptor.path.startsWith("regions/"+region.regionId+"/") &&
      !descriptor.path.includes("..") && !descriptor.path.includes("\\") &&
      /^[a-f0-9]{64}$/.test(descriptor.sha256) && descriptor.bytes>0 &&
      !files.has(descriptor.path),"unsafe path, duplicate, or hash");
    const bytes=await readFile(join(root,descriptor.path));
    ok(bytes.length===descriptor.bytes && hash(bytes)===descriptor.sha256,"tampered or missing file "+descriptor.path);
    files.set(descriptor.path,{bytes,content:JSON.parse(bytes.toString("utf8")),descriptor});
    resourceCount++;
  }
  const resource=kind=>[...files.values()].find(x=>x.descriptor.kind===kind)?.content;
  const crop=resource("crop"),baseline=resource("baseline"),summary=resource("bridges-summary");
  ok(crop && baseline && summary,"missing core region study files");
  ok(crop.dataset_id===region.datasetId && crop.width===200 && crop.height===200 &&
    crop.derived_pixel_class_sha256===region.derivedPixelClassSha256 &&
    crop.derived_binary_mask_sha256===region.derivedVegetationMaskSha256 &&
    crop.source_full_tile_sha256===null,"original crop metadata mismatch");
  const mask=Buffer.from(crop.rows.join(""));
  ok(mask.length===40000 && hash(mask)===crop.derived_binary_mask_sha256,"source mask tampering");
  const source=Buffer.from(crop.source_class_codes_b64,"base64");
  ok(source.length===40000 && hash(source)===crop.derived_pixel_class_sha256,"source class corruption");
  ok(baseline.ensemble?.status==="complete" &&
    baseline.ensemble.conditions?.length===440 &&
    baseline.thresholds?.curves?.length===40 &&
    baseline.source_dataset_id===region.datasetId,
    "baseline condition omission or source mismatch");
  const conditionMap=new Map(baseline.ensemble.conditions.map(x=>[x.scenarioId,x]));
  ok(conditionMap.size===440,"duplicate baseline IDs");
  const originalBaselineFile=[...files.values()].find(x=>x.descriptor.kind==="baseline");
  ok(summary.reportMetadata?.original_baseline_report_sha256===hash(originalBaselineFile.bytes),
    "bridge reference file hash differs");
  ok(summary.schemaVersion==="eco3-intervention-summary-v1" &&
    summary.evaluated?.length===16 && summary.modelMetadata?.scenarioCount===440 &&
    summary.modelMetadata?.siteFeasibility==="not_assessed" &&
    summary.modelMetadata?.ecologicalInterventionEffectsValidated===0,
    "site summary scientific status not valid");

  const reconstructedSites=[];
  for(const entry of summary.evaluated) {
    const siteId=entry.site?.id;
    const s=[...files.values()].find(x=>x.descriptor.kind==="site" && x.descriptor.siteId===siteId)?.content;
    ok(s && s.schemaVersion==="eco3-intervention-site-v1" &&
      s.sourceDatasetId===region.datasetId && s.sourceRasterSha256===crop.derived_pixel_class_sha256 &&
      s.siteId===siteId && s.results?.length===440,
      "site shard identity/condition count mismatch "+siteId);
    ok(new Set(s.results.map(r=>r.scenarioId)).size===440,"duplicate site condition "+siteId);
    for(const r of s.results){
      const base=conditionMap.get(r.scenarioId);
      ok(base && Math.abs(r.beforePc-base.pc)<=1e-12 &&
        Math.abs((r.afterPc-r.beforePc)-r.deltaPc)<=1e-12 &&
        r.afterVegetationAreaM2-r.beforeVegetationAreaM2===400 &&
        r.beforeVegetationAreaM2===base.vegetationAreaM2 &&
        r.patchesJoined===Math.max(0,r.beforePatchCount-r.afterPatchCount),
        "altered intervention PC/area/patch for "+siteId);
    }
    reconstructedSites.push({site:entry.site,resultCount:entry.resultCount,
      results:s.results,summary:entry.summary});
    comparisons+=s.results.length;
  }
  const modelHead=Object.entries(summary.modelMetadata);
  const insertion=modelHead.findIndex(([key])=>key==="rankedConnectorIds");
  ok(insertion>0 && modelHead[insertion-1][0]==="selectionMethod",
    "unexpected old study property order; cannot attest original bytes");
  modelHead.splice(insertion,0,["evaluated",reconstructedSites]);
  const reconstructed=Object.assign({},summary.reportMetadata,{result:Object.fromEntries(modelHead)});
  const reconstructedBytes=Buffer.from(JSON.stringify(reconstructed)+"\n");
  ok(hash(reconstructedBytes)===summary.originalReportSha256,
    "reconstructed report differs from frozen original SHA256 "+region.regionId);
  scenarios+=baseline.ensemble.conditions.length;
  console.log("STATIC_REGION_AUDIT=PASS "+JSON.stringify({region:region.regionId,
    baselineCount:440,siteResults:7040,originalBridgeSha256:summary.originalReportSha256}));
}
ok(scenarios===2640 && comparisons===42240 && resourceCount===114,
  "dataset total is not the planned six-region study");
console.log("STATIC_STUDY_AUDIT=PASS "+JSON.stringify({regions:6,files:resourceCount+1,
  baselineConditions:scenarios,interventionComparisons:comparisons,
  manifestSha256:hash(await readFile(join(root,"manifest.json")))}));
