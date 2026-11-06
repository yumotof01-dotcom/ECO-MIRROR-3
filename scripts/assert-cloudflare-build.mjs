/** Assert the Vite production output uses root-relative assets for Cloudflare Pages. */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = await readFile(resolve('dist/index.html'), 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('React mount element is missing');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
if (!assets.length) throw new Error('No absolute /assets paths in HTML');
if (!assets.some(path => path.endsWith('.js')) || !assets.some(path => path.endsWith('.css')))
  throw new Error('Expected JavaScript and CSS asset references');
for (const asset of assets) {
  const file = await stat(resolve('dist', asset.slice(1))).catch(() => null);
  if (!file?.isFile()) throw new Error(`Missing asset: ${asset}`);
}
if (html.includes('/ECO-MIRROR-3/assets/')) throw new Error('GitHub Pages base must not leak into Cloudflare build');
console.log('CLOUDFLARE_BUILD_AUDIT=PASS: root asset paths resolve to real JS/CSS files');
