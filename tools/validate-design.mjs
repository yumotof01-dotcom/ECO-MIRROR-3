import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const required = [
  'README.md', 'AGENTS.md',
  'docs/01-product-spec.md', 'docs/02-information-architecture.md',
  'docs/03-design-system.md', 'docs/04-architecture.md',
  'docs/05-science-data-contract.md', 'docs/06-migration-plan.md',
  'docs/07-test-plan.md', 'docs/08-milestones.md',
  'docs/09-decisions.md', 'docs/10-risk-register.md',
  'docs/11-github-setup.md', 'docs/12-acceptance-matrix.md',
  'docs/13-source-attribution.md',
  'design/tokens.json', 'design/prototype.html', 'design/prototype.css',
  'design/prototype.js', 'contracts/study-manifest.schema.json',
  'contracts/scenario-view.schema.json'
];
for(const file of required) {
  const source = await readFile(resolve(root, file), 'utf8');
  if (!source.trim()) throw new Error(`${file} is empty`);
}
const tokens = JSON.parse(await readFile(resolve(root, 'design/tokens.json'), 'utf8'));
for (const [name,value] of Object.entries(tokens.colors)) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Color ${name} is not hexadecimal`);
}
for (const name of ['study-manifest', 'scenario-view']) {
  const schema = JSON.parse(await readFile(resolve(root, `contracts/${name}.schema.json`), 'utf8'));
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || !Array.isArray(schema.required))
    throw new Error(`${name}: incomplete proposed schema`);
}
const html = await readFile(resolve(root, 'design/prototype.html'), 'utf8');
for (const mode of ['connectivity','scenario','threshold','bridge']) {
  if (!html.includes(`data-mode="${mode}"`)) throw new Error(`${mode} tab missing`);
}
if (!html.includes('実データは未接続') || !html.includes('実測データや実際の動物の移動を示していません'))
  throw new Error('Scientific placeholders must remain explicit');
const script = await readFile(resolve(root, 'design/prototype.js'), 'utf8');
if (/\b(fetch|XMLHttpRequest|WebSocket)\s*\(/.test(script))
  throw new Error('Prototype must not simulate network data access');
console.log(`Design consistency check PASSED: ${required.length} required documents/assets, 4 UI modes, 2 proposed JSON schemas`);
