/** Stage 7: built artifacts, real browser engines, emulated viewports and failure injection.
 * Emulated WebKit/tablet is not physical iPad Safari or VoiceOver verification.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const engines=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const name=process.env.RESEARCH_BROWSER??'chromium';
assert.ok(['chromium','firefox','webkit'].includes(name));
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/') {res.setHeader('content-type','text/html;charset=utf-8');res.end('<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width"><title>研究基盤の検証</title><h1>保存・再読込検証</h1><label for="snapshot-file">研究結果JSON</label><input type="file" id="snapshot-file" accept="application/json"><p role="status" id="state"></p></html>');return;}
  const paths=path==='/app/'?['dist/index.html']:path.startsWith('/studies/')?['public'+path]:['dist-research'+path,'dist'+path];
  for(const p of paths) {
    const file=resolve(p);
    if(!file.startsWith(resolve('.')+'/'))continue;
    try {const bytes=await readFile(file);res.setHeader('content-type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path==='/app/'?'text/html;charset=utf-8':'application/json');res.end(bytes);return;}catch{}
  }
  res.writeHead(404).end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const reports=[];
let browser;
try {
  browser=await engines[name].launch({headless:true,...(name==='chromium'?{args:['--js-flags=--max-old-space-size=128'],
    ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})}:{})});
  for(const profile of [{id:'desktop',width:1280,height:900},{id:'tablet_emulation',width:1024,height:1366},{id:'phone_emulation',width:390,height:844}]) {
    console.log('INTEGRATION_PROFILE_START='+name+'/'+profile.id);
    const context=await browser.newContext({viewport:{width:profile.width,height:profile.height},acceptDownloads:true,reducedMotion:'reduce',
      ...(name!=='firefox'&&profile.id!=='desktop'?{isMobile:true,hasTouch:true}:{})});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);
    const result=await page.evaluate(async()=>{
      const api=await import('/research.js');
      const regions=['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba'];
      let roundTrips=0;
      for(const region of regions) {
        const study=await api.loadResearchStudy(region);
        const frame=await api.prepareResearchMap(study,{pattern:'edge_first',lossPercent:50,neighbourhood:8});
        if(frame.regionId!==region||frame.patchLabels.length!==40000)throw Error('Map/region mismatch');
        const c=api.CONDITIONS[0].scenarioId;
        const queries=[{kind:'condition',conditionId:c},{kind:'comparison',beforeId:c,afterId:api.CONDITIONS[1].scenarioId},
          {kind:'curve',pattern:'distributed',neighbourhood:4,lambdaMetres:40},
          {kind:'intervention',siteId:study.candidates[0].site.id,conditionId:c},
          {kind:'candidates',firstSiteId:study.candidates[0].site.id,secondSiteId:study.candidates[1].site.id,conditionId:c}];
        for(const query of queries) {
          const snapshot=await api.createResearchSnapshot(study,query),text=api.serializeResearchSnapshot(snapshot);
          const replay=await api.replayResearchSnapshot(text);
          if(replay.status!=='verified_replay'||replay.provenance.regionId!==region)throw Error('Saved research replay mismatch');
          if(region==='shinjuku'&&query.kind==='condition')globalThis.auditSaved={snapshot,text};
          roundTrips++;
        }
        if(region==='shinjuku')globalThis.auditStudy=study;
      }
      for(let i=0;i<10;i++) {
        const controller=new AbortController(),pending=api.prepareResearchMap(globalThis.auditStudy,{pattern:'distributed',lossPercent:25,neighbourhood:4},controller.signal);
        controller.abort();
        try {await pending;throw Error('Map cancellation ignored');}catch(e){if(e.name!=='AbortError')throw e;}
      }
      globalThis.auditSession=new api.ResearchSession();
      const first=await globalThis.auditSession.select('shinjuku');
      if(first.status!=='ready')throw Error('Session could not load initial region');
      // Rehash deliberately malformed nested containers: integrity alone is not type equality.
      const encode=v=>Array.isArray(v)?'['+v.map(encode).join(',')+']':v&&typeof v==='object'?
        '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+encode(v[k])).join(',')+'}':JSON.stringify(v);
      for(const kind of ['comparison','curve']) {
        const condition=api.CONDITIONS[0],query=kind==='comparison'?{kind,beforeId:condition.scenarioId,afterId:condition.scenarioId}:
          {kind,pattern:condition.pattern,neighbourhood:condition.neighbourhood,lambdaMetres:condition.lambdaMetres};
        const malformed=structuredClone(await api.createResearchSnapshot(globalThis.auditStudy,query));
        if(kind==='comparison')malformed.payload.result.changedAxes={};
        else malformed.payload.result.points={...malformed.payload.result.points};
        malformed.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(encode(malformed.payload)))),b=>b.toString(16).padStart(2,'0')).join('');
        let rejected=false;
        try {await api.replayResearchSnapshot(JSON.stringify(malformed));}catch(e){rejected=e.reason==='REPLAY_MISMATCH';}
        if(!rejected)throw Error('Array/object snapshot mutation was accepted');
      }
      const maps=new api.ResearchMapSession();
      const old=maps.select(globalThis.auditStudy,{pattern:'distributed',lossPercent:0,neighbourhood:4});
      const latest=maps.select(globalThis.auditStudy,{pattern:'edge_first',lossPercent:50,neighbourhood:8});
      if(maps.state.status!=='loading'||'frame' in maps.state)throw Error('Old map retained during selection change');
      await Promise.all([old,latest]);
      if(maps.state.status!=='ready'||maps.state.frame.selection.lossPercent!==50)throw Error('Old condition replaced the latest map');
      return {roundTrips,regions:6,workerCancellations:10,arrayObjectMutationsRejected:2,userAgent:navigator.userAgent};
    });
    const downloaded=page.waitForEvent('download');
    await page.evaluate(async()=>{
      const api=await import('/research.js'),file=api.snapshotFile(globalThis.auditSaved.snapshot);
      const url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=file.filename;
      a.id='snapshot-download';a.textContent='研究JSONを保存';document.body.append(a);
    });
    await page.locator('#snapshot-download').click();
    const download=await downloaded;
    assert.equal(download.suggestedFilename().startsWith('eco-mirror-shinjuku-'),true);
    const bytes=await readFile(await download.path());
    await page.evaluate(()=>{const link=document.getElementById('snapshot-download');URL.revokeObjectURL(link.href);link.remove();});
    await page.locator('#snapshot-file').setInputFiles({name:download.suggestedFilename(),mimeType:'application/json',buffer:bytes});
    assert.equal(await page.evaluate(async()=>{
      const api=await import('/research.js'),file=document.getElementById('snapshot-file').files[0];
      const parsed=await api.readResearchSnapshot(file),replay=await api.replayResearchSnapshot(await file.text());
      return parsed.sha256===globalThis.auditSaved.snapshot.sha256&&replay.status==='verified_replay';
    }),true);
    await page.route('**/studies/**',route=>route.abort());
    assert.deepEqual(await page.evaluate(async()=>{
      const api=await import('/research.js'),pending=globalThis.auditSession.select('osaka');
      const cleared=globalThis.auditSession.state.status==='loading'&&!('study' in globalThis.auditSession.state);
      const final=await pending;
      let replayFailed=false;try {await api.replayResearchSnapshot(globalThis.auditSaved.text);}catch {replayFailed=true;}
      return {cleared,error:final.status==='error',noOldStudy:!('study' in final),replayFailed};
    }),{cleared:true,error:true,noOldStudy:true,replayFailed:true});
    await page.unroute('**/studies/**');
    await page.route('**/baseline.json',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
    assert.equal(await page.evaluate(async()=>{
      const api=await import('/research.js');try{await api.loadResearchStudy('shinjuku');return false;}catch(e){return e.reason==='HASH_MISMATCH';}
    }),true);
    await page.unroute('**/baseline.json');
    await page.route('**/regions/shinjuku/crop.json',async route=>{await new Promise(r=>setTimeout(r,150));await route.continue().catch(()=>{});});
    assert.equal(await page.evaluate(async()=>{
      const api=await import('/research.js'),session=new api.ResearchSession();
      const first=session.select('shinjuku');await new Promise(r=>setTimeout(r,50));
      const second=session.select('osaka');await Promise.all([first,second]);
      return session.state.status==='ready'&&session.state.regionId==='osaka'&&session.state.study.data.regionId==='osaka';
    }),true);
    await page.unroute('**/regions/shinjuku/crop.json');
    let memory=null;
    if(name==='chromium'&&profile.id==='desktop') {
      const cdp=await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
      await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Runtime.getHeapUsage');
      const durations=await page.evaluate(async()=>{
        const api=await import('/research.js'),times=[];
        for(let i=0;i<20;i++) {
          const start=performance.now();await api.prepareResearchMap(globalThis.auditStudy,{pattern:i%2?'edge_first':'distributed',lossPercent:(i%11)*5,neighbourhood:i%2?8:4});
          times.push(Math.round(performance.now()-start));
        }
        return times;
      });
      await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Runtime.getHeapUsage');
      assert.ok(after.usedSize-before.usedSize<32*1024*1024,'Main-thread heap grew by >32MiB after 20 terminated workers');
      memory={scope:'chromium_main_thread_heap_excludes_worker_peak_and_os_rss',beforeBytes:before.usedSize,afterBytes:after.usedSize,
        iterations:20,cpuThrottle:4,rendererHeapFlagMiB:128,maxWorkerMilliseconds:Math.max(...durations)};
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();
    }
    // Existing product shell, not a newly designed UI: keyboard tabs, evidence loader, responsive overflow.
    await page.goto(origin+'/app/#/explore');await page.getByRole('tablist').waitFor();
    const tabs=page.getByRole('tab');assert.equal(await tabs.count(),4);
    await tabs.nth(0).focus();await page.keyboard.press('ArrowRight');
    await page.locator('#tab-scenario[aria-selected="true"]').waitFor();
    await page.keyboard.press('End');
    await page.locator('#tab-bridge[aria-selected="true"]').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Product shell has horizontal overflow');
    await page.goto(origin+'/app/#/evidence');
    await page.getByRole('button',{name:'選択した地域のデータを検証'}).click();
    await page.getByText('SHA-256検証成功',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Evidence page has horizontal overflow');
    assert.deepEqual(errors,[]);
    reports.push({engine:name,profile:profile.id,viewport:{width:profile.width,height:profile.height},...result,
      fileDownloadAndImport:'pass',offline:'pass',tamper:'pass',staleRegion:'pass',keyboardTabs:'pass',evidencePanel:'pass',memory});
    await mkdir('.artifacts',{recursive:true});
    await writeFile(`.artifacts/research-integration-${name}.json`,JSON.stringify({physicalDevice:false,voiceOverTested:false,reports},null,2)+'\n');
    await context.close();
  }
  await mkdir('.artifacts',{recursive:true});
  await writeFile(`.artifacts/research-integration-${name}.json`,JSON.stringify({physicalDevice:false,voiceOverTested:false,reports},null,2)+'\n');
  console.log('RESEARCH_INTEGRATION_AUDIT=PASS '+JSON.stringify({engine:name,profiles:reports.length,snapshotReplays:reports.reduce((s,r)=>s+r.roundTrips,0),reports}));
} finally {await browser?.close();await new Promise(r=>server.close(r));}
