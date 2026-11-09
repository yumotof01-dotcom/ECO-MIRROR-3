import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardWorldCover } from '../server/worldcover.mjs';

test('WorldCover endpoint passes only verified bounded ranges from fixed ESA tiles', async () => {
  const endpoint = 'https://test.invalid/api/worldcover?tile=';
  const range = (tile, value) => new Request(endpoint + tile, { headers: { Range: value } });
  const reply = await forwardWorldCover(range('S24W048', 'bytes=0-15'), async (url, options) => {
    assert.match(url, /^https:\/\/esa-worldcover\.s3\.eu-central-1\.amazonaws\.com\/v200\/2021\/map\/ESA_WorldCover_10m_2021_v200_S24W048_Map\.tif$/);
    assert.equal(options.headers.Range, 'bytes=0-15');
    return new Response(new Uint8Array(16), { status: 206, headers: { 'Content-Range': 'bytes 0-15/128' } });
  });
  assert.equal(reply.status, 206);
  assert.equal((await reply.arrayBuffer()).byteLength, 16);
  const unexpected = () => assert.fail('Invalid input reached upstream');
  assert.equal((await forwardWorldCover(range('https://example.com', 'bytes=0-15'), unexpected)).status, 400);
  assert.equal((await forwardWorldCover(range('N33E138', 'bytes=0-99999999'), unexpected)).status, 416);
  assert.equal((await forwardWorldCover(range('N33E138', 'bytes=0-15'), async () => new Response('full file'))).status, 502);
});
