import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' };
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + '/')) { response.writeHead(403).end(); return; }
  try { response.setHeader('content-type', mime[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('.artifacts/ui', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [375, 820, 1366]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.screenshot({ path: `.artifacts/ui/home-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole('link', { name: /研究ワークスペースへ/ }).click();
    const tabs = page.getByRole('tab');
    await tabs.nth(0).focus(); await page.keyboard.press('ArrowRight');
    await page.locator('#tab-scenario[aria-selected="true"]').waitFor();
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '地域データを読み込む', exact: true }).click();
    await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
    assert.equal(await page.locator('canvas').count(), 1);
    await page.getByLabel('仮想植生減少率', { exact: true }).fill('25');
    await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
    const baseline = JSON.parse(await readFile('public/studies/worldcover-2021-v200/regions/shinjuku/baseline.json'));
    const expected = baseline.ensemble.conditions.find(row => row.scenarioId === 'distributed-n4-lambda200-loss25');
    const number = value => value.toLocaleString('ja-JP', { maximumSignificantDigits: 6 });
    assert.equal(await page.locator('.research-metrics dd').first().innerText(), number(expected.pc));
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'この条件の結果を保存' }).click();
    const download = await downloadPromise;
    const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(saved.payload.result.pc, expected.pc);
    assert.equal(saved.payload.provenance.regionId, 'shinjuku');
    await tabs.nth(2).click();
    await page.locator('#tab-threshold[aria-selected="true"]').waitFor();
    assert.equal(await page.getByRole('table', { name: '同じ規則・近傍・λでの11条件' }).locator('tbody tr').count(), 11);
    await page.screenshot({ path: `.artifacts/ui/research-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await tabs.nth(3).click();
    await page.getByText('候補の計算結果を検証しました。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('table', { name: '選択条件での追加前後' }).count(), 1);
    await page.getByLabel('仮想植生減少率', { exact: true }).fill('50');
    await page.getByLabel('仮想植生減少率', { exact: true }).fill('10');
    await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
    const finalCondition = baseline.ensemble.conditions.find(row => row.scenarioId === 'distributed-n4-lambda200-loss10');
    assert.equal(await page.locator('.research-metrics dd').first().innerText(), number(finalCondition.pc));
    await page.getByLabel('研究地域', { exact: true }).selectOption('odaiba');
    assert.equal(await page.locator('canvas').count(), 0);
    assert.equal(await page.locator('.research-metrics').count(), 0);
    await page.route('**/studies/**', route => route.abort());
    await page.getByRole('button', { name: '地域データを読み込む', exact: true }).click();
    await page.getByText('データを取得できません。接続を確認して再試行してください。', { exact: true }).waitFor();
    assert.equal(await page.locator('canvas').count(), 0);
    await page.unroute('**/studies/**');
    await page.getByRole('button', { name: '地域データを読み込む', exact: true }).click();
    await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS width=${width}: image layout, keyboard tabs, verified map/PC, curve, candidate, export, region reset, network recovery`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
