import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
async function read(relative) {return readFile(resolve(root,relative),'utf8');}

test('this package clearly says design-only, no connected science', async()=>{
  const readme=await read('README.md');
  assert.match(readme,/設計基盤/);
  assert.match(readme,/まだ移植していません/);
  assert.match(readme,/yumotof01-dotcom\/ECO-MIRROR-3/);
  assert.match(readme,/研究エンジンの移植や公開Webアプリの完成ではありません/);
});

test('research data contracts cannot claim confirmed animal movements', async()=>{
  const manifest=JSON.parse(await read('contracts/study-manifest.schema.json'));
  assert.equal(manifest.properties.source.properties.observationYear.const,2021);
  assert.equal(manifest.properties.source.properties.license.const,'CC BY 4.0');
  assert.equal(manifest.properties.calculation.properties.scenarioCount.const,440);
  assert.equal(manifest.properties.validation.properties.fieldEcologicalValidation.const,'not_performed');
  assert.ok(manifest.required.includes('caveats'));
});

test('bridge UI must preserve difference between gain and actual patch merger', async()=>{
  const model=JSON.parse(await read('contracts/scenario-view.schema.json'));
  assert.ok(model.properties.bridge.required.includes('mergerConditions'));
  assert.ok(model.properties.bridge.required.includes('newIslandConditions'));
  assert.equal(model.properties.bridge.properties.addedAreaM2.const,400);
  const page=await read('design/prototype.html');
  assert.match(page,/研究データは、まだ接続していません/);
  assert.match(page,/実際の動物の移動を示していません/);
});

test('standalone prototype is keyboard navigable and has no fake data', async()=>{
  const js=await read('design/prototype.js');
  const html=await read('design/prototype.html');
  for(const key of ['ArrowRight','ArrowLeft','Home','End'])assert.ok(js.includes(key));
  assert.match(html,/role="tablist"/);
  assert.match(html,/aria-selected="true"/);
  assert.match(html,/disabled aria-describedby/);
  assert.doesNotMatch(js,/(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});

test('source license and legacy provenance are described explicitly', async()=>{
  const source=await read('docs/13-source-attribution.md');
  const migration=await read('docs/06-migration-plan.md');
  assert.match(source,/10\.5281\/zenodo\.7254221/);
  assert.match(source,/CC BY 4\.0/);
  assert.match(migration,/9a7fa63bc83f350c80ddf775124cd3cbeb6c112e/);
  assert.match(migration,/旧研究/);
});
