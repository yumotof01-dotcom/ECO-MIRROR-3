/** Built library + real bundled module worker, no product UI or external service.
 * npm run research:build
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run research:browser
 * CI installs pinned Playwright; these environment variables are local-runtime overrides only.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=resolve('.');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/') {res.setHeader('content-type','text/html');res.end('<!doctype html><title>Research worker audit</title>');return;}
  const base=path.startsWith('/studies/')?'public':'dist-research';
  const file=resolve(root,base,'.'+path);
  if(!file.startsWith(resolve(root,base)+'/')) {res.writeHead(403).end();return;}
  try {const bytes=await readFile(file);res.setHeader('content-type',path.endsWith('.js')?'text/javascript':'application/json');res.end(bytes);}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);
  const result=await page.evaluate(async()=>{
    const api=await import('/research.js');
    const regions=['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'];
    const frames=[];
    let ticks=0;
    const timer=setInterval(()=>ticks++,1);
    try {
      for(const region of regions) {
        const study=await api.loadResearchStudy(region);
        const selection={pattern:'distributed',lossPercent:25,neighbourhood:4};
        const start=performance.now();
        const frame=await api.prepareResearchMap(study,selection);
        if(frame.vegetationAreaM2!==study.condition({...selection,lambdaMetres:40}).vegetationAreaM2 ||
          frame.patchLabels.length!==40000 || frame.regionId!==region)throw Error('Built worker data mismatch');
        const first=await api.loadResearchSite(study,study.candidates[0].site.id);
        const second=await api.loadResearchSite(study,study.candidates[1].site.id);
        const compared=study.compareCandidates(first,second,api.CONDITIONS[0]);
        if(compared.addedAreaM2!==400||compared.first.site.id===compared.second.site.id)throw Error('Candidate binding mismatch');
        const controller=new AbortController();
        const cancelled=api.prepareResearchMap(study,selection,controller.signal);
        controller.abort();
        try {await cancelled;throw Error('Cancellation ignored');}catch(error){if(error.name!=='AbortError')throw error;}
        frames.push({region,patches:frame.patches.length,workerMilliseconds:Math.round(performance.now()-start)});
      }
      const savedWorker=globalThis.Worker;
      globalThis.Worker=undefined;
      try {
        const study=await api.loadResearchStudy('shinjuku');
        try {await api.prepareResearchMap(study,{pattern:'distributed',lossPercent:0,neighbourhood:4});throw Error('Missing Worker ignored');}
        catch(error){if(!error.message.includes('Web Worker required'))throw error;}
      } finally {globalThis.Worker=savedWorker;}
    } finally {clearInterval(timer);}
    return {regions:frames,mainThreadTimerTicks:ticks,cancellation:'AbortError',missingWorker:'explicit_failure',workerMode:'bundled_module'};
  });
  assert.equal(result.regions.length,6);assert.ok(result.mainThreadTimerTicks>0);assert.deepEqual(errors,[]);
  console.log('BROWSER_RESEARCH_AUDIT=PASS '+JSON.stringify(result));
} finally {
  await browser?.close();await new Promise(r=>server.close(r));
}
