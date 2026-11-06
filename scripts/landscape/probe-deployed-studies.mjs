/**
 * Confirm the actual Cloudflare branch-preview returns the compiled React shell
 * and every one of the 115 versioned ESA study files, not raw TSX or stale JSON.
 * NO Cloudflare account credentials, tokens, paid APIs, or main branch modification.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
const origin=process.env.STUDY_PREVIEW_URL;
if(!origin || !/^https:\/\/feat-phase3-static-study-pac\.eco-mirror-3\.pages\.dev\/$/.test(origin))
  throw Error("Expected an exact Cloudflare phase-3 branch preview origin");
const root="studies/worldcover-2021-v200/";
const dir="public/"+root;
const sha=x=>createHash("sha256").update(x).digest("hex");
async function get(path){
  const url=new URL(path,origin).href;
  const response=await fetch(url,{headers:{"cache-control":"no-cache"},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error("LIVE_CLOUDFLARE_HTTP_"+response.status+": "+path);
  return {bytes:Buffer.from(await response.arrayBuffer()),type:response.headers.get("content-type")??""};
}
async function waitForFreshBuild(){
  const expected=await readFile(join(dir,"manifest.json"));
  const expectedSha=sha(expected);
  for(let attempt=1;attempt<=18;attempt++){
    try {
      const [html,manifest]=await Promise.all([get(""),get(root+"manifest.json")]);
      const text=html.bytes.toString("utf8");
      if(sha(manifest.bytes)===expectedSha &&
        text.includes('<div id="root"></div>') &&
        !text.includes('/src/main.tsx') &&
        /\/assets\/[^"]+\.js/.test(text) &&
        /\/assets\/[^"]+\.css/.test(text)){
        return text;
      }
    }catch(error) {
      console.log("LIVE_PREVIEW_NOT_READY",attempt,String(error));
    }
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw Error("LIVE_PREVIEW_UNVERIFIED: correct verified data and bundled React index were not served in bounded time");
}
const html=await waitForFreshBuild();
const assetPaths=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(x=>x[1]);
if(!assetPaths.some(x=>x.endsWith(".js"))||!assetPaths.some(x=>x.endsWith(".css")))
  throw Error("LIVE_MISSING_REACT_BUNDLE");
for(const path of assetPaths) {
  const asset=await get(path);
  if(path.endsWith(".js")&&!asset.type.includes("javascript"))throw Error("LIVE_JS_CONTENT_TYPE_INVALID");
  if(path.endsWith(".css")&&!asset.type.includes("text/css"))throw Error("LIVE_CSS_CONTENT_TYPE_INVALID");
  console.log("LIVE_REACT_ASSET=PASS",path,asset.bytes.length);
}
const m=JSON.parse((await readFile(join(dir,"manifest.json"))).toString("utf8"));
const all=m.regions.flatMap(r=>r.resources);
if(all.length!==114||m.regionCount!==6)throw Error("LOCAL_STUDY_MANIFEST_INCOMPLETE");
let cursor=0,bytes=0;
const workers=Array.from({length:6},async()=>{
  while(cursor<all.length){
    const descriptor=all[cursor++];
    const output=await get(root+descriptor.path);
    if(output.bytes.length!==descriptor.bytes || sha(output.bytes)!==descriptor.sha256 ||
      !output.type.includes("json"))
      throw Error("LIVE_STUDY_RESOURCE_MISMATCH: "+descriptor.path);
    bytes+=output.bytes.length;
  }
});
await Promise.all(workers);
console.log("LIVE_CLOUDFLARE_STUDY=PASS "+JSON.stringify({site:origin,sourceYear:2021,
  researchCommit:m.researchSourceCommitSha,files:all.length+1,bytes,
  baselineConditions:m.totalBaselineConditions,interventionComparisons:m.totalInterventionComparisons}));
