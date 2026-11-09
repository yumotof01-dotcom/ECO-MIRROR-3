import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { writeArrayBuffer } from 'geotiff';

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
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', geolocation: { latitude: 35.738, longitude: 139.599 }, permissions: ['geolocation'] });
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
    if (width === 1366) {
      for (const region of ['shinjuku', 'osaka', 'nagoya', 'fukuoka', 'sapporo', 'odaiba']) {
        await page.getByLabel('研究地域', { exact: true }).selectOption(region);
        await page.getByRole('tab', { name: /条件を試す/ }).click();
        await page.locator('#tab-scenario[aria-selected="true"]').waitFor();
        // Replacing the region view requires an explicit fresh load.
        if (await page.getByRole('button', { name: '地域データを読み込む', exact: true }).count()) {
          await page.getByRole('button', { name: '地域データを読み込む', exact: true }).click();
        }
        await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
        const data = JSON.parse(await readFile(`public/studies/worldcover-2021-v200/regions/${region}/baseline.json`));
        for (const lambda of [40, 60, 90, 135, 200, 300, 450, 675, 1000, 1500]) {
          await page.getByLabel('仮説λ（m）').selectOption(String(lambda));
          await page.getByLabel('近傍').selectOption('8');
          await page.getByLabel('除去規則').selectOption('edge_first');
          await page.getByLabel('仮想植生減少率', { exact: true }).fill('50');
          await page.getByText('地図の準備ができました。', { exact: true }).waitFor();
          const condition = data.ensemble.conditions.find(row => row.scenarioId === `edge_first-n8-lambda${lambda}-loss50`);
          assert.equal(await page.locator('.research-metrics dd').first().innerText(), number(condition.pc));
        }
        await page.getByRole('tab', { name: /自然の橋を比較/ }).click();
        await page.getByText('候補の計算結果を検証しました。', { exact: true }).waitFor();
        const picker = page.getByLabel('追加候補・参照地点');
        const candidate = await picker.locator('option').nth(1).getAttribute('value');
        await picker.selectOption(candidate);
        await page.getByText('候補の計算結果を検証しました。', { exact: true }).waitFor();
        await page.getByLabel('仮説λ（m）').selectOption('300');
        await page.getByText('候補の計算結果を検証しました。', { exact: true }).waitFor();
        assert.equal(await picker.inputValue(), candidate, 'Changing conditions must preserve the candidate');
        console.log(`PASS region=${region}: all ten lambda options, 8-neighbour edge-first loss50, candidate persistence`);
      }
    }
    // Synthetic TIFF isolates the map-click, worker and download path from public servers.
    if (width === 375 || width === 1366) {
      const sample = new Uint8Array(400 * 400).fill(10);
      for (let row = 193; row < 221; row++) sample.fill(50, row * 400 + 213, row * 400 + 244);
      const tiff = Buffer.from(writeArrayBuffer(sample, {
        width: 400, height: 400, BitsPerSample: [8], SamplesPerPixel: 1, SampleFormat: [1],
        PhotometricInterpretation: 1, ModelPixelScale: [1 / 12000, 1 / 12000, 0],
        ModelTiepoint: [0, 0, 0, 139.58, 35.755, 0], GeographicTypeGeoKey: 4326,
        GTModelTypeGeoKey: 2, GTRasterTypeGeoKey: 1
      }));
      await page.route('https://tile.openstreetmap.org/**', route => route.abort());
      await page.route('**/api/worldcover?tile=*', async route => {
        assert.equal(new URL(route.request().url()).searchParams.get('tile'), 'N33E138');
        const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range);
        const start = Number(first);
        const end = Math.min(Number(last), tiff.length - 1);
        await route.fulfill({ status: 206, headers: {
          'content-type': 'image/tiff', 'content-range': `bytes ${start}-${end}/${tiff.length}`
        }, body: tiff.subarray(start, end + 1) });
      });
      await page.getByRole('link', { name: '地図から調べる', exact: true }).click();
      await page.getByRole('button', { name: '現在地を表示' }).click();
      await page.getByText(/青い丸が現在地/).waitFor();
      await page.getByLabel('解析地点を選ぶ世界地図').click();
      await page.getByRole('button', { name: '緑地を調べる' }).click();
      await page.getByRole('button', { name: '緑地が減った場合を試す' }).click();
      await page.getByText('440条件の計算が完了しました。', { exact: true }).waitFor();
      const currentPc = page.locator('.point-numbers tbody tr').nth(2).locator('td').nth(1);
      assert.ok(parseFloat(await currentPc.innerText()) > .9);
      await page.getByLabel('植生が減る割合').selectOption('50');
      await page.getByText('植生が減った場合の地図', { exact: true }).waitFor();
      assert.ok(parseFloat(await currentPc.innerText()) < 1);
      assert.equal(await page.locator('.point-cover-pair canvas').count(), 2);
      await page.locator('.point-picker-map').click({ position: { x: 110, y: 110 } });
      await page.getByRole('heading', { name: '前に調べた範囲の結果' }).waitFor();
      const savedPoint = page.waitForEvent('download');
      await page.getByRole('button', { name: '結果と出典を保存（JSON）' }).click();
      const report = JSON.parse(await readFile(await (await savedPoint).path(), 'utf8'));
      assert.equal(report.conditions.length, 440);
      assert.ok(Math.abs(report.point.lat - 35.738) < 0.001);
      assert.ok(Math.abs(report.point.lon - 139.599) < 0.001);
      assert.equal(report.missingCells, 0);
      await page.getByRole('button', { name: '街づくり実験室', exact: true }).click();
      const designMap = page.getByRole('button', { name: /配置地図/ });
      await page.getByRole('button', { name: '10倍', exact: true }).click();
      await page.getByText('表示範囲 200m四方', { exact: true }).waitFor();
      await designMap.click();
      await page.getByText('400㎡の緑地を追加しました。').waitFor();
      await page.getByRole('button', { name: '案 B', exact: true }).click();
      await designMap.press('Shift+ArrowRight');
      await designMap.press('Enter');
      await page.getByRole('checkbox', { name: '緑地から離れた場所を表示' }).check();
      await page.getByText(/縦横に移動する格子上の距離/).waitFor();
      await page.getByRole('button', { name: '観察ピン', exact: true }).click();
      await page.getByLabel('選んだ地点の観察メモ').fill('公園のそば');
      await page.getByRole('button', { name: 'ピンを記録' }).click();
      await page.getByText('公園のそば', { exact: false }).last().waitFor();
      await page.getByRole('button', { name: 'この街を比較用に残す' }).click();
      await page.getByText(/別の場所を地図で選び/).waitFor();
      const savedImage = page.waitForEvent('download');
      await page.getByRole('button', { name: '比較画像を保存' }).click();
      const png = await readFile(await (await savedImage).path());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      console.log(`PASS width=${width}: map click, GeoTIFF range read, worker computation, 440 conditions and JSON`);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS width=${width}: image layout, keyboard tabs, verified map/PC, curve, candidate, export, region reset, network recovery`);
    await page.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
