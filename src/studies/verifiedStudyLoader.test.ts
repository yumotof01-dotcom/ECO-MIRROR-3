import { describe, expect, it, vi, afterEach } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { enumerateConditions } from "../features/landscape/scenarios/engine.ts";
import {
  loadStudyIndex, loadVerifiedStudyRegion, loadVerifiedInterventionSite,
  type StudyIndex, type StudyResource
} from "./verifiedStudyLoader.ts";

const names=["shinjuku","osaka","nagoya","fukuoka","sapporo","odaiba"] as const;
const root="https://example.invalid/studies/worldcover-2021-v200/";
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const allConditions=enumerateConditions().map(s=>({
  ...s,scenarioId:`${s.pattern}-n${s.neighbourhood}-lambda${s.lambdaMetres}-loss${s.lossPercent}`,
  status:"STRUCTURAL_ONLY",pc:0.1,vegetationAreaM2:100,
  errorReason:null,actualLossPercent:s.lossPercent
}));
function fixture() {
  const cells=Array(200).fill("O".repeat(200));
  const source=Buffer.alloc(40000,50);
  const maskSha=sha(cells.join(""));
  const sourceSha=sha(source.toString("latin1"));
  const datasetId="esa-worldcover-2021-v200-N33E138-shinjuku-2km";
  const crop={
    schema_version:"worldcover-cropped-grid-v1",dataset_id:datasetId,
    source_product:"ESA WorldCover 10m 2021 v200",
    source_url:"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N33E138_Map.tif",
    attribution:"© ESA WorldCover project 2021 / modified Copernicus 2021",
    license:"CC BY 4.0",source_full_tile_sha256:null,
    derived_binary_mask_sha256:maskSha,derived_pixel_class_sha256:sourceSha,
    crs:"EPSG:6677",resolution_metres:10,width:200,height:200,rows:cells,
    source_class_codes_b64:source.toString("base64")
  };
  const baseline={
    schema_version:"landscape-phases-1-3-v1",source_dataset_id:datasetId,
    derived_binary_mask_sha256:maskSha,derived_pixel_class_sha256:sourceSha,
    source_full_tile_sha256:null,ecological_validation:"not_validated",
    actual_future_probabilities:false,
    ensemble:{status:"complete",expectedCount:440,calculatedCount:440,
      scientificMeaning:"hypothetical_stress_tests_not_forecast_probabilities",
      conditions:allConditions},
    thresholds:{status:"complete",curves:Array(40).fill({status:"NO_DECLINE"}),
      testedCurves:40,completeCurves:40,ecologicalThresholdsValidated:0}
  };
  const sites=Array.from({length:16},(_,i)=>({
    site:{id:`connector-x${20+2*i}-y20`,role:"hypothetical_connector",
      cells:[0,1,200,201],sourceClasses:[50,50,50,50],addedAreaM2:400},
    resultCount:440,summary:{count:440}
  }));
  const bridges={schemaVersion:"eco3-intervention-summary-v1",
    originalReportSha256:"a".repeat(64),
    reportMetadata:{real_bee_movements_or_ecological_effects_verified:false},
    modelMetadata:{sourceDatasetId:datasetId,sourceRasterSha256:sourceSha,
      scenarioCount:440,siteFeasibility:"not_assessed",ecologicalInterventionEffectsValidated:0},
    evaluated:sites};
  const siteResults={schemaVersion:"eco3-intervention-site-v1",
    sourceDatasetId:datasetId,sourceRasterSha256:sourceSha,siteId:sites[0]!.site.id,
    results:allConditions.map(c=>({
      scenarioId:c.scenarioId,beforePc:0.1,afterPc:0.1001,deltaPc:0.0001,
      beforeVegetationAreaM2:100,afterVegetationAreaM2:500,
      beforePatchCount:2,afterPatchCount:1,patchesJoined:1
    }))};
  const files=new Map<string,string>();
  const define=(path:string,json:unknown)=>{
    const text=JSON.stringify(json)+"\n";
    files.set(root+path,text);
    return {path,bytes:new TextEncoder().encode(text).length,sha256:sha(text)};
  };
  const sampleResources:StudyResource[]=[
    {...define("regions/shinjuku/crop.json",crop),kind:"crop"},
    {...define("regions/shinjuku/baseline.json",baseline),kind:"baseline"},
    {...define("regions/shinjuku/bridges-summary.json",bridges),kind:"bridges-summary"},
    ...sites.map((s,i)=>({
      ...define(`regions/shinjuku/sites/${s.site.id}.json`,i===0?siteResults:{placeholder:true}),
      kind:"site" as const,siteId:s.site.id
    }))
  ];
  const manifest:StudyIndex={
    schemaVersion:"eco3-study-index-v1",sourceYear:2021,
    sourceProduct:"ESA WorldCover 10m 2021 v200",license:"CC BY 4.0",
    attribution:"© ESA WorldCover project 2021",
    sourceDOI:"10.5281/zenodo.7254221",
    researchSourceCommitSha:"9a7fa63bc83f350c80ddf775124cd3cbeb6c112e",
    scientificMeaning:"structural_landcover_proxy_not_real_animal_movement_or_forecast",
    model:"centroid-distance-exponential-v1",
    distribution:"immutable_hash_checked_static_assets",
    regionCount:6,totalBaselineConditions:2640,totalInterventionComparisons:42240,
    regions:names.map(name=>({
      regionId:name,datasetId:datasetId.replace("shinjuku",name),
      width:200,height:200,crs:"EPSG:6677",
      sourceProduct:"ESA WorldCover 10m 2021 v200",
      observationYear:2021,sourceFullTileSha256:null,
      derivedPixelClassSha256:sourceSha,derivedVegetationMaskSha256:maskSha,
      conditionsCount:440,siteCount:16,interventionComparisonsCount:7040,
      resources:sampleResources.map(r=>({
        ...r,path:r.path.replaceAll("/shinjuku/","/"+name+"/")
      }))
    }))
  };
  files.set(root+"manifest.json",JSON.stringify(manifest)+"\n");
  const fetcher=(async (url:RequestInfo | URL)=>{
    const found=files.get(String(url));
    if(found===undefined)return {ok:false,status:404,arrayBuffer:async()=>new ArrayBuffer(0)} as Response;
    return {ok:true,status:200,arrayBuffer:async()=>new TextEncoder().encode(found).buffer} as Response;
  }) as typeof fetch;
  return {manifest,files,crop,baseline,bridges,siteResults,fetcher};
}
afterEach(()=>vi.unstubAllGlobals());

describe("Phase-3 verified lazy study data access (synthetic fixtures only)",()=>{
  it("accepts complete six-region manifest, a verified 440-condition region and one 440-result site",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const f=fixture(),options={baseUrl:"https://example.invalid/",fetcher:f.fetcher};
    const index=await loadStudyIndex(options);
    expect(index.regions).toHaveLength(6);
    const region=await loadVerifiedStudyRegion("shinjuku",options);
    expect(region.baseline.ensemble.conditions).toHaveLength(440);
    expect(region.bridges.evaluated).toHaveLength(16);
    expect(region.scientificStatus).toBe("structural_only_not_field_validated");
    const detail=await loadVerifiedInterventionSite(region,f.siteResults.siteId,options);
    expect(detail.results).toHaveLength(440);
    expect(detail.scientificStatus).toBe("hypothetical_conversion_only");
  });

  it("rejects altered baseline bytes instead of showing stale or zero science",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const f=fixture(),url=root+"regions/shinjuku/baseline.json";
    f.files.set(url,f.files.get(url)!.replace('"pc":0.1','"pc":0.9'));
    await expect(loadVerifiedStudyRegion("shinjuku",
      {baseUrl:"https://example.invalid/",fetcher:f.fetcher})).rejects.toMatchObject({reason:"HASH_MISMATCH"});
  });

  it("rejects missing site shards and never silently substitutes another region",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const f=fixture(),options={baseUrl:"https://example.invalid/",fetcher:f.fetcher};
    const region=await loadVerifiedStudyRegion("shinjuku",options);
    f.files.delete(root+`regions/shinjuku/sites/${f.siteResults.siteId}.json`);
    await expect(loadVerifiedInterventionSite(region,f.siteResults.siteId,options))
      .rejects.toMatchObject({reason:"MISSING_RESOURCE"});
    await expect(loadVerifiedInterventionSite(region,"nonexistent",options))
      .rejects.toMatchObject({reason:"INVALID_DATA"});
  });

  it("refuses source-mismatched masks even when manifest file hash is updated",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const f=fixture(),url=root+"regions/shinjuku/crop.json";
    const corrupted={...f.crop,rows:[...f.crop.rows]};
    corrupted.rows[0]="V"+corrupted.rows[0]!.slice(1);
    const changed=JSON.stringify(corrupted)+"\n";
    f.files.set(url,changed);
    const meta=f.manifest.regions[0]!.resources.find(r=>r.kind==="crop")!;
    meta.sha256=sha(changed);meta.bytes=new TextEncoder().encode(changed).length;
    f.files.set(root+"manifest.json",JSON.stringify(f.manifest)+"\n");
    await expect(loadVerifiedStudyRegion("shinjuku",
      {baseUrl:"https://example.invalid/",fetcher:f.fetcher})).rejects.toMatchObject({reason:"INVALID_DATA"});
  });

  it("rejects forged year, research commit or incomplete manifest",async()=>{
    const f=fixture(),url=root+"manifest.json";
    for(const mutation of [
      (m:StudyIndex)=>({...m,sourceYear:2026}),
      (m:StudyIndex)=>({...m,researchSourceCommitSha:"b".repeat(40)}),
      (m:StudyIndex)=>({...m,regions:m.regions.slice(0,5)})
    ]) {
      f.files.set(url,JSON.stringify(mutation(f.manifest))+"\n");
      await expect(loadStudyIndex({baseUrl:"https://example.invalid/",fetcher:f.fetcher}))
        .rejects.toMatchObject({reason:"INVALID_MANIFEST"});
    }
  });

  it("fails closed if the secure SHA-256 API is unavailable",async()=>{
    vi.stubGlobal("crypto",{subtle:null});
    const f=fixture();
    await expect(loadVerifiedStudyRegion("shinjuku",
      {baseUrl:"https://example.invalid/",fetcher:f.fetcher})).rejects.toMatchObject({reason:"CRYPTO_UNAVAILABLE"});
  });
});
