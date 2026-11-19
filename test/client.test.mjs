import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'client.js'), 'utf8');
const allHooks = [];
afterEach(() => {
  for (const hooks of allHooks.splice(0)) hooks.runCleanups();
});

/**
 * A hook-capable stand-in for React that renders plain element trees. Each
 * component instance keeps its own hooks (by its place in the tree), and one a
 * render no longer reaches is dropped at the next, as React unmounts it.
 */
function fakeReact() {
  const root = { key: 'root', slots: [], cursor: 0, kids: 0 };
  const frames = new Map();
  const visited = new Set();
  let stack = [root];
  const top = () => stack[stack.length - 1];
  const hooks = {
    reset() {
      frames.clear();
      visited.clear();
      root.slots = [];
      root.cursor = 0;
      root.kids = 0;
      stack = [root];
    },
    /** Render again with the state kept. */
    rerender() {
      for (const key of [...frames.keys()]) if (!visited.has(key)) frames.delete(key);
      visited.clear();
      root.cursor = 0;
      root.kids = 0;
    },
    useRef(initial) {
      const f = top();
      const index = f.cursor++;
      if (!(index in f.slots)) f.slots[index] = { current: initial };
      return f.slots[index];
    },
    useState(initial) {
      const f = top();
      const index = f.cursor++;
      const slots = f.slots;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => (slots[index] = typeof value === 'function' ? value(slots[index]) : value)];
    },
    cleanups: [],
    /**
     * Runs again when its dependencies change, as React's does. React attaches refs before
     * effects run and this stand-in cannot, so an effect that bailed out (no cleanup returned,
     * as when its ref was not there yet) also runs again on the next render.
     */
    useEffect(effect, deps) {
      const f = top();
      const index = f.cursor++;
      const prev = f.slots[index];
      const changed = !prev || typeof prev.cleanup !== 'function' || !Array.isArray(deps) || !Array.isArray(prev.deps) || deps.length !== prev.deps.length || deps.some((d, i) => !Object.is(d, prev.deps[i]));
      if (!changed) return;
      if (typeof prev?.cleanup === 'function') prev.cleanup();
      const cleanup = effect();
      f.slots[index] = { deps, cleanup };
      if (typeof cleanup === 'function') hooks.cleanups.push(cleanup);
    },
    runCleanups() {
      for (const cleanup of hooks.cleanups.splice(0)) cleanup();
    },
  };
  const createElement = (type, props, ...children) => {
    const kids = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
    if (typeof type === 'function') {
      const parent = top();
      const key = `${parent.key}/${type.name || 'anonymous'}:${props?.key ?? parent.kids++}`;
      if (!frames.has(key)) frames.set(key, []);
      visited.add(key);
      stack.push({ key, slots: frames.get(key), cursor: 0, kids: 0 });
      try {
        return type({ ...(props ?? {}), ...(kids.length ? { children: kids.length === 1 ? kids[0] : kids } : {}) });
      } finally {
        stack.pop();
      }
    }
    return { type, props: props ?? {}, children: kids };
  };
  allHooks.push(hooks);
  return { React: { createElement, useState: hooks.useState, useRef: hooks.useRef, useEffect: hooks.useEffect }, hooks };
}

function loadClient() {
  const { React, hooks } = fakeReact();
  let factory;
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    __ModuleLoader__: {
      load({ id, factory: make }) {
        assert.equal(id, '@kadaliao/dsh-archify');
        factory = make;
      },
    },
  };
  new Function('source', `${source}\n//# sourceURL=client.js`)(source);
  const exports = factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected require ${name}`);
  });
  return { exports, hooks };
}

function fakeContext(extra = {}) {
  const seen = { slots: [], locale: null, decorations: [], selected: [], definitions: [] };
  const all = { layout: { selectPanel: (id) => seen.selected.push(id) }, ...extra };
  const ctx = {
    get: (name) => all[name],
    inject(names, callback) {
      seen.injected = [...(seen.injected ?? []), ...names];
      callback({ effect: (fn) => fn(), commandUi: { decorate: (d) => (seen.decorations.push(d), () => {}) } });
    },
    effect: (fn) => fn(),
    uiConversation: { events: { register: (d) => (seen.definitions.push(d), () => {}) } },
    locale: { register: (ns, dict) => ((seen.locale = { ns, dict }), () => {}) },
    slots: { inject: (_k, cb) => cb(), register: (options, component) => (seen.slots.push({ options, component }), () => {}) },
  };
  return { ctx, seen };
}

function text(node, out = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) text(child, out);
    return out;
  }
  for (const child of node.children ?? []) text(child, out);
  return out;
}
function findAll(node, pred, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, pred, out);
    return out;
  }
  if (pred(node)) out.push(node);
  for (const child of node.children ?? []) findAll(child, pred, out);
  return out;
}

const okMeta = {
  archify: true,
  ok: true,
  type: 'sequence',
  title: 'Checkout',
  status: 'pass',
  gates: { validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'pass' },
  output: '/w/.archify/sequence-checkout-20261117-183000/checkout.html',
  ms: 2600,
  id: 'abc123',
  version: 'v1',
  aspect: 0.5,
};

test('the client registers both tool views, the page row, the panel and /archify', () => {
  const { exports } = loadClient();
  assert.deepEqual(exports.inject, ['slots', 'locale', 'uiConversation']);
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  assert.deepEqual(
    seen.slots.map((s) => [s.options.name, s.options.key ?? s.options.id]),
    [
      ['tool.call.toolview', 'archify_render'],
      ['tool.call.toolview', 'archify_cli'],
      ['tool.call.toolview', 'archify_scan'],
      ['conversation.chat.node', 'archify-page'],
      ['sidebar.panellist', 'archify'],
      ['main', 'archify'],
    ],
  );
  assert.equal(seen.locale.ns, 'archify');
  assert.deepEqual(Object.keys(seen.locale.dict.zh).sort(), Object.keys(seen.locale.dict.en).sort());
  const [decoration] = seen.decorations;
  assert.equal(decoration.name, 'archify');
  decoration.ui.run({});
  assert.deepEqual(seen.selected, ['archify']);
  assert.equal(seen.slots.find((x) => x.options.name === 'sidebar.panellist').component({ size: 20 }).props.width, 20);
});

test('a delivered page becomes a turn-level row; failures and other tools do not', () => {
  const { exports } = loadClient();
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  const [def] = seen.definitions;
  assert.equal(def.kind, 'archify-page');
  assert.equal(def.match({ type: 'tool/call', data: { name: 'archify_render', callId: 'c1' } }), null);
  const result = (meta, callId = 'c1') => ({ type: 'tool/result', surfaceOp: 'append', seq: 7, data: { message: { source: { callId } }, meta } });
  const m = def.match(result(okMeta));
  assert.deepEqual(m, { id: 'c1', role: 'start' });
  const state = def.start({}, { event: result(okMeta) });
  const node = def.buildViewNode({ state, key: 'k', id: 'c1', start: { location: 'x' } });
  assert.equal(node.groupTree, 'turn');
  assert.equal(node.anchorSeq, 7.2);
  const failed = def.start({}, { event: result({ ...okMeta, ok: false, id: undefined }) });
  assert.equal(def.buildViewNode({ state: failed, key: 'k', id: 'c1', start: {} }), null);
  assert.equal(def.match(result({ prompt: 'x', ids: [] }, 'other')), null);

  const row = seen.slots.find((s) => s.options.name === 'conversation.chat.node').component;
  const tree = row({ node: { data: state } });
  assert.equal(findAll(tree, (n) => n.props?.['data-dsh-archify-card'] === 'abc123').length, 1);
  assert.match(text(tree).join(' '), /Checkout/);
});

test('a tall drawing fits the card at a narrower width instead of losing its bottom', () => {
  const { exports, hooks } = loadClient();
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  const [def] = seen.definitions;
  const row = seen.slots.find((s) => s.options.name === 'conversation.chat.node').component;
  const preview = (aspect, cardWidth = 900) => {
    hooks.reset();
    const event = { type: 'tool/result', surfaceOp: 'append', seq: 7, data: { message: { source: { callId: 'c1' } }, meta: { ...okMeta, aspect } } };
    const state = def.start({}, { event });
    let tree = row({ node: { data: state } });
    const [box] = findAll(tree, (n) => n.props?.ref && n.props.style?.cursor === 'zoom-in');
    box.props.ref.current = { clientWidth: cardWidth };
    // One render to measure, one to draw at the measured width.
    for (let i = 0; i < 2; i += 1) {
      hooks.rerender();
      tree = row({ node: { data: state } });
    }
    const [holder] = findAll(tree, (n) => (n.children ?? []).some((c) => c?.type === 'iframe'));
    return { width: holder.props.style.width, height: holder.children[0].props.style.height };
  };
  // A wide drawing fills the card.
  assert.deepEqual(preview(0.5), { width: 900, height: 462 });
  // A tall one (1060×1670) is shown whole at a narrower width, within the cap.
  const tall = preview(1.5755);
  assert.ok(tall.height <= 720, String(tall.height));
  assert.ok(tall.width < 900 && tall.width > 400, String(tall.width));
  assert.ok(Math.abs((tall.width - 16) * 1.5755 + 20 - tall.height) < 1);
});

test('the render tool card shows progress, the gates, and a failure\'s diagnostics', () => {
  const { exports, hooks } = loadClient();
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  const view = seen.slots.find((s) => s.options.key === 'archify_render').component;

  hooks.reset();
  let tree = view({ phase: 'start', block: { callId: 'c1', argsRaw: '{"type":"sequence","name":"checkout","spec":{"meta":{"title":"Chec' } });
  let words = text(tree).join(' ');
  assert.match(words, /Archify/);
  assert.match(words, /Sequence/);
  assert.match(words, /rendering and checking/);

  hooks.reset();
  tree = view({ phase: 'result', block: { callId: 'c1', argsRaw: '{"type":"sequence"}', meta: okMeta, content: [] } });
  words = text(tree).join(' ');
  assert.match(words, /delivered · 2\.6s/);
  assert.match(words, /✓ validate/);

  hooks.reset();
  const failed = { ...okMeta, ok: false, id: undefined, failedStage: 'validate', gates: { validate: 'fail' }, diagnostics: [{ code: 'layout/constraint', severity: 'error', message: 'too close' }], diagnosticTotal: 3 };
  tree = view({ phase: 'result', block: { callId: 'c1', argsRaw: '{"type":"sequence","candidate":"x/candidate.json"}', meta: failed, content: [] } });
  words = text(tree).join(' ');
  assert.match(words, /stopped at validate/);
  assert.match(words, /3 diagnostics/);
  assert.match(words, /repairs the candidate/);

  hooks.reset();
  tree = view({ phase: 'result', block: { callId: 'c1', isError: true, argsRaw: '{"type":"pie"}', content: [{ type: 'text', text: 'type must be one of' }] } });
  assert.match(text(tree).join(' '), /type must be one of/);
});

test('the CLI card shows the command and its exit code', () => {
  const { exports, hooks } = loadClient();
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  const view = seen.slots.find((s) => s.options.key === 'archify_cli').component;
  hooks.reset();
  const tree = view({ phase: 'result', block: { argsRaw: '{"args":["guide","checkout","--json"]}', content: [{ type: 'text', text: 'exit 0\n{}' }] } });
  const words = text(tree).join(' ');
  assert.match(words, /archify guide checkout --json/);
  assert.match(words, /exit 0/);
});

// --- the panel --------------------------------------------------------------------------

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method ?? 'GET', body });
    const reply = routes[String(url).split('?')[0]];
    const value = typeof reply === 'function' ? reply(body, String(url)) : reply;
    return { ok: value !== undefined, json: async () => value };
  };
  return calls;
}
afterEach(() => {
  delete globalThis.fetch;
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ev = { stopPropagation() {}, currentTarget: { style: {} } };
const by = (tree, attr, value) => findAll(tree, (n) => n.props?.[attr] !== undefined && (value === undefined || n.props[attr] === value));

function panelHarness(routes, services = {}) {
  const calls = stubFetch({ '/__dsh_archify/jobs': { jobs: [] }, '/__dsh_archify/state': { canRun: true }, ...routes });
  const { exports, hooks } = loadClient();
  const { ctx, seen } = fakeContext(services);
  exports.apply(ctx);
  const Panel = seen.slots.find((x) => x.options.name === 'main').component;
  const dict = seen.locale.dict.zh;
  const t = (key, params) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));
  const render = () => {
    hooks.rerender();
    return Panel({ t });
  };
  return { calls, render, seen };
}

test('New starts a diagram from a folder and a type in one click, and follows its run', async () => {
  let started = 0;
  const workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', path: '/code/shop', displayTitle: 'shop' }] }) } };
  const { calls, render } = panelHarness(
    {
      '/__dsh_archify/list': { items: [], total: 0, hasMore: false },
      '/__dsh_archify/generate': (b) => ({ ok: true, job: { id: 'j1', kind: 'diagram', type: b.type, dir: b.dir, state: 'running', activity: 'scanning', steps: 2, pages: [], startedAt: Date.now() - 5000, sessionId: 's1' } }),
    },
    { workspaces, uiWorkspace: { startSession: () => (started += 1), openSession: () => {} } },
  );
  let tree = render();
  await flush();
  tree = render();
  // An empty gallery opens on New.
  assert.equal(tree.props['data-dsh-archify-view'], 'new');
  const generate = () => by(tree, 'data-dsh-archify-generate')[0];
  assert.equal(generate().props.disabled, true, 'no folder yet');
  // A recent workspace is one click away.
  const recent = findAll(tree, (n) => n.type === 'button' && n.props.title === '/code/shop')[0];
  recent.props.onClick(ev);
  tree = render();
  by(tree, 'data-dsh-archify-type', 'sequence')[0].props.onClick(ev);
  tree = render();
  by(tree, 'data-dsh-archify-focus')[0].props.onChange({ target: { value: '用户登录' } });
  tree = render();
  assert.equal(generate().props.disabled, false);
  generate().props.onClick(ev);
  await flush();
  const sent = calls.find((c) => c.url === '/__dsh_archify/generate');
  assert.deepEqual(sent.body, { dir: '/code/shop', type: 'sequence', focus: '用户登录', quality: 'showcase', lang: 'zh' });
  tree = render();
  const row = by(tree, 'data-dsh-archify-job', 'j1')[0];
  assert.ok(row, 'the run is listed');
  assert.match(text(row).join(' '), /时序图.*shop.*扫描仓库/);
  // Every card shows what its type looks like, and the chosen one opens its live example.
  assert.equal(findAll(tree, (n) => n.type === 'img' && /\/__dsh_archify\/preview\/sequence-(light|dark)\.webp$/.test(n.props.src)).length >= 2, true);
  by(tree, 'data-dsh-archify-see-example', 'sequence')[0].props.onClick(ev);
  tree = render();
  const frame = findAll(tree, (n) => n.type === 'iframe')[0];
  assert.match(frame.props.src, /^\/__dsh_archify\/example\/sequence\?/);
  assert.match(text(by(tree, 'data-dsh-archify-fullscreen', 'example-sequence')[0]).join(''), /时序图示例/);
  // With a folder the run reads its code; cleared, only the description is drawn, and it is needed.
  assert.equal(by(tree, 'data-dsh-archify-run-kind')[0].props['data-dsh-archify-run-kind'], 'code');
  assert.match(text(by(tree, 'data-dsh-archify-run-kind')[0]).join(''), /shop 的代码/);
  by(tree, 'data-dsh-archify-folder-clear')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-run-kind')[0].props['data-dsh-archify-run-kind'], 'describe');
  by(tree, 'data-dsh-archify-focus')[0].props.onChange({ target: { value: '' } });
  tree = render();
  assert.equal(generate().props.disabled, true, 'nothing to draw yet');
  assert.match(text(by(tree, 'data-dsh-archify-actions')[0]).join(''), /选一个项目文件夹，或者写下要画什么/);
  assert.ok(by(tree, 'data-dsh-archify-draft')[0], 'Open in a conversation is offered');
});

test('Gallery reviews an architecture in the reader\'s language and asks the model for more', async () => {
  const item = { id: 'p1', type: 'architecture', title: 'Shop', path: '/w/shop.html', folder: '/w/.archify/architecture-shop-1', version: 'v1', aspect: 0.6, sessionId: 's1', updatedAt: Date.now() };
  const { calls, render } = panelHarness({
    '/__dsh_archify/list': { items: [item], total: 1, hasMore: false },
    '/__dsh_archify/review': {
      supported: true,
      summary: { components: 6, connections: 7, async: 1, boundaries: 1 },
      findings: [
        { code: 'shared-store', level: 'risk', params: { store: 'DB', n: 3, users: ['A', 'B', 'C'] } },
        { code: 'deep-chain', level: 'warn', params: { hops: 5, path: ['Web', 'API', 'S1', 'S2', 'S3', 'DB'] } },
        { code: 'async-decoupling', level: 'good', params: { bus: ['Queue'] } },
      ],
    },
    '/__dsh_archify/ask': (b) => ({ ok: true, job: { id: 'r1', kind: 'review', pageId: b.id, state: 'running', activity: 'thinking', steps: 0, pages: [], startedAt: Date.now(), sessionId: 's1' } }),
  });
  let tree = render();
  await flush();
  tree = render();
  await flush();
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'gallery');
  // The header says how many points want a look; the review opens beside the drawing.
  const toReview = by(tree, 'data-dsh-archify-to-review', 'p1')[0];
  assert.match(text(toReview).join(''), /点评 · 2/);
  toReview.props.onClick(ev);
  tree = render();
  assert.ok(by(tree, 'data-dsh-archify-review-sheet', 'p1')[0], 'the sheet is open');
  const findings = by(tree, 'data-dsh-archify-finding');
  assert.deepEqual(findings.map((f) => f.props['data-dsh-archify-finding']), ['shared-store', 'deep-chain', 'async-decoupling']);
  assert.match(text(findings[0]).join(''), /风险.*3 个服务直接用同一个数据存储「DB」（A、B、C）/);
  assert.match(text(findings[1]).join(''), /Web → API → S1 → S2 → S3 → DB/);
  assert.match(text(by(tree, 'data-dsh-archify-review', 'p1')[0]).join(''), /6 个组件 · 7 条连线（1 条异步）· 1 个边界/);
  by(tree, 'data-dsh-archify-ask', 'p1')[0].props.onClick(ev);
  await flush();
  assert.deepEqual(calls.find((c) => c.url === '/__dsh_archify/ask').body, { id: 'p1', lang: 'zh' });
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-ask').length, 0, 'the running review replaces the button');
  // Closing the sheet leaves the drawing alone.
  by(tree, 'data-dsh-archify-review-close')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-review-sheet').length, 0);
});

test('Guide lists prompts to copy, and Use fills the New form', async () => {
  const { render } = panelHarness({ '/__dsh_archify/list': { items: [], total: 0, hasMore: false } });
  let tree = render();
  await flush();
  tree = render();
  by(tree, 'data-dsh-archify-tab', 'guide')[0].props.onClick(ev);
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'guide');
  assert.ok(by(tree, 'data-dsh-archify-prompt').length >= 8);
  by(tree, 'data-dsh-archify-use', 'erd')[0].props.onClick(ev);
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'new');
  assert.match(by(tree, 'data-dsh-archify-focus')[0].props.value, /博客系统/);
  assert.equal(by(tree, 'data-dsh-archify-type', 'erd')[0].props.style.border.includes('var(--dsw-alias-brand-primary)'), true);
});

test('every word the client uses is in both dictionaries', async () => {
  const { exports } = loadClient();
  const { ctx, seen } = fakeContext();
  exports.apply(ctx);
  const { en, zh } = seen.locale.dict;
  const used = new Set([...source.matchAll(/\bt\('([\w.-]+)'/g)].map((m) => m[1]));
  for (const f of ['starting', 'thinking', 'loading', 'scanning', 'reading', 'editing', 'rendering', 'delivered']) used.add(`act.${f}`);
  for (const s of ['starting', 'running', 'done', 'ended', 'failed']) used.add(`state.${s}`);
  for (const l of ['risk', 'warn', 'info', 'good']) used.add(`level.${l}`);
  for (const k of ['auto', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer']) used.add(`use.${k}`);
  for (const k of ['code', 'mermaid', 'edit', 'compare', 'explainer', 'brands', 'review', 'viewer']) used.add(`guide.${k}`).add(`guide.${k}.note`);
  const review = readFileSync(join(root, 'lib', 'review.mjs'), 'utf8');
  for (const [, code] of review.matchAll(/add\('([a-z-]+)'/g)) used.add(`rv.${code}`);
  const { activityOf } = await import('../lib/jobs.mjs');
  for (const name of ['archify_render', 'archify_scan', 'load_skill', 'edit', 'read']) used.add(`act.${activityOf(name)}`);
  for (const key of used) {
    assert.ok(key in en, `en: ${key}`);
    assert.ok(key in zh, `zh: ${key}`);
  }
});

test('a wide New keeps the preview beside the form, following the pointer, and flags a missing folder at once', async () => {
  const { render } = panelHarness({
    '/__dsh_archify/list': { items: [], total: 0, hasMore: false },
    '/__dsh_archify/prompt': (b) => ({ ok: true, prompt: `prompt for ${b.dir}`, ...(b.dir === '/nope' ? { folderError: 'not a folder: /nope' } : {}) }),
  });
  let tree = render();
  await flush();
  tree = render();
  // The panel measures itself: wide.
  by(tree, 'data-dsh-archify-panel')[0].props.ref.current = { clientWidth: 1200 };
  tree = render();
  tree = render();
  assert.equal(tree.props['data-dsh-archify-wide'], 'yes');
  const side = () => by(tree, 'data-dsh-archify-side')[0];
  assert.ok(side(), 'the side column is there');
  assert.equal(by(side(), 'data-dsh-archify-example')[0].props['data-dsh-archify-example'], 'architecture');
  by(tree, 'data-dsh-archify-type', 'timeline')[0].props.onMouseEnter();
  tree = render();
  assert.equal(by(side(), 'data-dsh-archify-example')[0].props['data-dsh-archify-example'], 'timeline', 'it follows the pointer');
  by(tree, 'data-dsh-archify-type', 'timeline')[0].props.onMouseLeave();
  tree = render();
  assert.equal(by(side(), 'data-dsh-archify-example')[0].props['data-dsh-archify-example'], 'architecture', 'and goes back to the chosen type');
  // A folder that is not there is said under the field, and Generate waits for a real one.
  by(tree, 'data-dsh-archify-folder')[0].props.onChange({ target: { value: '/nope' } });
  tree = render();
  await new Promise((resolve) => setTimeout(resolve, 350));
  tree = render();
  assert.ok(by(tree, 'data-dsh-archify-folder-error')[0], 'the folder is flagged');
  assert.equal(by(tree, 'data-dsh-archify-generate')[0].props.disabled, true);
  // The prompt opens beside the form, not below it.
  by(tree, 'data-dsh-archify-prompt-toggle')[0].props.onClick(ev);
  tree = render();
  assert.match(text(by(side(), 'data-dsh-archify-prompt-preview')[0]).join(''), /prompt for \/nope/);
});

test('the Guide\'s table of contents follows the scroll, and holds a clicked section until the person scrolls', async () => {
  const { render } = panelHarness({ '/__dsh_archify/list': { items: [], total: 0, hasMore: false } });
  let tree = render();
  await flush();
  tree = render();
  by(tree, 'data-dsh-archify-panel')[0].props.ref.current = { clientWidth: 1200 };
  tree = render();
  tree = render();
  by(tree, 'data-dsh-archify-tab', 'guide')[0].props.onClick(ev);
  tree = render();
  const keys = ['types', 'code', 'mermaid', 'edit', 'compare', 'explainer', 'brands', 'review', 'viewer'];
  // A stand-in scroll box: section i starts at 600·i px; the view is 800 px tall, the content 5600.
  const box = {
    scrollTop: 0,
    clientHeight: 800,
    scrollHeight: 5600,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => nodes,
    querySelector: (sel) => nodes.find((n) => sel.includes(`"${n.key}"`)),
    scrollTo({ top }) {
      this.scrollTop = top;
    },
  };
  const nodes = keys.map((key, i) => ({ key, getAttribute: () => key, getBoundingClientRect: () => ({ top: 600 * i - box.scrollTop }) }));
  const guide = () => by(tree, 'data-dsh-archify-guide')[0];
  guide().props.ref.current = box;
  const active = () => by(tree, 'data-active', 'yes').map((n) => n.props['data-dsh-archify-toc']);
  assert.deepEqual(active(), ['types']);
  // Scrolling down highlights the section at the top of the view.
  box.scrollTop = 1250;
  guide().props.onScroll();
  tree = render();
  assert.deepEqual(active(), ['mermaid']);
  // A click jumps there and holds, even when the page ends below it.
  by(tree, 'data-dsh-archify-toc', 'review')[0].props.onClick(ev);
  tree = render();
  assert.deepEqual(active(), ['review']);
  assert.equal(box.scrollTop, 600 * 7 - 14);
  box.scrollTop = 4800;
  guide().props.onScroll();
  tree = render();
  assert.deepEqual(active(), ['review'], 'the smooth scroll does not move the highlight');
  // Scrolling by hand lets it follow again: at the bottom, the last section.
  guide().props.onWheel();
  guide().props.onScroll();
  tree = render();
  assert.deepEqual(active(), ['viewer']);
  // Every use is a card of its own.
  assert.equal(findAll(tree, (n) => n.type === 'section' && n.props['data-dsh-archify-guide-section']).length, keys.length);
});
