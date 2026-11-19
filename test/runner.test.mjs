import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRunner, folderOf, render, renderResult, scan, settingsOf, submitReview } from '../index.js';
import { createJobs } from '../lib/jobs.mjs';
import { SKILL_ROOT } from '../lib/run.mjs';
import { createStore } from '../lib/store.mjs';

const example = (name) => JSON.parse(readFileSync(join(SKILL_ROOT, 'examples', name), 'utf8'));

/** A Harness stand-in: workspaces, sessions whose agents record what they are sent. */
function fakeHarness({ existing = [] } = {}) {
  const seen = { workspaces: [], created: [], sent: [], titles: [] };
  const agents = new Map(existing.map((id) => [id, { session: { id }, followup: (m) => seen.sent.push({ sessionId: id, message: m }) }]));
  const services = {
    workspaceRegistry: { create: async (path, name) => (seen.workspaces.push({ path, name }), { id: `ws:${path}` }) },
    sessionController: {
      create: async (input) => {
        seen.created.push(input);
        agents.set(input.sessionId, { session: { id: input.sessionId }, followup: (m) => seen.sent.push({ sessionId: input.sessionId, message: m }) });
        return { sessionId: input.sessionId };
      },
      resolveAgent: async (id) => (agents.has(id) ? { agent: agents.get(id) } : { error: new Error('unknown session') }),
    },
    sessionTitle: { rename: (session, title) => seen.titles.push([session.id, title]) },
    sessions: { flush: async () => {} },
  };
  return { ctx: { get: (name) => services[name] }, seen };
}

function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'archify-runner-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'shop', dependencies: { express: '^5' } }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

test('Generate starts a conversation in the project\'s workspace with the prompt and the scan, and follows it', async () => {
  const { ctx, seen } = fakeHarness();
  const cache = mkdtempSync(join(tmpdir(), 'archify-cache-'));
  const jobs = createJobs(cache);
  const runner = createRunner(ctx, { jobs, store: createStore(cache), workdir: join(cache, 'work') });
  const dir = gitRepo();
  const r = await runner.generate({ dir, type: 'architecture', focus: '后端服务', lang: 'zh', quality: 'standard' });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(seen.workspaces, [{ path: dir, name: dir.split('/').pop() }]);
  assert.equal(seen.created[0].workspaceId, `ws:${dir}`);
  const [{ sessionId, message }] = seen.sent;
  assert.equal(sessionId, r.job.sessionId);
  assert.equal(message.role, 'user');
  const text = message.content[0].text;
  assert.match(text, /用 archify 技能为 .* 这个代码仓库画一张架构图，重点：后端服务/);
  assert.match(text, /质量用 standard/);
  assert.match(text, /package\.json: "shop"; dependencies express/);
  assert.equal(r.job.state, 'running');
  assert.match(seen.titles[0][1], /^Archify · 架构图 · /);
  // The conversation's calls and end move the job.
  jobs.noteCall(sessionId, 'archify_render');
  jobs.delivered(sessionId, 'p1');
  jobs.idle(sessionId);
  assert.equal(jobs.get(r.job.id).state, 'done');

  // A described subject runs in the plugin's own folder.
  const d = await runner.generate({ type: 'sequence', focus: 'OAuth login', lang: 'en' });
  assert.equal(d.ok, true);
  assert.equal(seen.workspaces.at(-1).path, join(cache, 'work'));
  assert.match(seen.sent.at(-1).message.content[0].text, /draw a sequence diagram: OAuth login/);
  // A folder that is not there: the preview still shows a prompt, with the reason; a run refuses it.
  const lenient = await runner.prompt({ dir: '/no/such/folder', type: 'erd', lang: 'en', lenient: true });
  assert.match(lenient.folderError, /not a folder/);
  assert.match(lenient.prompt, /\/no\/such\/folder/);
  await assert.rejects(runner.prompt({ dir: '/no/such/folder', type: 'erd' }), /not a folder/);
  // The copyable prompt carries no scan.
  const p = await runner.prompt({ dir, type: 'erd', lang: 'en' });
  assert.match(p.prompt, /Start with archify_scan/);
  assert.doesNotMatch(p.prompt, /dependencies express/);
});

test('Generate refuses a folder it cannot use, and says when the Harness cannot start conversations', async () => {
  assert.throws(() => folderOf('relative/path'), /absolute/);
  assert.throws(() => folderOf('/no/such/folder/anywhere'), /not a folder/);
  assert.equal(folderOf(''), '');
  const cache = mkdtempSync(join(tmpdir(), 'archify-cache-'));
  const jobs = createJobs(cache);
  const runner = createRunner({ get: () => undefined }, { jobs, store: createStore(cache), workdir: join(cache, 'work') });
  const r = await runner.generate({ type: 'workflow', focus: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /cannot start conversations/);
  assert.equal(r.job.state, 'failed');
});

test('a review goes to the conversation that drew the diagram and asks for one from its code', async () => {
  const { ctx, seen } = fakeHarness({ existing: ['s-old'] });
  const cache = mkdtempSync(join(tmpdir(), 'archify-cache-'));
  const store = createStore(cache);
  const dir = gitRepo();
  writeFileSync(join(dir, 'server.js'), 'export function start() {}\n');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  const spec = example('web-app.architecture.json');
  spec.components[0].sources = [{ path: 'server.js', line: 1 }];
  const candidate = join(dir, '.archify', 'a', 'candidate.json');
  mkdirSync(join(dir, '.archify', 'a'), { recursive: true });
  writeFileSync(candidate, JSON.stringify(spec));
  const item = store.put({ id: 'i1', type: 'architecture', title: 'Web app', html: join(dir, '.archify', 'a', 'web-app.html'), candidate, cwd: dir, sessionId: 's-old', updatedAt: 1 });
  const runner = createRunner(ctx, { jobs: createJobs(cache), store, workdir: join(cache, 'work') });
  const r = await runner.review({ id: item.id, lang: 'en' });
  assert.equal(r.ok, true, r.reason);
  assert.equal(seen.created.length, 0, 'no new conversation');
  assert.equal(seen.sent[0].sessionId, 's-old');
  const text = seen.sent[0].message.content[0].text;
  assert.match(text, /Review, as an architect would, the system that the diagram "Web app" describes/);
  // Git names the folder by its real path (/private/var on macOS).
  assert.match(text, new RegExp(`The code is at (/private)?${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(commit [0-9a-f]{12}\\)`));
  assert.match(text, /basis code/);
  assert.doesNotMatch(text, /\[(risk|warn|info|good)\]/, 'no guessed findings');
  // A diagram with no code behind it is reviewed as a design.
  const plain = mkdtempSync(join(tmpdir(), 'archify-plain-'));
  const c2 = join(plain, 'candidate.json');
  writeFileSync(c2, JSON.stringify(example('web-app.architecture.json')));
  const described = store.put({ id: 'i2', type: 'architecture', title: 'Shop', html: join(plain, 'shop.html'), candidate: c2, cwd: plain, sessionId: 's-old', updatedAt: 2 });
  await runner.review({ id: described.id, lang: 'en' });
  assert.match(seen.sent.at(-1).message.content[0].text, /drawn from a description; there is no code behind it/);
  assert.deepEqual(await runner.review({ id: 'nope' }), { ok: false, reason: 'missing' });
});

test('archify_review keeps a review only when every point\'s citations check out', async () => {
  const dir = gitRepo();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'store.js'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir });
  const store = createStore(join(dir, '.cache'));
  const candidate = join(dir, 'candidate.json');
  writeFileSync(candidate, JSON.stringify(example('web-app.architecture.json')));
  const item = store.put({ id: 'i1', type: 'architecture', title: 'Web app', html: join(dir, 'web-app.html'), candidate, cwd: dir, updatedAt: 1 });
  const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => dir } : undefined) };
  const exec = { agent: { session: { id: 's1' } } };
  const base = { candidate, basis: 'code', software: 'a web app', verdict: 'fine' };
  // A point with no citation, one past the end of a file, one outside the repository: refused, saying which.
  await assert.rejects(
    submitReview(ctx, store, { ...base, findings: [
      { level: 'warn', title: 'Guess', detail: 'no evidence', suggestion: 'x', evidence: [] },
      { level: 'warn', title: 'Past the end', detail: 'd', suggestion: 'x', evidence: [{ path: 'src/store.js', line: 28, end_line: 99 }] },
      { level: 'info', title: 'Outside', detail: 'd', suggestion: 'x', evidence: [{ path: '../etc/passwd', line: 1 }] },
    ] }, exec),
    (error) => /The review was not saved/.test(error.message) && /\("Guess"\) cites no code/.test(error.message) && /has 30 lines/.test(error.message) && /stay inside it/.test(error.message),
  );
  assert.equal(store.get(item.id).review, undefined);
  // Cited properly, it is kept with the cited lines and the commit.
  const ok = await submitReview(ctx, store, { ...base, findings: [
    { level: 'good', title: 'One store', detail: 'state lives in one place', evidence: [{ path: 'src/store.js', line: 3, end_line: 5, note: 'the store' }] },
    { level: 'risk', title: 'Writes from many places', detail: 'd', suggestion: 'one writer', evidence: [{ path: './src/store.js', line: 10 }] },
  ] }, exec);
  assert.deepEqual([ok.ok, ok.findings, ok.cited], [true, 2, 2]);
  const kept = store.get(item.id).review;
  assert.match(kept.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(kept.findings.map((f) => f.level), ['risk', 'good'], 'most serious first');
  assert.deepEqual(kept.findings[1].evidence[0], { path: 'src/store.js', line: 3, end_line: 5, excerpt: 'line 3\nline 4\nline 5', more: false, note: 'the store' });
  // A described design cites the diagram's own components.
  await assert.rejects(submitReview(ctx, store, { ...base, basis: 'description', findings: [{ level: 'info', title: 'T', detail: 'd', suggestion: 's', evidence: [{ component: 'nope' }] }] }, exec), /"nope" is not a component of the diagram/);
  const id0 = example('web-app.architecture.json').components[0].id;
  const design = await submitReview(ctx, store, { ...base, basis: 'description', findings: [{ level: 'info', title: 'T', detail: 'd', suggestion: 's', evidence: [{ component: id0 }] }] }, exec);
  assert.equal(design.basis, 'description');
  await assert.rejects(submitReview(ctx, store, { ...base, candidate: '/nowhere/candidate.json', findings: [] }, exec), /no delivered page has the candidate/);
});

test('schema slips in a draft are fixed before checking, and the result says what changed', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'archify-slips-'));
  mkdirSync(cwd, { recursive: true });
  const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => cwd } : undefined) };
  const store = createStore(join(cwd, '.cache'));
  const spec = example('web-app.architecture.json');
  spec.components[0].icon = 'server';
  spec.components[1].type = 'Cache';
  spec.components[2].note = 'unknown';
  spec.meta.quality_profile = 'standard';
  const delivered = [];
  const v = await render(ctx, store, settingsOf({}), { type: 'architecture', spec, name: 'slips' }, { agent: { session: { id: 's1' } } }, { onDelivered: (item) => delivered.push(item) });
  assert.equal(v.ok, true, JSON.stringify(v.receipt?.diagnostics));
  // The candidate's own profile is the quality, with no quality argument.
  assert.equal(v.quality, 'standard');
  assert.equal(v.adjusted.length, 3);
  const text = renderResult({}, v)[0].text;
  assert.match(text, /made these fixes to the candidate/);
  assert.match(text, /"Cache" → "database"/);
  const saved = JSON.parse(readFileSync(v.candidate, 'utf8'));
  assert.equal(saved.components[1].type, 'database');
  assert.equal(saved.components[2].note, undefined);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].sessionId, 's1');
});

test('archify_scan summarizes the working directory\'s repository', async () => {
  const dir = gitRepo();
  const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => dir } : undefined) };
  const exec = { agent: { session: { id: 's1' } } };
  const r = await scan(ctx, {}, exec);
  assert.match(r.text, /package\.json: "shop"/);
  await assert.rejects(scan(ctx, { path: '/no/such/folder' }, exec), /not a folder/);
});

test('source evidence gets the checkout\'s own origin and commit, or is left out when nothing can verify it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'archify-evidence-'));
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'server.js'), 'export function start() {\n  return 1;\n}\n');
  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/shop.git'], { cwd });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  const ctx = { get: (name) => (name === 'workingDirectory' ? { get: () => cwd } : undefined) };
  const store = createStore(join(cwd, '.cache'));
  const spec = example('web-app.architecture.json');
  spec.components[0].sources = [{ path: 'src/server.js', line: 1, end_line: 3 }];
  spec.meta.repository = { url: cwd, revision: head.slice(0, 7), provider: 'gitlab' };
  const exec = { agent: { session: { id: 's1' } } };
  const v = await render(ctx, store, settingsOf({}), { type: 'architecture', spec, name: 'evidence' }, exec);
  assert.equal(v.ok, true, JSON.stringify(v.receipt?.diagnostics));
  const saved = JSON.parse(readFileSync(v.candidate, 'utf8'));
  assert.deepEqual(saved.meta.repository, { url: 'https://github.com/acme/shop', revision: head, link_mode: 'web' });
  assert.ok(v.adjusted.some((l) => /the checkout's origin/.test(l)));

  // Outside Git, the diagram is delivered without the evidence it cannot carry.
  const plain = mkdtempSync(join(tmpdir(), 'archify-noevidence-'));
  const ctx2 = { get: (name) => (name === 'workingDirectory' ? { get: () => plain } : undefined) };
  const w = await render(ctx2, createStore(join(plain, '.cache')), settingsOf({}), { type: 'architecture', spec, name: 'plain' }, exec);
  assert.equal(w.ok, true, JSON.stringify(w.receipt?.diagnostics));
  const kept = JSON.parse(readFileSync(w.candidate, 'utf8'));
  assert.equal(kept.meta.repository, undefined);
  assert.equal(kept.components[0].sources, undefined);
  assert.match(renderResult({}, w)[0].text, /not in a Git repository/);
});
