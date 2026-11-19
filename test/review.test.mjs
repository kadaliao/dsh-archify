import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findingLines, graphOf, reviewArchitecture } from '../lib/review.mjs';
import { SKILL_ROOT } from '../lib/run.mjs';

const comp = (id, type, label = id) => ({ id, type, label });
const conn = (from, to, variant) => ({ id: `${from}-${to}`, from, to, ...(variant ? { variant } : {}) });

test('a tangled system gets its risks named', () => {
  const spec = {
    diagram_type: 'architecture',
    components: [comp('web', 'frontend', 'Web'), comp('orders', 'backend', 'Orders'), comp('stock', 'backend', 'Stock'), comp('pay', 'backend', 'Payments'), comp('notify', 'backend', 'Notify'), comp('db', 'database', 'Main DB'), comp('psp', 'external', 'PSP'), comp('old', 'backend', 'Legacy'), comp('a', 'backend', 'A'), comp('b', 'backend', 'B')],
    connections: [conn('web', 'orders'), conn('web', 'stock'), conn('web', 'pay'), conn('web', 'db'), conn('orders', 'stock'), conn('stock', 'orders'), conn('orders', 'db'), conn('stock', 'db'), conn('pay', 'db'), conn('pay', 'psp'), conn('pay', 'notify'), conn('notify', 'a'), conn('a', 'b'), conn('b', 'notify', 'dashed')],
  };
  const r = reviewArchitecture(spec);
  const codes = r.findings.map((f) => f.code);
  assert.ok(codes.includes('shared-store'));
  assert.equal(r.findings.find((f) => f.code === 'shared-store').params.n, 3);
  assert.ok(codes.includes('client-to-store'));
  assert.ok(codes.includes('client-fanout'));
  assert.deepEqual(r.findings.find((f) => f.code === 'cycle').params.names.sort(), ['Orders', 'Stock']);
  assert.ok(codes.includes('external-deps'));
  assert.ok(codes.includes('no-security'));
  assert.deepEqual(r.findings.find((f) => f.code === 'isolated').params.names, ['Legacy']);
  assert.ok(!codes.includes('async-decoupling'));
  // An async edge back is not a cycle.
  assert.ok(!r.findings.some((f) => f.code === 'cycle' && f.params.names.includes('Notify')));
  // Most serious first.
  const order = { risk: 0, warn: 1, info: 2, good: 3 };
  assert.deepEqual(r.findings.map((f) => order[f.level]), [...r.findings.map((f) => order[f.level])].sort((x, y) => x - y));
  assert.deepEqual(r.summary.byType.backend, 7);
  assert.ok(findingLines(r).every((l) => /^- \[(risk|warn|info|good)\] /.test(l)));
});

test('long synchronous chains end at stores, and good structure is noted', () => {
  const chain = ['c', 's1', 's2', 's3', 's4', 's5'];
  const spec = {
    diagram_type: 'architecture',
    components: [comp('c', 'frontend'), ...chain.slice(1).map((id) => comp(id, 'backend')), comp('gw', 'security', 'Gateway'), comp('db', 'database'), comp('db2', 'database'), comp('q', 'messagebus', 'Queue')],
    connections: [conn('c', 's1'), conn('s1', 's2'), conn('s2', 's3'), conn('s3', 's4'), conn('s4', 's5'), conn('s5', 'db'), conn('s1', 'db2'), conn('s3', 'q', 'dashed')],
  };
  const r = reviewArchitecture(spec);
  const deep = r.findings.find((f) => f.code === 'deep-chain');
  assert.equal(deep.params.hops, 6);
  assert.equal(deep.params.path.at(-1), 'db');
  assert.ok(r.findings.some((f) => f.code === 'stores-owned'));
  assert.ok(r.findings.some((f) => f.code === 'async-decoupling'));
  assert.ok(r.findings.some((f) => f.code === 'client-fanout') === false);
});

test('Archify\'s own examples raise no risk, and other diagrams are not reviewed', () => {
  for (const name of ['web-app.architecture.json', 'production-deployment.architecture.json', 'checkout-platform.head.architecture.json']) {
    const r = reviewArchitecture(JSON.parse(readFileSync(join(SKILL_ROOT, 'examples', name), 'utf8')));
    assert.equal(r.supported, true);
    assert.deepEqual(r.findings.filter((f) => f.level === 'risk'), [], name);
  }
  assert.deepEqual(reviewArchitecture({ diagram_type: 'sequence' }), { supported: false, findings: [] });
  assert.deepEqual(reviewArchitecture(null), { supported: false, findings: [] });
  // Connections to unknown ids and self loops are ignored.
  const g = graphOf({ components: [comp('a', 'backend')], connections: [conn('a', 'a'), conn('a', 'zz')] });
  assert.equal(g.edges.length, 0);
});
