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
      ['tool.call.toolview', 'archify_review'],
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

test('Gallery shows the model\'s checked review beside the drawing, with the code each point rests on', async () => {
  const item = { id: 'p1', type: 'architecture', title: 'Islander', path: '/w/islander.html', folder: '/w/.archify/architecture-islander-1', version: 'v1', aspect: 0.6, sessionId: 's1', updatedAt: Date.now(), reviewedAt: 0 };
  let reviewed = null;
  const { calls, render } = panelHarness({
    '/__dsh_archify/list': () => ({ items: [{ ...item, reviewedAt: reviewed ? 1 : 0 }], total: 1, hasMore: false }),
    '/__dsh_archify/review': () => ({ supported: true, basis: 'code', repo: 'islander', review: reviewed }),
    '/__dsh_archify/ask': (b) => ({ ok: true, job: { id: 'r1', kind: 'review', pageId: b.id, state: 'running', activity: 'reading', steps: 3, pages: [], startedAt: Date.now(), sessionId: 's1' } }),
  });
  let tree = render();
  await flush();
  tree = render();
  await flush();
  tree = render();
  // No review yet: the header offers one, and says what it will rest on.
  const toReview = by(tree, 'data-dsh-archify-to-review', 'p1')[0];
  assert.match(text(toReview).join(''), /^点评$/);
  toReview.props.onClick(ev);
  tree = render();
  const empty = by(tree, 'data-dsh-archify-review-empty', 'code')[0];
  assert.match(text(empty).join(''), /模型读 islander 的代码完成.*插件核对这些位置确实存在后才保存/);
  assert.equal(by(tree, 'data-dsh-archify-finding').length, 0, 'no guessed findings');
  by(tree, 'data-dsh-archify-ask', 'p1')[0].props.onClick(ev);
  await flush();
  assert.deepEqual(calls.find((c) => c.url === '/__dsh_archify/ask').body, { id: 'p1', lang: 'zh' });
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-ask').length, 0, 'the running review replaces the button');
  // The model saved a review: it shows with its basis and each point's citations.
  reviewed = {
    basis: 'code',
    repo: 'islander',
    revision: 'abc1234def5678',
    at: Date.now(),
    software: 'macOS 菜单栏应用（Swift，AppKit + SwiftUI）',
    verdict: '结构清楚，主要风险在对系统菜单栏私有行为的依赖。',
    findings: [
      { level: 'warn', title: '依赖菜单栏窗口层的实现细节', detail: '扫描靠窗口层级判断图标。', suggestion: '加一层检测，失败时提示用户。', evidence: [{ path: 'Islander/MenuBarScanner.swift', line: 40, end_line: 52, excerpt: 'let windows = CGWindowListCopyWindowInfo(...)', more: false, note: '' }] },
      { level: 'good', title: '状态集中在 HiddenItemsStore', detail: '界面只读这一个仓库。', suggestion: '', evidence: [{ path: 'Islander/HiddenItemsStore.swift', line: 1, end_line: 30, excerpt: '@Observable final class HiddenItemsStore', more: true, note: '' }] },
    ],
  };
  tree = render();
  await flush();
  tree = render();
  await new Promise((resolve) => setTimeout(resolve, 5100));
  await flush();
  tree = render();
  await flush();
  tree = render();
  const done = by(tree, 'data-dsh-archify-review-done', 'code')[0];
  assert.ok(done, 'the saved review shows');
  assert.match(text(done).join(''), /结构清楚.*macOS 菜单栏应用.*依据 islander 的代码（提交 abc1234）核实/);
  assert.deepEqual(by(tree, 'data-dsh-archify-finding').map((f) => f.props['data-dsh-archify-finding']), ['warn', 'good']);
  assert.match(text(by(tree, 'data-dsh-archify-to-review', 'p1')[0]).join(''), /点评 · 1/);
  // A citation opens to its code.
  const cite = by(tree, 'data-dsh-archify-cite', 'Islander/MenuBarScanner.swift:40–52')[0];
  assert.ok(cite);
  findAll(cite, (n) => n.type === 'button')[0].props.onClick(ev);
  tree = render();
  assert.match(text(by(tree, 'data-dsh-archify-cite', 'Islander/MenuBarScanner.swift:40–52')[0]).join(''), /CGWindowListCopyWindowInfo/);
  // Closing the side panel leaves the drawing alone.
  by(tree, 'data-dsh-archify-side-close')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-side-sheet').length, 0);
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



test('the "How to use" card names each task, says what its button leads to, and lands there', async () => {
  const items = [
    { id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/workflow-r-1', version: 'v1', aspect: 0.5, updatedAt: Date.now() },
    { id: 'a1', type: 'architecture', title: 'Islander', path: '/w/i.html', folder: '/w/.archify/architecture-i-1', version: 'v1', aspect: 0.6, updatedAt: Date.now() - 1000 },
  ];
  const { render } = panelHarness({
    '/__dsh_archify/list': { items, total: 2, hasMore: false },
    '/__dsh_archify/review': { supported: true, basis: 'code', repo: 'islander', review: null },
  });
  let tree = render();
  await flush();
  tree = render();
  // No Guide tab: two tabs, and a labelled button for the card.
  assert.deepEqual(by(tree, 'data-dsh-archify-tab').map((n) => n.props['data-dsh-archify-tab']), ['new', 'gallery']);
  assert.match(text(by(tree, 'data-dsh-archify-help-open')[0]).join(''), /怎么用/);
  by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
  tree = render();
  await flush();
  tree = render();
  const card = by(tree, 'data-dsh-archify-quick-help')[0];
  assert.deepEqual(by(card, 'data-dsh-archify-help').map((n) => n.props['data-dsh-archify-help']), ['new', 'mermaid', 'chat', 'edit', 'review', 'view', 'explainer', 'rules']);
  // Every item has an action, and no two actions are labelled alike.
  const actions = findAll(card, (n) => n.props?.['data-dsh-archify-help-go'] !== undefined || n.props?.['data-dsh-archify-help-copy'] !== undefined);
  assert.equal(actions.length, 8);
  const labels = actions.map((n) => text(n).join(''));
  assert.equal(new Set(labels).size, labels.length, labels.join(' | '));
  assert.ok(labels.includes('贴 Mermaid') && labels.includes('做讲解页') && labels.includes('改一张图') && labels.includes('点评架构'), labels.join(' | '));
  // The prompt offered to copy works in an empty conversation; the repo one says where it must be said.
  const example = by(card, 'data-dsh-archify-help-copy', 'chat')[0].props.title;
  assert.doesNotMatch(example, /这个仓库|上面|……/);
  assert.match(text(by(card, 'data-dsh-archify-help', 'chat')[0]).join(''), /画仓库要在该项目的会话里说/);
  // The full-screen shortcut key is said to be pressed in full screen, not on the panel.
  assert.match(text(by(card, 'data-dsh-archify-help', 'view')[0]).join(''), /全屏后按键盘上的 \?/);
  // Rules: where they live, said precisely.
  assert.match(text(by(card, 'data-dsh-archify-help', 'rules')[0]).join(''), /~\/\.dsh\/AGENTS\.md.*项目根目录的 AGENTS\.md/);
  // The review item names the diagram it opens, and what it rests on.
  assert.match(text(by(card, 'data-dsh-archify-help', 'review')[0]).join(''), /「Islander」：读代码点评/);

  // Explainers: to New with the type chosen, the caret in "What to draw".
  by(tree, 'data-dsh-archify-help-go', 'new:explainer')[0].props.onClick(ev);
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'new');
  assert.equal(by(tree, 'data-dsh-archify-quick-help').length, 0, 'the card closes');
  assert.match(by(tree, 'data-dsh-archify-type', 'explainer')[0].props.style.border, /brand-primary/, 'the explainer type is chosen');
  const rules = text(by(tree, 'data-dsh-archify-rules-hint')[0]).join('');
  assert.match(rules, /\[archify explainer: proactive\]/);
  assert.match(rules, /~\/\.dsh\/AGENTS\.md/);
  let focused = 0;
  by(tree, 'data-dsh-archify-focus')[0].props.ref.current = { focus: () => (focused += 1), scrollIntoView() {} };
  tree = render();
  tree = render();
  assert.equal(focused, 1, 'the caret waits in What to draw, once');

  // Mermaid: the box says it is where the Mermaid goes.
  by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
  tree = render();
  by(tree, 'data-dsh-archify-help-go', 'new:mermaid')[0].props.onClick(ev);
  // Already on New: the form takes the jump during a render, which React repeats at once and this stand-in at the next.
  tree = render();
  tree = render();
  assert.match(text(by(tree, 'data-dsh-archify-mermaid-hint')[0]).join(''), /Mermaid 贴进下面这个框/);
  assert.match(by(tree, 'data-dsh-archify-focus')[0].props.placeholder, /Mermaid/);
  by(tree, 'data-dsh-archify-focus')[0].props.ref.current = { focus: () => (focused += 1), scrollIntoView() {} };
  tree = render();
  tree = render();
  assert.equal(focused, 2, 'focused again for the new jump');
  // Best fit's examples are whole examples, not the placeholder again.
  by(tree, 'data-dsh-archify-type', 'auto')[0].props.onClick(ev);
  tree = render();
  const chips = findAll(tree, (n) => n.type === 'button' && typeof n.props.title === 'string' && /扫码登录|请假流程|DNS/.test(n.props.title));
  assert.ok(chips.length >= 2, 'whole examples for Best fit');
  assert.equal(findAll(tree, (n) => n.type === 'button' && /……/.test(n.props.title ?? '')).length, 0);

  // Review: to the Gallery, the architecture selected, its review open beside it.
  by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
  tree = render();
  by(tree, 'data-dsh-archify-help-go', 'gallery:review')[0].props.onClick(ev);
  await flush();
  tree = render();
  await flush();
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'gallery');
  assert.equal(by(tree, 'data-dsh-archify-side-panel')[0].props['data-dsh-archify-side-panel'], 'review');
  assert.ok(by(tree, 'data-dsh-archify-review', 'a1')[0], 'the architecture is the one shown');
});

test('the card closes on a press outside it, on a click into the drawing, and on Esc', async () => {
  const items = [{ id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/workflow-r-1', version: 'v1', aspect: 0.5, updatedAt: Date.now() }];
  const { render } = panelHarness({ '/__dsh_archify/list': { items, total: 1, hasMore: false } });
  const listeners = {};
  globalThis.window.addEventListener = (type, fn) => (listeners[type] ??= []).push(fn);
  globalThis.window.removeEventListener = (type, fn) => (listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn));
  const fire = (type, e) => (listeners[type] ?? []).slice(-1)[0]?.(e);
  let tree = render();
  await flush();
  tree = render();
  const open = () => {
    by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
    tree = render();
    assert.ok(by(tree, 'data-dsh-archify-quick-help')[0], 'open');
  };
  open();
  // A press inside the card, or on its own button, leaves it open.
  fire('pointerdown', { target: { closest: () => ({}) } });
  tree = render();
  assert.ok(by(tree, 'data-dsh-archify-quick-help')[0], 'a press inside keeps it');
  // A press anywhere else closes it.
  fire('pointerdown', { target: { closest: () => null } });
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-quick-help').length, 0, 'a press outside closes it');
  // A click into the drawing: the iframe takes focus and the window blurs.
  open();
  globalThis.document = { activeElement: { tagName: 'IFRAME' } };
  try {
    fire('blur', {});
    await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    delete globalThis.document;
  }
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-quick-help').length, 0, 'a click into the drawing closes it');
  open();
  fire('keydown', { key: 'Escape' });
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-quick-help').length, 0, 'Esc closes it');
});

test('the card\'s Review keeps an architecture selection, else prefers one drawn from code, and says so when there is none', async () => {
  const items = [
    { id: 'aws', type: 'architecture', title: 'AWS + Stripe', path: '/w/aws.html', folder: '/w/.archify/a-aws', version: 'v1', aspect: 0.6, updatedAt: Date.now() },
    { id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/w-r', version: 'v1', aspect: 0.5, updatedAt: Date.now() - 1000 },
    { id: 'isl', type: 'architecture', title: 'Islander', path: '/w/i.html', folder: '/w/.archify/a-isl', version: 'v1', aspect: 0.6, updatedAt: Date.now() - 2000 },
  ];
  const basis = { aws: 'description', isl: 'code' };
  const { render } = panelHarness({
    '/__dsh_archify/list': { items, total: 3, hasMore: false },
    '/__dsh_archify/review': (_b, url) => {
      const id = new URL(url, 'http://x').searchParams.get('id');
      return { supported: true, basis: basis[id], repo: basis[id] === 'code' ? 'islander' : '', review: null };
    },
  });
  let tree = render();
  await flush();
  tree = render();
  const reviewVia = async (pick) => {
    by(tree, 'data-dsh-archify-item', pick)[0].props.onClick(ev);
    tree = render();
    by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
    tree = render();
    await flush();
    tree = render();
    const line = text(by(tree, 'data-dsh-archify-help', 'review')[0]).join('');
    by(tree, 'data-dsh-archify-help-go', 'gallery:review')[0].props.onClick(ev);
    await flush();
    tree = render();
    await flush();
    tree = render();
    assert.equal(by(tree, 'data-dsh-archify-side-panel')[0].props['data-dsh-archify-side-panel'], 'review');
    return { shown: by(tree, 'data-dsh-archify-review')[0].props['data-dsh-archify-review'], line };
  };
  // The code-drawn architecture selected (the last row): it stays selected.
  let r = await reviewVia('isl');
  assert.equal(r.shown, 'isl');
  assert.match(r.line, /「Islander」：读代码点评/);
  // An architecture drawn from a description, selected on purpose: it stays too, and the card says what its review is.
  r = await reviewVia('aws');
  assert.equal(r.shown, 'aws');
  assert.match(r.line, /「AWS \+ Stripe」是按描述画的/);
  // A workflow selected: the architecture drawn from code, not the first in the list.
  r = await reviewVia('w1');
  assert.equal(r.shown, 'isl');
  assert.match(r.line, /「Islander」/);
});

test('with no architecture the card says so in place, and with nothing drawn it offers what can be done', async () => {
  const flow = { id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/w-r', version: 'v1', aspect: 0.5, updatedAt: Date.now() };
  let list = [flow];
  const { render } = panelHarness({ '/__dsh_archify/list': () => ({ items: list, total: list.length, hasMore: false }) });
  let tree = render();
  await flush();
  tree = render();
  by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
  tree = render();
  let card = by(tree, 'data-dsh-archify-quick-help')[0];
  assert.match(text(by(card, 'data-dsh-archify-help', 'review')[0]).join(''), /还没有架构图/);
  assert.equal(by(card, 'data-dsh-archify-help-go', 'gallery:review').length, 0, 'no jump to an unrelated panel');
  by(card, 'data-dsh-archify-help-go', 'new:architecture')[0].props.onClick(ev);
  tree = render();
  assert.equal(tree.props['data-dsh-archify-view'], 'new');
  assert.match(by(tree, 'data-dsh-archify-type', 'architecture')[0].props.style.border, /brand-primary/);

  // An empty gallery: nothing to change; full screen shows an example instead.
  list = [];
  const fresh = panelHarness({ '/__dsh_archify/list': { items: [], total: 0, hasMore: false } });
  tree = fresh.render();
  await flush();
  tree = fresh.render();
  by(tree, 'data-dsh-archify-help-open')[0].props.onClick(ev);
  tree = fresh.render();
  card = by(tree, 'data-dsh-archify-quick-help')[0];
  assert.match(text(by(card, 'data-dsh-archify-help', 'edit')[0]).join(''), /还没有画好的图/);
  assert.equal(by(card, 'data-dsh-archify-help-go', 'gallery:edit').length, 0);
  by(card, 'data-dsh-archify-help-go', 'view:example')[0].props.onClick(ev);
  tree = fresh.render();
  assert.ok(by(tree, 'data-dsh-archify-fullscreen', 'example-architecture')[0], 'an example opens full screen');
});

test('Edit sends a change to the conversation that drew the diagram, from a suggestion or own words', async () => {
  const item = { id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/workflow-r-1', version: 'v1', aspect: 0.5, sessionId: 's1', updatedAt: Date.now() };
  const { calls, render } = panelHarness({
    '/__dsh_archify/list': { items: [item], total: 1, hasMore: false },
    '/__dsh_archify/edit': (b) => ({ ok: true, job: { id: 'e1', kind: 'edit', pageId: b.id, focus: b.text, state: 'running', activity: 'editing', steps: 1, pages: [], startedAt: Date.now(), sessionId: 's1' } }),
  });
  let tree = render();
  await flush();
  tree = render();
  // A workflow has no review: only Edit.
  assert.equal(by(tree, 'data-dsh-archify-to-review').length, 0);
  by(tree, 'data-dsh-archify-to-edit', 'w1')[0].props.onClick(ev);
  tree = render();
  assert.ok(by(tree, 'data-dsh-archify-side-sheet', 'w1')[0], 'the panel slides over the drawing');
  assert.deepEqual(by(tree, 'data-dsh-archify-side-tab').map((n) => n.props['data-dsh-archify-side-tab']), ['edit']);
  const send = () => by(tree, 'data-dsh-archify-edit-send', 'w1')[0];
  assert.equal(send().props.disabled, true, 'nothing to send yet');
  // A suggestion fills the box, to adjust before sending.
  by(tree, 'data-dsh-archify-edit-chip')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-edit-text')[0].props.value, '整理一下布局，减少交叉和绕线');
  send().props.onClick(ev);
  await flush();
  assert.deepEqual(calls.find((c) => c.url === '/__dsh_archify/edit').body, { id: 'w1', text: '整理一下布局，减少交叉和绕线', lang: 'zh' });
  tree = render();
  assert.match(text(by(tree, 'data-dsh-archify-job', 'e1')[0]).join(''), /修改候选图/);
  assert.equal(send().props.disabled, true, 'one change at a time');
});

test('a suggestion with a blank selects the blank, and Send waits until it is filled', async () => {
  const item = { id: 'a1', type: 'architecture', title: 'Islander', path: '/w/i.html', folder: '/w/.archify/a-i', version: 'v1', aspect: 0.6, sessionId: 's1', updatedAt: Date.now() };
  const { calls, render } = panelHarness({
    '/__dsh_archify/list': { items: [item], total: 1, hasMore: false },
    '/__dsh_archify/review': { supported: true, basis: 'code', repo: 'islander', review: null },
    '/__dsh_archify/edit': (b) => ({ ok: true, job: { id: 'e1', kind: 'edit', pageId: b.id, focus: b.text, state: 'running', activity: 'editing', steps: 1, pages: [], startedAt: Date.now(), sessionId: 's1' } }),
  });
  let tree = render();
  await flush();
  tree = render();
  by(tree, 'data-dsh-archify-to-edit', 'a1')[0].props.onClick(ev);
  tree = render();
  // Complete suggestions come first; brand marks are not the first offer.
  const chips = by(tree, 'data-dsh-archify-edit-chip');
  const kinds = chips.map((c) => c.props['data-dsh-archify-edit-chip']);
  assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a === 'complete' ? -1 : 1)), 'complete before blank');
  assert.ok(kinds.includes('blank'));
  assert.doesNotMatch(text(chips[0]).join(''), /品牌/);
  assert.ok(by(tree, 'data-dsh-archify-edit-note')[0], 'the note shows: there are blanks among the suggestions');
  const send = () => by(tree, 'data-dsh-archify-edit-send', 'a1')[0];
  // Picking one with a blank: the blank is selected, ready to type over, and Send waits.
  const selection = [];
  by(tree, 'data-dsh-archify-edit-text')[0].props.ref.current = { focus() {}, setSelectionRange: (a, b) => selection.push([a, b]) };
  const split = chips.find((c) => /拆成两个组件/.test(text(c).join('')));
  split.props.onClick(ev);
  tree = render();
  tree = render();
  const value = by(tree, 'data-dsh-archify-edit-text')[0].props.value;
  assert.equal(value, '把「……」拆成两个组件：……');
  assert.deepEqual(selection.at(-1), [2, 4], 'the first blank is selected');
  assert.equal(send().props.disabled, true, 'not with the dots still in');
  assert.match(text(by(tree, 'data-dsh-archify-edit-blank')[0]).join(''), /先把「……」换成你的内容/);
  send().props.onClick(ev);
  await flush();
  assert.equal(calls.filter((c) => c.url === '/__dsh_archify/edit').length, 0, 'nothing sent');
  // One blank filled, one left: still waiting. Both filled: it goes.
  by(tree, 'data-dsh-archify-edit-text')[0].props.onChange({ target: { value: '把「支付服务」拆成两个组件：……' } });
  tree = render();
  assert.equal(send().props.disabled, true);
  by(tree, 'data-dsh-archify-edit-text')[0].props.onChange({ target: { value: '把「支付服务」拆成两个组件：支付和对账' } });
  tree = render();
  assert.equal(send().props.disabled, false);
  assert.equal(by(tree, 'data-dsh-archify-edit-blank').length, 0);
  send().props.onClick(ev);
  await flush();
  assert.equal(calls.find((c) => c.url === '/__dsh_archify/edit').body.text, '把「支付服务」拆成两个组件：支付和对账');
});

test('Edit sits beside the drawing while the drawing keeps a usable width, over it only when it cannot', async () => {
  const item = { id: 'w1', type: 'workflow', title: 'Release', path: '/w/r.html', folder: '/w/.archify/w-r', version: 'v1', aspect: 0.5, sessionId: 's1', updatedAt: Date.now() };
  const { render } = panelHarness({ '/__dsh_archify/list': { items: [item], total: 1, hasMore: false } });
  let tree = render();
  await flush();
  tree = render();
  // A workflow has no blanks among its suggestions: no note about them.
  by(tree, 'data-dsh-archify-to-edit', 'w1')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-edit-note').length, 0);
  const paneAt = (width) => {
    findAll(tree, (n) => n.props?.ref && n.props.style?.padding === 16 && n.props.style?.overflow === 'auto')[0].props.ref.current = { clientWidth: width };
    tree = render();
    tree = render();
  };
  // A 1180px window: the pane is about 716px once the list narrows. Docked, the drawing refit beside it.
  paneAt(716);
  assert.equal(by(tree, 'data-dsh-archify-list')[0].props.style.width, 184, 'the list narrows');
  assert.equal(by(tree, 'data-dsh-archify-side-panel')[0].props['data-dsh-archify-docked'], 'yes');
  assert.equal(by(tree, 'data-dsh-archify-side-sheet').length, 0);
  const [holder] = findAll(tree, (n) => (n.children ?? []).some((c) => c?.type === 'iframe'));
  assert.ok(holder.props.style.width >= 300 && holder.props.style.width <= 716 - 34 - 300 - 16, String(holder.props.style.width));
  // Really no room: over the drawing.
  paneAt(560);
  assert.ok(by(tree, 'data-dsh-archify-side-sheet', 'w1')[0]);
  // Closed, the list has its width back.
  by(tree, 'data-dsh-archify-side-close')[0].props.onClick(ev);
  tree = render();
  assert.equal(by(tree, 'data-dsh-archify-list')[0].props.style.width, 240);
});
