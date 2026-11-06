/**
 * Verify each imported research file against the immutable old Git commit.
 * Requires actions/checkout of the old repository into .legacy-source.
 * This script does NOT change either repository or execute research simulations.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifest=JSON.parse(await readFile("provenance/legacy-import-manifest.json","utf8"));
const refRoot=resolve(process.argv[2] || ".legacy-source");
if(manifest.schemaVersion!=="eco-mirror-3-legacy-landscape-import-v1" ||
   manifest.sourceRepository!=="yumotof01-dotcom/ECO-MIRROR" ||
   manifest.sourceCommitSha!=="9a7fa63bc83f350c80ddf775124cd3cbeb6c112e" ||
   manifest.copyMode!=="byte-for-byte_without_edits" ||
   manifest.filenames.length!==16)throw Error("Unexpected or incomplete source manifest");

function sha(data,algo){return createHash(algo).update(data).digest("hex");}
function gitBlobSha1(data){return sha(Buffer.concat([Buffer.from(`blob ${data.length}\0`),data]),"sha1");}
const seen=new Set();
let count=0,bytes=0;
for(const file of manifest.filenames){
  const path=file.path;
  if(typeof path!=="string" || !/^(?:scripts\/landscape\/|src\/features\/landscape\/)[a-zA-Z0-9/_.-]+$/.test(path) ||
     path.includes("..") || seen.has(path))throw Error("Unexpected source path: "+path);
  seen.add(path);
  const [oldBytes,newBytes]=await Promise.all([readFile(resolve(refRoot,path)),readFile(resolve(path))]);
  const oldGit=gitBlobSha1(oldBytes),newGit=gitBlobSha1(newBytes);
  const oldSha256=sha(oldBytes,"sha256"),newSha256=sha(newBytes,"sha256");
  if(oldBytes.length!==file.sizeBytes || oldGit!==file.gitBlobSha1 ||
     oldGit!==newGit || oldSha256!==newSha256)throw Error("FROZEN_IMPORT_MISMATCH: "+path);
  console.log("FROZEN_SOURCE_MATCH="+JSON.stringify({path,sha256:newSha256,sizeBytes:newBytes.length}));
  count++;bytes+=newBytes.length;
}
console.log("FROZEN_LANDSCAPE_IMPORT=PASS "+JSON.stringify({files:count,bytes,sourceCommitSha:manifest.sourceCommitSha}));
