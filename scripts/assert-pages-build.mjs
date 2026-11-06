/** Fail the Pages build if its paths silently point to the GitHub domain root.
 * GitHub Pages serves this repo at /ECO-MIRROR-3/, not at /.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', dist), 'utf8');
const base = '/ECO-MIRROR-3/';
if (!html.includes('<div id="root"></div>')) {
  throw new Error('Missing React root in built index.html');
}
const entries = Array.from(html.matchAll(/(?:src|href)="(\/[^"]+)"/g), match => match[1]);
if (!entries.length || !entries.some(path => path.startsWith(base + 'assets/'))) {
  throw new Error('Compiled assets are missing from GitHub Pages subpath');
}
for (const url of entries) {
  if (!url.startsWith(base)) throw new Error('Root-relative asset path would 404 on GitHub Pages: ' + url);
  const local = join(dist.pathname, decodeURIComponent(url.slice(base.length)));
  if (!(await stat(local).catch(() => null))?.isFile()) {
    throw new Error('Asset referenced in index.html was not built: ' + url);
  }
}
const assets = await readdir(new URL('assets/', dist));
if (!assets.some(name => name.endsWith('.js')) || !assets.some(name => name.endsWith('.css'))) {
  throw new Error('Missing app JS or CSS bundle');
}
console.log('PAGES_BUILD_AUDIT=PASS: all root-relative assets use /ECO-MIRROR-3/, React root exists, JavaScript and CSS are present');
