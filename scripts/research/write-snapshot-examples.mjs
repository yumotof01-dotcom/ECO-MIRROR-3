/** Independent schema auditor input. Uses the production-built API, not TypeScript test mocks. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadResearchStudy,createResearchSnapshot,serializeResearchSnapshot,CONDITIONS} from '../../dist-research/research.js';
const fetcher=async input=>new Response(await readFile(resolve('public','.'+new URL(String(input)).pathname)));
await mkdir('.artifacts/snapshot-examples',{recursive:true});
for(const id of ['shinjuku','osaka','nagoya','fukuoka','sapporo','odaiba']) {
  const study=await loadResearchStudy(id,{baseUrl:'http://audit.invalid/',fetcher}),conditionId=CONDITIONS[0].scenarioId;
  const queries=[{kind:'condition',conditionId},{kind:'comparison',beforeId:conditionId,afterId:CONDITIONS[1].scenarioId},
    {kind:'curve',pattern:'distributed',neighbourhood:4,lambdaMetres:40},
    {kind:'intervention',siteId:study.candidates[0].site.id,conditionId},
    {kind:'candidates',firstSiteId:study.candidates[0].site.id,secondSiteId:study.candidates[1].site.id,conditionId}];
  for(const q of queries) {
    const snapshot=await createResearchSnapshot(study,q,{baseUrl:'http://audit.invalid/',fetcher},new Date('2026-11-06T12:00:00.000Z'));
    await writeFile(`.artifacts/snapshot-examples/${id}-${q.kind}.json`,serializeResearchSnapshot(snapshot));
  }
}
console.log('SNAPSHOT_EXAMPLES=30');
