/**
 * A quick structural review of the system an Architecture diagram describes:
 * heuristics over its components (typed frontend, backend, database, cloud,
 * security, messagebus, external), its connections (read as "calls or sends
 * to"; `dashed` ones as asynchronous) and its boundaries. It reads the drawing,
 * not the code, so each finding is a question to check rather than a verdict;
 * the model's review in the conversation goes deeper.
 *
 * What matters depends on what the software is, so the review first decides
 * which kind the drawing describes, from its own words: an app that runs on one
 * machine (desktop, mobile, a CLI, a plugin, a library), whose parts are
 * modules in one process, or a system of networked services. Gateways, scaling,
 * queues and monitoring are questions for the second kind only; the first is
 * checked for its shared state, core modules, what it leans on outside itself
 * and the system permissions it needs. The panel shows the kind it assumed and
 * lets the reader switch.
 *
 * Findings carry a code and parameters, so the panel words them in the
 * reader's language.
 */

const list = (x) => (Array.isArray(x) ? x : []);
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const GATEWAY = /gateway|网关|\bbff\b|proxy|代理|nginx|ingress|load ?balancer|负载均衡|\blb\b|edge|envoy|traefik|kong|apisix|api ?网关/i;
/** Words of software that runs on one machine: windows and views, app frameworks, in-process state, OS integrations. */
const APP_WORDS = /\b(windows?|panels?|nspanel|nswindow|views?|view ?controllers?|view ?models?|swiftui|appkit|uikit|cocoa|electron|tauri|flutter|menu ?bar|status ?(item|bar)|toolbar|sidebar|tabs?|dialogs?|preferences|@observable|observableobject|in-memory|core ?data|userdefaults|sqlite|keychain|accessibility|screen ?recording|cgwindow\w*|nsworkspace|macos|ios|ipados|android|desktop|cli|command[- ]line|plugins?|extensions?|add-?ons?|library|sdk|modules?|in-process|hotkeys?|shortcuts?)\b|窗口|面板|菜单|菜单栏|状态栏|视图|界面|设置|偏好|内存|本地|本机|辅助功能|屏幕录制|权限|插件|扩展|命令行|模块|进程内|桌面|快捷键|侧栏|标签页/i;
/** Words of networked services: protocols and endpoints, servers and clusters, deployment, brokers, database servers. */
const SERVICE_WORDS = /\b(https?|rest|grpc|graphql|websockets?|apis?|endpoints?|servers?|microservices?|workers?|cron ?jobs?|lambda|serverless|kubernetes|k8s|pods?|containers?|docker|nginx|gateways?|cdn|load ?balancers?|dns|clusters?|deploy(ment)?s?|replicas?|shards?|kafka|rabbitmq|sqs|sns|pub\/?sub|redis|postgres(ql)?|mysql|mongo(db)?|elasticsearch|s3|rds|vpc|subnets?|ingress|egress|tenants?)\b|服务器|微服务|集群|部署|网关|负载均衡|副本|分片|机房|云服务|多租户/i;
/** Parts that need a permission from the operating system. */
const PERMISSION = /需[^，,。；;·|]{0,8}(权限|授权|辅助功能|屏幕录制)|辅助功能|屏幕录制|全盘访问|完全磁盘访问|麦克风|摄像头|定位服务|\b(accessibility|screen ?recording|full disk access|microphone|camera access|location services|tcc)\b|\brequires? [\w -]{0,24}permission/i;

/**
 * Which kind of software a drawing describes: `app` (one machine, modules in one process) or
 * `service` (networked services), with the score behind it.
 */
export function kindOf(spec) {
  let app = 0;
  let service = 0;
  const count = (text) => {
    const t = String(text ?? '');
    app += (t.match(new RegExp(APP_WORDS.source, 'gi')) ?? []).length;
    service += (t.match(new RegExp(SERVICE_WORDS.source, 'gi')) ?? []).length;
  };
  count(`${spec?.meta?.title ?? ''} ${spec?.meta?.subtitle ?? ''}`);
  for (const c of list(spec?.components)) {
    if (!isObject(c)) continue;
    // What it leans on outside itself says little about what the software is.
    if (c.type !== 'external') count(`${c.label ?? ''} ${c.sublabel ?? ''} ${c.tag ?? ''}`);
    if (c.type === 'cloud' || c.type === 'messagebus') service += 2;
  }
  for (const e of list(spec?.connections)) if (isObject(e)) count(e.label);
  // A boundary is weak evidence: models draw any split (host and client, two processes) as one.
  for (const b of list(spec?.boundaries)) if (isObject(b)) service += 1;
  return { kind: app > 0 && app >= service ? 'app' : 'service', app, service };
}

const OBSERVE = /monitor|监控|metric|指标|log|日志|trace|追踪|tracing|prometheus|grafana|sentry|datadog|otel|opentelemetry|alert|告警/i;

/** The graph of a candidate: nodes by id, edges, and each node's neighbors. */
export function graphOf(spec) {
  const nodes = new Map();
  for (const c of list(spec?.components)) {
    if (!isObject(c) || c.id === undefined) continue;
    nodes.set(String(c.id), { id: String(c.id), type: String(c.type ?? ''), label: String(c.label ?? c.id), text: `${c.label ?? ''} ${c.sublabel ?? ''} ${c.tag ?? ''} ${c.id}`, out: new Set(), in: new Set(), syncOut: new Set() });
  }
  const edges = [];
  for (const e of list(spec?.connections)) {
    if (!isObject(e)) continue;
    const from = String(e.from);
    const to = String(e.to);
    if (from === to || !nodes.has(from) || !nodes.has(to)) continue;
    const async = e.variant === 'dashed';
    edges.push({ from, to, async, label: String(e.label ?? '') });
    nodes.get(from).out.add(to);
    nodes.get(to).in.add(from);
    if (!async) nodes.get(from).syncOut.add(to);
  }
  return { nodes, edges };
}

/** Strongly connected groups of two or more nodes over `next` (Tarjan). */
function cycles(ids, next) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const out = [];
  const visit = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const group = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        group.push(w);
      } while (w !== v);
      if (group.length > 1) out.push(group.reverse());
    }
  };
  for (const v of ids) if (!idx.has(v)) visit(v);
  return out;
}

/** The longest synchronous chain from a starting node, as ids; none through a cycle. */
function longestChain(start, nodes, blocked) {
  const memo = new Map();
  const walk = (v, seen) => {
    if (memo.has(v)) return memo.get(v);
    let best = [v];
    // A chain of calls ends where the work lands: a store, a queue, an outside service.
    if (seen.size > 1 && ['database', 'messagebus', 'external'].includes(nodes.get(v).type)) {
      memo.set(v, best);
      return best;
    }
    for (const w of nodes.get(v).syncOut) {
      if (seen.has(w) || blocked.has(w)) continue;
      seen.add(w);
      const path = walk(w, seen);
      seen.delete(w);
      if (path.length + 1 > best.length) best = [v, ...path];
    }
    memo.set(v, best);
    return best;
  };
  return walk(start, new Set([start]));
}

/**
 * Review one Architecture candidate.
 * @returns {{supported: boolean, summary?: object, findings: Array<{code: string, level: 'risk'|'warn'|'info'|'good', params: object}>}}
 */
export function reviewArchitecture(spec, { kind: asked } = {}) {
  if (!isObject(spec) || spec.diagram_type !== 'architecture') return { supported: false, findings: [] };
  const guessed = kindOf(spec);
  const kind = asked === 'app' || asked === 'service' ? asked : guessed.kind;
  const { nodes, edges } = graphOf(spec);
  const all = [...nodes.values()];
  const of = (type) => all.filter((n) => n.type === type);
  const label = (id) => nodes.get(id)?.label ?? id;
  const boundaries = list(spec.boundaries).filter(isObject);
  const findings = [];
  const add = (code, level, params = {}) => findings.push({ code, level, params });

  const stores = of('database');
  const clients = of('frontend');
  const others = Math.max(1, all.length - 1);
  const service = (id) => !['database', 'messagebus'].includes(nodes.get(id).type);
  const loops = cycles([...nodes.keys()].filter((id) => service(id) && nodes.get(id).type !== 'external'), (v) => [...nodes.get(v).syncOut].filter((w) => service(w) && nodes.get(w).type !== 'external'));

  if (kind === 'app') {
    // Shared state: fine in an app, until many parts write it.
    for (const st of stores) {
      const users = [...new Set([...st.in, ...st.out])].filter((id) => nodes.get(id).type !== 'external');
      if (users.length >= 4) add('app-shared-state', 'info', { store: st.label, n: users.length, users: users.map(label) });
    }
    // Core modules many parts depend on.
    for (const n of all) {
      if (['database', 'frontend', 'external'].includes(n.type)) continue;
      if (n.in.size >= 4 && n.in.size / others >= 0.3) add('app-hub', 'info', { name: n.label, n: n.in.size });
      if (n.out.size >= 6) add('wide-dependency', 'info', { name: n.label, n: n.out.size });
    }
    // What the app leans on that it does not own: the system, other apps, online services.
    for (const x of of('external')) {
      const users = [...x.in].filter((id) => nodes.get(id).type !== 'external');
      if (users.length >= 2) add('app-outside', users.length >= 3 ? 'warn' : 'info', { name: x.label, n: users.length, users: users.map(label) });
    }
    // Parts that need a permission the person may not grant.
    const permitted = all.filter((n) => n.type !== 'external' && PERMISSION.test(n.text));
    if (permitted.length > 0) add('app-permissions', 'warn', { n: permitted.length, names: permitted.map((n) => n.label) });
    for (const group of loops.slice(0, 3)) add('cycle', 'warn', { names: group.map(label) });
    // The screens take their data through the state, not from every module.
    const screens = clients.filter((c) => c.out.size > 0);
    const through = stores.find((st) => screens.length > 0 && screens.some((c) => c.out.has(st.id)));
    if (through && screens.every((c) => c.out.size <= 2)) add('app-ui-state', 'good', { store: through.label });
    const isolatedApp = all.filter((n) => n.in.size === 0 && n.out.size === 0);
    if (isolatedApp.length > 0 && all.length > 1) add('isolated', 'info', { n: isolatedApp.length, names: isolatedApp.map((n) => n.label) });
    return finish();
  }
  const gateways = all.filter((n) => n.type === 'security' || (n.type !== 'database' && GATEWAY.test(n.text)));

  // Shared data stores, and the clients that reach one directly.
  let ownedStores = 0;
  for (const s of stores) {
    const users = [...new Set([...s.in, ...s.out])].filter((id) => nodes.get(id).type !== 'database' && nodes.get(id).type !== 'frontend');
    if (users.length >= 3) add('shared-store', users.length >= 4 ? 'risk' : 'warn', { store: s.label, n: users.length, users: users.map(label) });
    else if (users.length === 1) ownedStores += 1;
    for (const c of [...s.in].filter((id) => nodes.get(id).type === 'frontend')) add('client-to-store', 'risk', { client: label(c), store: s.label });
  }
  if (stores.length >= 2 && ownedStores === stores.length) add('stores-owned', 'good', { n: stores.length });

  // Clients that call many internal parts directly, with no gateway in front of them.
  for (const c of clients) {
    const targets = [...c.out].filter((id) => !['external', 'frontend'].includes(nodes.get(id).type) && !gateways.includes(nodes.get(id)));
    if (targets.length >= 3) add('client-fanout', 'warn', { client: c.label, n: targets.length, targets: targets.map(label) });
  }
  const guarded = clients.length > 0 && clients.every((c) => c.out.size > 0 && [...c.out].every((id) => gateways.includes(nodes.get(id)) || nodes.get(id).type === 'external'));
  if (guarded && gateways.length > 0) add('gateway-front', 'good', { gateway: gateways.map((g) => g.label).slice(0, 2) });

  // Hotspots: many parts depend on one service (an outside system is not one to scale).
  for (const n of all) {
    if (['database', 'messagebus', 'frontend', 'external'].includes(n.type)) continue;
    if (n.in.size >= 4 && n.in.size / others >= 0.3) add('hotspot', 'warn', { name: n.label, n: n.in.size });
    if (n.out.size >= 6) add('wide-dependency', 'info', { name: n.label, n: n.out.size });
  }

  // Synchronous cycles (an async edge back is a callback or an event, which is fine).
  for (const group of loops.slice(0, 3)) add('cycle', 'warn', { names: group.map(label) });

  // Long synchronous chains from an entry point.
  const blocked = new Set(loops.flat());
  const entries = clients.length > 0 ? clients : all.filter((n) => n.in.size === 0 && n.out.size > 0);
  let deepest = [];
  for (const e of entries) {
    if (blocked.has(e.id)) continue;
    const chain = longestChain(e.id, nodes, blocked);
    if (chain.length > deepest.length) deepest = chain;
  }
  if (deepest.length - 1 >= 5) add('deep-chain', 'warn', { hops: deepest.length - 1, path: deepest.map(label) });

  // Asynchronous work.
  const buses = of('messagebus');
  const asyncEdges = edges.filter((e) => e.async).length;
  if (buses.length > 0) add('async-decoupling', 'good', { bus: buses.map((b) => b.label).slice(0, 2) });
  else if (of('backend').length >= 5 && asyncEdges === 0) add('all-sync', 'info', { n: of('backend').length });

  // External dependencies on the call path.
  const external = of('external').filter((x) => [...x.in].some((id) => nodes.get(id).type !== 'frontend'));
  if (external.length > 0) add('external-deps', 'info', { n: external.length, names: external.map((x) => x.label) });

  // Trust and network boundaries.
  const securityGroup = boundaries.some((b) => b.kind === 'security-group');
  if (clients.length > 0 && stores.length > 0 && !securityGroup && !all.some((n) => n.type === 'security')) add('no-security', 'info', {});

  // Operations: nothing on the drawing watches the system (only worth saying for a bigger one).
  if (all.length >= 8 && !all.some((n) => OBSERVE.test(n.text))) add('no-observability', 'info', {});

  // Parts the drawing never connects.
  const isolated = all.filter((n) => n.in.size === 0 && n.out.size === 0);
  if (isolated.length > 0 && all.length > 1) add('isolated', 'info', { n: isolated.length, names: isolated.map((n) => n.label) });
  return finish();

  function finish() {
    const order = { risk: 0, warn: 1, info: 2, good: 3 };
    findings.sort((a, b) => order[a.level] - order[b.level]);
    const byType = {};
    for (const n of all) byType[n.type || 'other'] = (byType[n.type || 'other'] ?? 0) + 1;
    return {
      supported: true,
      kind,
      guessed: guessed.kind,
      summary: { components: all.length, connections: edges.length, async: edges.filter((e) => e.async).length, boundaries: boundaries.length, byType, entries: clients.map((c) => c.label) },
      findings,
    };
  }
}

/** Findings as plain English lines, for the model's review prompt. */
export function findingLines(review) {
  const join = (xs) => list(xs).slice(0, 6).join(', ');
  const say = {
    'shared-store': (p) => `${p.n} services use the data store "${p.store}" directly (${join(p.users)})`,
    'client-to-store': (p) => `the client "${p.client}" reaches the data store "${p.store}" directly`,
    'client-fanout': (p) => `the client "${p.client}" calls ${p.n} internal parts directly with no gateway in front (${join(p.targets)})`,
    hotspot: (p) => `${p.n} parts depend on "${p.name}"`,
    'wide-dependency': (p) => `"${p.name}" depends on ${p.n} parts`,
    cycle: (p) => `synchronous dependency cycle: ${join(p.names)}`,
    'deep-chain': (p) => `a synchronous call chain of ${p.hops} hops: ${list(p.path).join(' → ')}`,
    'all-sync': (p) => `${p.n} backend services and no asynchronous connection or message bus`,
    'external-deps': (p) => `${p.n} external dependencies on the call path (${join(p.names)})`,
    'no-security': () => 'no authentication component or security boundary is drawn',
    'no-observability': () => 'nothing on the drawing monitors, logs or traces the system',
    isolated: (p) => `${p.n} parts are not connected to anything (${join(p.names)})`,
    'stores-owned': (p) => `each of the ${p.n} data stores is used by one service`,
    'gateway-front': (p) => `clients enter through ${join(p.gateway)}`,
    'app-shared-state': (p) => `${p.n} parts read or write "${p.store}" (${join(p.users)})`,
    'app-hub': (p) => `${p.n} parts depend on the module "${p.name}"`,
    'app-outside': (p) => `${p.n} features depend on "${p.name}", which the app does not own (${join(p.users)})`,
    'app-permissions': (p) => `${p.n} parts need a system permission (${join(p.names)})`,
    'app-ui-state': (p) => `the screens take their data through "${p.store}"`,
    'async-decoupling': (p) => `asynchronous work goes through ${join(p.bus)}`,
  };
  return list(review?.findings).map((f) => `- [${f.level}] ${(say[f.code] ?? (() => f.code))(f.params ?? {})}`);
}
