import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeChanges, enumValue, sanitize } from '../lib/sanitize.mjs';
import { SKILL_ROOT, parseJsonOutput, runArchify } from '../lib/run.mjs';

const example = (name) => JSON.parse(readFileSync(join(SKILL_ROOT, 'examples', name), 'utf8'));

async function validate(type, spec) {
  const dir = mkdtempSync(join(tmpdir(), 'archify-sanitize-'));
  const file = join(dir, 'candidate.json');
  writeFileSync(file, JSON.stringify(spec));
  const run = await runArchify(['validate', type, file, '--json', '--quality', spec.meta?.quality_profile ?? 'showcase'], { cwd: dir, timeoutMs: 60_000 });
  return parseJsonOutput(run.stdout);
}

test('enum values are matched by case, separators, synonyms and compound words', () => {
  const types = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
  assert.equal(enumValue('Backend', types), 'backend');
  assert.equal(enumValue('cache', types), 'database');
  assert.equal(enumValue('Kafka', types), 'messagebus');
  assert.equal(enumValue('payment-service', types), 'backend');
  assert.equal(enumValue('redis cache', types), 'database');
  assert.equal(enumValue('something else', types), undefined);
  assert.equal(enumValue('Security_Group', ['region', 'security-group']), 'security-group');
  assert.equal(enumValue('vpc', ['region', 'security-group']), 'security-group');
  assert.equal(enumValue('async', ['default', 'emphasis', 'security', 'dashed']), 'dashed');
});

test('the slips models make in an architecture are fixed, and the result validates', async () => {
  const spec = example('web-app.architecture.json');
  const c = spec.components;
  c[0].icon = 'server';
  c[1].type = 'cache';
  c[2].description = 'not a property';
  c[3].sources = ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js'];
  c[4].label = 'x'.repeat(200);
  spec.boundaries[0].kind = 'VPC';
  spec.connections[0].variant = 'async';
  spec.connections[1].route = 'curvy';
  spec.extra = true;
  delete spec.schema_version;
  const before = JSON.stringify(spec);
  const { spec: fixed, changes } = sanitize('architecture', spec, { quality: 'standard' });
  assert.equal(JSON.stringify(spec), before, 'the input is left alone');
  assert.equal(fixed.schema_version, 1);
  assert.equal(fixed.components[0].icon, 'backend');
  assert.equal(fixed.components[1].type, 'database');
  assert.equal(fixed.components[2].description, undefined);
  assert.deepEqual(fixed.components[3].sources, [{ path: 'src/a.js' }, { path: 'src/b.js' }, { path: 'src/c.js' }]);
  assert.equal(fixed.boundaries[0].kind, 'security-group');
  assert.equal(fixed.connections[0].variant, 'dashed');
  assert.equal(fixed.connections[1].route, undefined);
  assert.equal(fixed.extra, undefined);
  assert.equal(fixed.meta.quality_profile, 'standard');
  const lines = describeChanges(fixed, changes);
  assert.ok(lines.some((l) => /"cache" → "database"/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /kept the first 3 of 4/.test(l)), lines.join('\n'));
  // The label limit, if any, is kept; nothing else about the meaning changed.
  assert.deepEqual(fixed.connections.map((e) => [e.from, e.to]), spec.connections.map((e) => [e.from, e.to]));
  const receipt = await validate('architecture', fixed);
  const errors = (receipt?.diagnostics ?? []).filter((d) => d.severity === 'error' && d.code.startsWith('schema/'));
  assert.deepEqual(errors, [], JSON.stringify(errors));
});

test('a clean candidate comes back unchanged, for every diagram type with an example', () => {
  for (const name of ['web-app.architecture.json', 'agent-tool-call.workflow.json', 'cache-miss-request.sequence.json', 'product-analytics.dataflow.json', 'deployment-release.lifecycle.json', 'orders.erd.json', 'payment-platform.tree.json', 'payments.class.json', 'payment-incident.timeline.json', 'checkout-request.waterfall.json']) {
    const spec = example(name);
    const { spec: fixed, changes } = sanitize(spec.diagram_type, spec, {});
    assert.deepEqual(changes, [], `${name}: ${JSON.stringify(changes)}`);
    assert.deepEqual(fixed, spec, name);
  }
});

test('other types get the same schema-driven fixes', async () => {
  const spec = example('cache-miss-request.sequence.json');
  spec.meta.notes = 'unknown';
  const { spec: fixed, changes } = sanitize('sequence', spec, { quality: spec.meta.quality_profile ?? 'showcase' });
  assert.equal(fixed.meta.notes, undefined);
  assert.ok(changes.some((c) => c.path === '/meta/notes'));
  const receipt = await validate('sequence', fixed);
  assert.deepEqual((receipt?.diagnostics ?? []).filter((d) => d.severity === 'error'), []);
  // Unknown types and non-objects pass through.
  assert.deepEqual(sanitize('nope', { a: 1 }), { spec: { a: 1 }, changes: [] });
  assert.deepEqual(sanitize('architecture', null), { spec: null, changes: [] });
});
