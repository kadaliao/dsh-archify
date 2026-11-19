import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXAMPLES, PREVIEWS, examplePage, previewFile } from '../lib/examples.mjs';
import { TYPES } from '../lib/paths.mjs';

test('every diagram type has an example and light and dark thumbnails in the package', () => {
  for (const type of TYPES) assert.ok(EXAMPLES[type], type);
  for (const type of Object.keys(EXAMPLES)) {
    for (const theme of ['light', 'dark']) {
      const file = join(PREVIEWS, `${type}-${theme}.webp`);
      assert.ok(existsSync(file), file);
      assert.equal(readFileSync(file).subarray(8, 12).toString(), 'WEBP');
      assert.ok(statSync(file).size < 60 * 1024, `${file} stays small`);
      assert.equal(previewFile(`${type}-${theme}.webp`), file);
    }
  }
  for (const bad of ['../package.json', 'architecture-light.png', 'nope-light.webp', 'architecture-sepia.webp', '']) assert.equal(previewFile(bad), '', bad);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('assets/previews/*.webp'));
});

test('examples render once into the cache, the comparison too', async () => {
  const cache = mkdtempSync(join(tmpdir(), 'archify-examples-'));
  const [a, b] = await Promise.all([examplePage('sequence', cache), examplePage('sequence', cache)]);
  assert.ok(a.endsWith('.html') && existsSync(a));
  assert.equal(a, b, 'one render for two requests');
  const html = readFileSync(a, 'utf8');
  assert.match(html, /Cache Miss Request Sequence/);
  assert.equal(await examplePage('sequence', cache), a);
  const delta = await examplePage('compare', cache);
  assert.ok(delta && existsSync(delta), 'the before/after page renders');
  assert.equal(await examplePage('nope', cache), '');
});
