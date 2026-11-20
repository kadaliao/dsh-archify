/**
 * Host half of the Archify bundle.
 *
 * - Ships the Archify skill (tt-a1i/archify, Apache-2.0) through a skill
 *   provider, in a DeepSeek Harness edition whose instructions call the tools
 *   below instead of a shell.
 * - `archify_render` runs Archify's `finalize` (validate, deliver, strict check,
 *   real-browser check) with the Harness's own runtime, so no Node.js install is
 *   needed, and records each delivered page in a gallery.
 * - `archify_cli` runs any other Archify command the same way.
 * - Loopback routes let the Client half show a page in the conversation and in
 *   the Archify panel, open it in the default browser, or show it in its folder.
 *
 * @module @kadaliao/dsh-archify
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';

import { CLI, SKILL_ROOT, clip, outcomeOf, parseJsonOutput, runArchify } from './lib/run.mjs';
import { WORKER, layoutReason, sidecarOf } from './lib/autolayout.mjs';
import { EVIDENCE_NODES, citesEvidence, fixRepository, repositoryFacts } from './lib/repository.mjs';
import { MAX_FINDINGS, checkReview } from './lib/critique.mjs';
import { EXAMPLES, examplePage, previewFile } from './lib/examples.mjs';
import { createJobs } from './lib/jobs.mjs';
import { NATIVE_TYPES, TYPES, planPaths, resolveFrom, titleOf, withOutput } from './lib/paths.mjs';
import { PICKABLE, editPrompt, generationPrompt, reviewPrompt, typeName } from './lib/prompts.mjs';
import { describeChanges, sanitize } from './lib/sanitize.mjs';
import { scanRepo } from './lib/scan.mjs';
import { createStore, newId } from './lib/store.mjs';

/**
 * Import one Harness package: by bare name when this directory resolves it,
 * else from the running Harness's own module tree (a linked working copy sits
 * outside it), else undefined (the tests).
 */
async function harnessModule(name) {
  try {
    return await import(name);
  } catch {
    // Not reachable from here; ask the Harness entry below.
  }
  try {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    for (const entry of [process.argv[1], ...process.argv.slice(2).filter((a) => a.endsWith('.js'))]) {
      if (!entry) continue;
      try {
        return await import(pathToFileURL(createRequire(entry).resolve(name)).href);
      } catch {
        // The next candidate.
      }
    }
  } catch {
    // No module system to ask.
  }
  return undefined;
}

// The registry wants the compiled definition `defineTool` makes. Outside a
// Harness (the tests) the raw definition stands in for it.
const defineTool = (await harnessModule('@deepseek-ai/dsh-tools'))?.defineTool ?? ((definition) => definition);
const createUserMessage = (await harnessModule('@deepseek-ai/dsh-llm'))?.createUserMessage ?? ((input) => Object.freeze({ ...structuredClone(input), role: 'user', id: randomUUID() }));

/** The tool registry is required; skills and the web server ride deferred injects. */
export const inject = ['tools'];

export const RENDER_TOOL = 'archify_render';
export const CLI_TOOL = 'archify_cli';
export const SCAN_TOOL = 'archify_scan';
export const REVIEW_TOOL = 'archify_review';
export const SKILL_NAME = 'archify';
export const PROVIDER = 'dsh-archify';
/** Packaged skills' standard precedence (`BUNDLED_SKILL_RANK` in @deepseek-ai/dsh-skill). */
const BUNDLED_RANK = 600;

const LIST_ROUTE = '/__dsh_archify/list';
// A prefix route matches `<prefix>/<rest>`, so it is registered without the slash.
const FILE_ROUTE = '/__dsh_archify/file';
const DELETE_ROUTE = '/__dsh_archify/delete';
const OPEN_ROUTE = '/__dsh_archify/open';
const STATE_ROUTE = '/__dsh_archify/state';
const PROMPT_ROUTE = '/__dsh_archify/prompt';
const GENERATE_ROUTE = '/__dsh_archify/generate';
const JOBS_ROUTE = '/__dsh_archify/jobs';
const DISMISS_ROUTE = '/__dsh_archify/jobs/dismiss';
const REVIEW_ROUTE = '/__dsh_archify/review';
const ASK_ROUTE = '/__dsh_archify/ask';
const EDIT_ROUTE = '/__dsh_archify/edit';
const PREVIEW_ROUTE = '/__dsh_archify/preview';
const EXAMPLE_ROUTE = '/__dsh_archify/example';

/** The skill file this bundle serves, beside the vendored skill it points into. */
export const SKILL_FILE = join(SKILL_ROOT, '..', 'skill', 'SKILL.md');

/** Upstream identity of the vendored copy. */
export function upstream() {
  try {
    return JSON.parse(readFileSync(join(SKILL_ROOT, 'UPSTREAM.json'), 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Normalize the Loader row's config.
 * @param {unknown} config
 */
export function settingsOf(config) {
  const c = config && typeof config === 'object' ? config : {};
  const timeout = Number(c.timeoutMs);
  return {
    enabled: c.enabled !== false,
    skill: c.skill !== false,
    timeoutMs: Number.isFinite(timeout) && timeout >= 10_000 ? timeout : 240_000,
    // Where a diagram of a described subject started from the panel is drawn.
    workdir: typeof c.workdir === 'string' && c.workdir.trim() !== '' ? c.workdir.trim() : '',
  };
}

/** The DSH home the gallery lives under. */
function homeDir() {
  return process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh');
}

// --- the skill --------------------------------------------------------------------

/** `description` and body of a SKILL.md with a one-line JSON-quoted description. */
export function parseSkill(raw) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw);
  if (!fm) throw new Error('archify: SKILL.md has no frontmatter');
  const line = /^description:\s*(.+)$/m.exec(fm[1]);
  let description = line ? line[1].trim() : '';
  if (description.startsWith('"')) description = JSON.parse(description);
  if (description === '') throw new Error('archify: SKILL.md has no description');
  return { description, content: raw.slice(fm[0].length).trim() };
}

/** The provider Harness's skill registry asks for the catalog entry and, on load, the body. */
export function skillProvider(file = SKILL_FILE, root = SKILL_ROOT) {
  const read = () => parseSkill(readFileSync(file, 'utf8'));
  const summary = (description) => ({
    name: SKILL_NAME,
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: root.split(sep).join('/') },
  });
  return () => ({
    name: PROVIDER,
    async list() {
      try {
        return { candidates: [{ ...summary(read().description), rank: BUNDLED_RANK, locator: file }], complete: true };
      } catch {
        return { candidates: [], complete: true };
      }
    },
    async get(candidate) {
      const { rank: _rank, locator: _locator, ...rest } = candidate;
      const skill = read();
      return { ...rest, ...summary(skill.description), content: skill.content };
    },
  });
}

// --- the tools ----------------------------------------------------------------------

/** The session's working directory. */
function cwdOf(ctx, exec) {
  try {
    const session = exec?.agent?.session;
    const dir = session ? ctx.get('workingDirectory')?.get?.(session) : undefined;
    if (typeof dir === 'string' && dir !== '') return dir;
  } catch {
    // The process's own below.
  }
  return process.cwd();
}

/**
 * A later run on a page whose browser check already left evidence gets its own
 * `review-<n>` folder, as the skill's delivery contract asks.
 */
export function reviewDirFor(folder, output) {
  const stem = basename(output).replace(/\.html?$/i, '');
  let reviewed = existsSync(join(dirname(output), `${stem}.browser-check.json`));
  let n = 1;
  try {
    for (const name of readdirSync(folder)) {
      const m = /^review-(\d+)$/.exec(name);
      if (m) {
        reviewed = true;
        n = Math.max(n, Number(m[1]));
      }
    }
  } catch {
    // A new folder has none.
  }
  return reviewed ? join(folder, `review-${n + 1}`) : undefined;
}

class ToolInputError extends Error {}

/** Failed renders per candidate since its last delivery: the repair budget. */
const attempts = new Map();
/** From this failed render on, the result says to deliver at `standard` now. */
export const SWITCH_TO_STANDARD = 3;
/** From this failed render on, the result says to stop and report. */
export const STOP_REPAIRING = 8;

/** One more failure of `candidate`, or a reset on delivery; returns the count. */
export function countAttempt(candidate, delivered) {
  if (delivered) {
    attempts.delete(candidate);
    return 0;
  }
  const n = (attempts.get(candidate) ?? 0) + 1;
  attempts.set(candidate, n);
  if (attempts.size > 500) attempts.delete(attempts.keys().next().value);
  return n;
}

/** Whether a candidate cites repository sources: `sources` in a diagram, `@code` in an explainer. */
export function citesSources(type, text) {
  return type === 'explainer' ? /^@code\b/m.test(String(text ?? '')) : /"sources"\s*:/.test(String(text ?? ''));
}

/**
 * The Git work tree `cwd` is in, or '' outside one: then Archify's own
 * diagnostic asks for the root, which says more than a failed Git call.
 */
export function gitRoot(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => {
      const root = String(stdout ?? '').trim();
      resolve(!error && root !== '' ? root : '');
    });
  });
}

/**
 * Height over width of a page's diagram, from its main SVG's viewBox, so the
 * conversation can size the preview to the drawing; 0 when there is none.
 */
export function aspectOf(htmlPath) {
  try {
    const html = readFileSync(htmlPath, 'utf8');
    const m = /<svg\b[^>]*\bviewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"[^>]*aria-labelledby="archify-diagram-title/.exec(html);
    if (!m) return 0;
    const w = Number(m[1]);
    const hgt = Number(m[2]);
    return w > 0 && hgt > 0 ? Math.round((hgt / w) * 10_000) / 10_000 : 0;
  } catch {
    return 0;
  }
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const readText = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

/** The longest the layout worker may take. */
const LAYOUT_TIMEOUT = 60_000;

/**
 * Lay an Architecture candidate out in the layout worker, which writes the
 * positions into it. Returns the worker's summary.
 */
export async function placeCandidate(candidate, { cwd, quality, repoRoot, signal } = {}) {
  const job = JSON.stringify({ candidate, cwd, quality, repoRoot: repoRoot || '' });
  const run = await runArchify([job], { cwd, signal, timeoutMs: LAYOUT_TIMEOUT, cli: WORKER });
  const summary = parseJsonOutput(run.stdout);
  if (summary && typeof summary === 'object') return summary;
  return { ok: false, error: clip(run.stderr || (run.timedOut ? 'timed out' : `exit ${run.code}`), 400), ms: run.ms };
}

/** The quality profile a candidate names, if a valid one. */
const metaQuality = (spec) => (spec?.meta?.quality_profile === 'standard' || spec?.meta?.quality_profile === 'showcase' ? spec.meta.quality_profile : '');

/**
 * Run one `archify_render` call.
 * @param {{onDelivered?: (item: object) => void}} [hooks] - told about each delivered page (the panel's jobs).
 */
export async function render(ctx, store, settings, args, exec, hooks = {}) {
  const a = args && typeof args === 'object' ? args : {};
  const type = String(a.type ?? '').trim();
  if (!TYPES.includes(type)) throw new ToolInputError(`type must be one of: ${TYPES.join(', ')}`);
  const cwd = cwdOf(ctx, exec);
  // The call's quality, else the candidate's own profile (below), else showcase; the two then agree.
  let quality = a.quality === 'standard' || a.quality === 'showcase' ? a.quality : '';

  // The draft the model sent, as the text that goes into the candidate file.
  let draft = null;
  let specObject = null;
  if (type === 'explainer') {
    if (typeof a.markdown === 'string' && a.markdown.trim() !== '') draft = a.markdown.endsWith('\n') ? a.markdown : `${a.markdown}\n`;
    else if (typeof a.spec === 'string' && a.spec.trim() !== '') draft = a.spec;
  } else if (a.spec !== undefined && a.spec !== null && a.spec !== '') {
    let spec = a.spec;
    if (typeof spec === 'string') {
      try {
        spec = JSON.parse(spec);
      } catch (error) {
        throw new ToolInputError(`spec is not valid JSON: ${error.message}`);
      }
    }
    if (typeof spec !== 'object' || Array.isArray(spec)) throw new ToolInputError('spec must be the candidate JSON object');
    specObject = spec;
    draft = `${JSON.stringify(spec, null, 2)}\n`;
  }
  const hasCandidate = typeof a.candidate === 'string' && a.candidate.trim() !== '';
  if (draft === null && !hasCandidate) {
    throw new ToolInputError(type === 'explainer' ? 'pass the draft as `markdown`, or `candidate` with the path of a candidate.archify.md' : 'pass the candidate as `spec`, or `candidate` with the path of a candidate JSON file');
  }

  const plan = planPaths({ cwd, type, candidate: hasCandidate ? a.candidate : '', output: a.output, name: a.name, title: draft ? titleOf(type, draft) : '' });
  if (draft === null && !existsSync(plan.candidate)) throw new ToolInputError(`candidate not found: ${plan.candidate}`);
  let text = draft ?? readFileSync(plan.candidate, 'utf8');
  let write = draft !== null;
  // Schema slips (an unknown property, a near-miss enum value, one source too many) are
  // fixed here, in new drafts and repaired candidates alike: each would cost a repair round.
  let adjusted = [];
  if (type !== 'explainer') {
    const obj = specObject ?? parseJson(text);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      quality ||= metaQuality(obj) || 'showcase';
      const named = withOutput(obj, basename(plan.output));
      const { spec: fixed, changes } = sanitize(type, named, { quality });
      adjusted = describeChanges(fixed, changes);
      if (changes.length > 0 || named !== obj) {
        text = `${JSON.stringify(fixed, null, 2)}\n`;
        write = true;
      }
    }
  }
  quality ||= 'showcase';
  if (write) {
    mkdirSync(dirname(plan.candidate), { recursive: true });
    writeFileSync(plan.candidate, text, 'utf8');
  }
  const title = titleOf(type, text) || plan.slug;

  const outDir = typeof a.outDir === 'string' && a.outDir.trim() !== '' ? resolveFrom(cwd, a.outDir) : reviewDirFor(plan.folder, plan.output);
  const cliArgs = ['finalize', type, plan.candidate, plan.output, '--json', '--quality', quality];
  // A draft that cites source files is checked against a repository; when the
  // model names none, the working directory's Git root is it.
  const repoRoot = typeof a.repoRoot === 'string' && a.repoRoot.trim() !== '' ? resolveFrom(cwd, a.repoRoot) : citesSources(type, text) ? await gitRoot(cwd) : '';
  if (repoRoot) cliArgs.push('--repo-root', repoRoot);
  if (outDir) cliArgs.push('--out-dir', outDir);

  // Source evidence pins the checkout's own origin and commit: the tool knows them, so it writes them.
  if (type !== 'explainer') {
    const obj = parseJson(text);
    if (citesEvidence(type, obj)) {
      const { spec: pinned, changes } = await fixRepository(type, obj, await repositoryFacts(repoRoot));
      if (changes.length > 0) {
        text = `${JSON.stringify(pinned, null, 2)}\n`;
        writeFileSync(plan.candidate, text, 'utf8');
        adjusted.push(...changes);
      }
    }
  }

  // An Architecture draft without positions is placed here, so the model writes
  // topology only and never repairs coordinates.
  let layout = null;
  if (type === 'architecture') {
    const reason = layoutReason(parseJson(text), { relayout: a.relayout === true, sidecar: parseJson(readText(sidecarOf(plan.candidate))) });
    if (reason) {
      layout = { reason, ...(await placeCandidate(plan.candidate, { cwd, quality, repoRoot, signal: exec?.signal })) };
      if (exec?.signal?.aborted) throw new Error('the render was cancelled');
      text = readText(plan.candidate) || text;
    }
  }

  const run = await runArchify(cliArgs, { cwd, signal: exec?.signal, timeoutMs: settings.timeoutMs });
  if (exec?.signal?.aborted) throw new Error('the render was cancelled');
  const receipt = parseJsonOutput(run.stdout);
  const outcome = outcomeOf(receipt, run);
  const failures = receipt ? countAttempt(plan.candidate, outcome.ok) : 0;
  let id = '';
  let version = '';
  let aspect = 0;
  if (outcome.ok) {
    let bytes = 0;
    try {
      bytes = statSync(plan.output).size;
    } catch {
      bytes = 0;
    }
    version = String(receipt?.artifact?.sha256 ?? Date.now()).slice(0, 16);
    aspect = type === 'explainer' ? 0 : aspectOf(plan.output);
    const item = store.put({
      id: newId(),
      type,
      title,
      html: plan.output,
      candidate: plan.candidate,
      cwd,
      sessionId: String(exec?.agent?.session?.id ?? ''),
      quality,
      gates: outcome.gates,
      browserSkipped: outcome.browserSkipped,
      bytes,
      version,
      aspect,
      updatedAt: Date.now(),
    });
    id = item.id;
    try {
      hooks.onDelivered?.(item);
    } catch {
      // Following a job is a convenience.
    }
  }
  return {
    ok: outcome.ok,
    type,
    title,
    candidate: plan.candidate,
    output: plan.output,
    folder: plan.folder,
    quality,
    status: outcome.status,
    gates: outcome.gates,
    failedStage: outcome.failedStage,
    browserSkipped: outcome.browserSkipped,
    ...(id ? { id, version, aspect } : {}),
    ...(failures > 0 ? { failures } : {}),
    ...(layout ? { layout } : {}),
    ...(adjusted.length > 0 ? { adjusted } : {}),
    ms: run.ms + (layout?.ms ?? 0),
    receipt: receipt ?? null,
    ...(receipt ? {} : { stdout: clip(run.stdout, 6000), stderr: clip(run.stderr, 6000), exitCode: run.code ?? -1, timedOut: run.timedOut }),
  };
}

/** What the model reads back from one render. */
export function renderResult(_args, value) {
  const v = value && typeof value === 'object' ? value : {};
  const gates = Object.entries(v.gates ?? {})
    .map(([k, s]) => `${k} ${k === 'browser-check' && v.browserSkipped ? 'skipped (no Chrome-family browser installed)' : s}`)
    .join(', ');
  const lines = [];
  const placedNow = v.layout?.ok === true;
  const fixedNote = Array.isArray(v.adjusted) && v.adjusted.length > 0 ? `Before checking, the tool made these fixes to the candidate (saved in the file): ${v.adjusted.join('; ')}.` : '';
  if (v.ok) {
    lines.push(`Delivered the ${v.type} page "${v.title}" at ${v.output} (candidate ${v.candidate}). Gates: ${gates}.`);
    if (placedNow) lines.push(`The components were laid out automatically (${v.layout.width}×${v.layout.height}px); their pos and size are now in the candidate.`);
    if (fixedNote) lines.push(fixedNote);
    lines.push('This page is the deliverable and the user already sees it in the conversation (interactive, with full screen, open in browser and download) and in the Archify panel. Reply now, as the skill\'s Output section says, without repeating the path. Do not run visual checks, captures or another layout round unless the user asks for one.');
    const r = v.receipt ?? {};
    const review = r.visualReviewRecommendation ?? r.layoutReviewRecommendation;
    if (review) lines.push(`The receipt suggests an optional layout review (${review.action ?? 'review'}). End the reply with one short clause offering to tidy the layout; keep the details for when the user asks: ${clip(JSON.stringify({ visualReviewRecommendation: r.visualReviewRecommendation, layoutReviewRecommendation: r.layoutReviewRecommendation }), 3000)}`);
    const warnings = (Array.isArray(r.diagnostics) ? r.diagnostics : []).filter((d) => d?.severity === 'warning' && d?.code !== 'viewer/chrome-unavailable');
    if (warnings.length > 0 || r.writing) lines.push(`Warnings to mention only if they change how the page reads: ${clip(JSON.stringify({ warnings, writing: r.writing }), 3000)}`);
  } else if (v.receipt) {
    lines.push(`Archify stopped at ${v.failedStage || v.status}${gates ? ` (gates: ${gates})` : ''}. Nothing was delivered.`);
    if (fixedNote) lines.push(`${fixedNote} The diagnostics below are what remains.`);
    if (placedNow) {
      lines.push('The components were laid out automatically before this run. Fix what the diagnostics name in the text or topology (components, connections, boundaries), never the coordinates: a render after such an edit lays the candidate out again. If only placement diagnostics remain (composition, clean-flow, label or route clearance), set meta.quality_profile to "standard" and render with quality "standard" and relayout true.');
    } else if (v.layout && v.layout.ok === false) {
      lines.push(`Automatic layout failed (${v.layout.error}), so the components had no positions. Check that every component has an id and every connection names existing components, then render again.`);
    }
    const n = Number(v.failures) || 1;
    if (n >= STOP_REPAIRING) {
      lines.push(`Repair budget spent (failed render ${n} of this candidate). Stop repairing now: tell the user in two or three lines which issue remains, from the diagnostics below, that the candidate is at ${v.candidate}, and offer to keep going. Do not render again unless the user asks.`);
    } else {
      lines.push(`Repair the candidate at ${v.candidate} in place with your file-editing tool: apply each diagnostic's supportedFixes (or the fix its message names), keep everything the diagnostics do not name, then call ${RENDER_TOOL} again with candidate="${v.candidate}". This was failed render ${n}; at ${STOP_REPAIRING} the budget is spent.`);
      if (n >= SWITCH_TO_STANDARD && v.quality === 'showcase') {
        lines.push('The user is waiting: in this repair also set meta.quality_profile to "standard" in the candidate and pass quality "standard". That profile leaves out the showcase-only composition checks (label clearance, corridor and crossing polish, canvas width), so the page can be delivered now; after delivery, offer a showcase polish in one clause.');
      }
    }
    lines.push(`Receipt: ${clip(JSON.stringify(v.receipt))}`);
  } else {
    lines.push(`Archify did not produce a receipt (exit ${v.exitCode}${v.timedOut ? ', timed out' : ''}). Candidate: ${v.candidate}.`);
    if (v.stderr) lines.push(`stderr:\n${v.stderr}`);
    if (v.stdout) lines.push(`stdout:\n${v.stdout}`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

export function buildRenderTool(ctx, store, settings, hooks = {}) {
  return defineTool({
    name: RENDER_TOOL,
    description:
      'Render, check and deliver an Archify diagram or one-page explainer as a standalone interactive HTML page (the Archify skill\'s `finalize`). Load the `archify` skill first and follow it to author the candidate. ' +
      'New request: pass the complete candidate as `spec` (JSON object; for type explainer, the Markdown draft as `markdown`) and a short Latin `name`; the tool writes it to `.archify/<type>-<name>-<timestamp>/` under the working directory and delivers the page next to it. ' +
      'Architecture: leave out pos, size, row/col and route hints; the tool lays the components out (boundaries as groups) before checking, and writes the positions into the candidate. ' +
      'Repair: edit that candidate file in place, then call again with `candidate` set to its path. ' +
      'Before checking, the tool fixes plain schema slips itself (unknown properties, near-miss enum values, too many sources) and says what it changed. ' +
      'It runs validate, deliver, a strict check and a real-browser check, and returns the compact receipt: on failure its diagnostics say what to fix. A delivered page is shown to the user in the conversation and in the Archify panel.',
    parameters: {
      type: { type: 'string', required: true, enum: TYPES, description: `Diagram type: ${NATIVE_TYPES.join(', ')}; or explainer for a one-page answer.` },
      spec: { type: 'object', additionalProperties: true, description: 'The complete candidate JSON (schema_version, diagram_type, meta, …) for a native diagram. Leave out when passing `candidate`.' },
      markdown: { type: 'string', description: 'For type explainer: the complete candidate.archify.md draft. Leave out when passing `candidate`.' },
      candidate: { type: 'string', description: 'Path of an existing candidate file (relative to the working directory, absolute or ~/…): to re-render after editing it in place. With `spec`/`markdown` too, that file is overwritten first.' },
      name: { type: 'string', description: 'Short Latin kebab-case name for a new folder and page, e.g. checkout-flow. Leave out to derive it from the title.' },
      quality: { type: 'string', enum: ['showcase', 'standard'], description: 'Default: the candidate\'s meta.quality_profile, else showcase. The tool sets meta.quality_profile to match.' },
      relayout: { type: 'boolean', description: 'For type architecture: lay every component out afresh, dropping the positions and route hints in the candidate. Not needed for a draft without positions (always laid out), or after editing the topology of a candidate this tool laid out (laid out again by itself).' },
      repoRoot: { type: 'string', description: 'For a repository-backed diagram whose repository is not the working directory\'s Git root: the root its source evidence points into. Default: that Git root, when the candidate cites sources.' },
      output: { type: 'string', description: 'Page path, only when the user names one. Default: <name>.html beside the candidate.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } },
      render: renderResult,
      presentationMeta: (_args, value) => {
        const v = value && typeof value === 'object' ? value : {};
        return {
          archify: true,
          ok: v.ok === true,
          type: String(v.type ?? ''),
          title: String(v.title ?? ''),
          status: String(v.status ?? ''),
          failedStage: String(v.failedStage ?? ''),
          gates: v.gates && typeof v.gates === 'object' ? v.gates : {},
          browserSkipped: v.browserSkipped === true,
          output: String(v.output ?? ''),
          candidate: String(v.candidate ?? ''),
          ms: Number(v.ms) || 0,
          autoLayout: v.layout?.ok === true,
          adjusted: Array.isArray(v.adjusted) ? v.adjusted.length : 0,
          ...(v.id ? { id: String(v.id), version: String(v.version ?? ''), aspect: Number(v.aspect) || 0 } : {}),
          ...(v.receipt && !v.ok && Array.isArray(v.receipt.diagnostics)
            ? {
                diagnostics: v.receipt.diagnostics.slice(0, 6).map((d) => ({ code: String(d?.code ?? ''), severity: String(d?.severity ?? ''), message: String(d?.message ?? '').slice(0, 400) })),
                diagnosticTotal: Number(v.receipt.diagnosticSummary?.total) || v.receipt.diagnostics.length,
              }
            : {}),
        };
      },
    },
    timeoutMs: settings.timeoutMs + 15_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => render(ctx, store, settings, args, exec, hooks),
  });
}

/** Commands `archify_cli` does not run: a live preview server never exits on its own. */
const REFUSED = new Map([['preview', `\`preview\` starts a live server that does not exit; use ${RENDER_TOOL}, whose page the user already sees in the conversation.`]]);

export async function runCli(ctx, settings, args, exec) {
  const list = Array.isArray(args?.args) ? args.args.map((x) => String(x)) : [];
  if (list.length === 0) throw new ToolInputError('args must list the Archify command and its arguments, e.g. ["guide", "checkout flow", "--json"]');
  const refusal = REFUSED.get(list[0]);
  if (refusal) throw new ToolInputError(refusal);
  const cwd = cwdOf(ctx, exec);
  const run = await runArchify(list.filter((x) => x !== '--open'), { cwd, signal: exec?.signal, timeoutMs: settings.timeoutMs });
  if (exec?.signal?.aborted) throw new Error('the command was cancelled');
  return { exitCode: run.code ?? -1, stdout: clip(run.stdout, 20_000), stderr: clip(run.stderr, 6000), ms: run.ms, timedOut: run.timedOut };
}

export function buildCliTool(ctx, settings) {
  return defineTool({
    name: CLI_TOOL,
    description:
      'Run an Archify CLI command with the bundled runtime (no Node.js install needed), in the working directory: guide, brands, compare, patch, validate, inspect, check, browser-check, visual-check, migrate, examples, doctor, demo. ' +
      `Pass the arguments that follow \`archify\`, e.g. ["guide", "<scenario>", "--json"]. For rendering and delivery use ${RENDER_TOOL}, not finalize here.`,
    parameters: {
      args: { type: 'array', required: true, items: { type: 'string' }, description: 'The command and its arguments, as separate strings.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { exitCode: { type: 'integer', required: true } } },
      render: (_a, v) => [
        {
          type: 'text',
          text: [`exit ${v?.exitCode}${v?.timedOut ? ' (timed out)' : ''}`, v?.stdout ? String(v.stdout) : '', v?.stderr ? `stderr:\n${v.stderr}` : ''].filter(Boolean).join('\n'),
        },
      ],
    },
    timeoutMs: settings.timeoutMs + 15_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => runCli(ctx, settings, args, exec),
  });
}

/** Run one `archify_scan` call. */
export async function scan(ctx, args, exec) {
  const cwd = cwdOf(ctx, exec);
  const dir = typeof args?.path === 'string' && args.path.trim() !== '' ? resolveFrom(cwd, args.path) : cwd;
  let ok = false;
  try {
    ok = statSync(dir).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new ToolInputError(`not a folder: ${dir}`);
  const started = Date.now();
  const result = await scanRepo(dir);
  return { root: result.root, revision: result.facts.revision, remote: result.facts.remote, text: result.text, ms: Date.now() - started };
}

export function buildScanTool(ctx) {
  return defineTool({
    name: SCAN_TOOL,
    description:
      'Overview of a code repository for an Archify diagram, in one call: the Git remote and revision (for meta.repository and cited sources), the folder tree with file counts, languages, manifests with their dependencies, Docker Compose services, Dockerfiles, Kubernetes objects, Terraform resources, CI workflows, configuration key names (never values) and the opening of the README. ' +
      'Call it first when drawing a codebase, instead of listing folders and opening manifests one by one; then read only the source files you will cite.',
    parameters: {
      path: { type: 'string', description: 'A folder in the repository (relative to the working directory, absolute or ~/…); its Git root is scanned. Default: the working directory.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { text: { type: 'string', required: true } } },
      render: (_a, v) => [{ type: 'text', text: String(v?.text ?? '') }],
      presentationMeta: (_a, v) => ({ archifyScan: true, root: String(v?.root ?? ''), chars: String(v?.text ?? '').length, ms: Number(v?.ms) || 0 }),
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => scan(ctx, args, exec),
  });
}

// --- reviews: written by the model from the code, checked here --------------------------

/** HEAD of the checkout at `root`, or ''. */
function headOf(root) {
  return new Promise((resolve) => {
    if (!root) return resolve('');
    execFile('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

/**
 * What a page's review rests on: the code of the checkout it was drawn from (when its
 * diagram cites sources, or a panel run drew it from a folder), else its own design.
 */
export async function reviewBasis(item, { fromFolder = false } = {}) {
  const spec = parseJson(readText(item?.candidate));
  const root = item?.cwd ? await gitRoot(item.cwd) : '';
  const code = Boolean(root) && (fromFolder || citesEvidence(item.type, spec));
  return { basis: code ? 'code' : 'description', repo: code ? root : '', spec };
}

/** Run one `archify_review` call: check the review and keep it with its page. */
export async function submitReview(ctx, store, args, exec) {
  const a = args && typeof args === 'object' ? args : {};
  const cwd = cwdOf(ctx, exec);
  const candidate = typeof a.candidate === 'string' && a.candidate.trim() !== '' ? resolveFrom(cwd, a.candidate) : '';
  const item = (typeof a.page === 'string' && store.get(a.page)) || (candidate ? store.find((it) => it.candidate === candidate) : undefined);
  if (!item) throw new ToolInputError(`no delivered page has the candidate ${candidate || '(none given)'}; pass the candidate path of the diagram being reviewed`);
  const spec = parseJson(readText(item.candidate));
  const coll = EVIDENCE_NODES[item.type];
  const componentIds = coll && Array.isArray(spec?.[coll]) ? spec[coll].map((n) => String(n?.id ?? '')).filter(Boolean) : [];
  const repoRoot = a.basis === 'description' ? '' : await gitRoot(item.cwd || cwd);
  const check = checkReview(a, { repoRoot, componentIds });
  if (!check.ok) throw new ToolInputError(`The review was not saved. Fix these and call ${REVIEW_TOOL} again:\n- ${check.errors.slice(0, 20).join('\n- ')}`);
  const revision = check.review.basis === 'code' ? await headOf(repoRoot) : '';
  store.patch(item.id, { review: { ...check.review, repo: repoRoot ? basename(repoRoot) : '', revision, at: Date.now() } });
  return { ok: true, id: item.id, title: item.title, basis: check.review.basis, findings: check.review.findings.length, cited: check.review.findings.reduce((n, f) => n + f.evidence.length, 0) };
}

export function buildReviewTool(ctx, store) {
  return defineTool({
    name: REVIEW_TOOL,
    description:
      'Submit an architecture review of a delivered Archify diagram, written after reading the code, so the person sees it beside the diagram in the Archify panel. Use it when asked to review a diagram\'s architecture. ' +
      'Every finding rests on evidence: with basis "code", repository files with line ranges ({"path": "src/x.ts", "line": 12, "end_line": 40, "note": "…"}), which the tool checks exist and shows beside the point; with basis "description" (a diagram drawn from a description, no code), the diagram\'s component ids ({"component": "api"}). ' +
      'A finding whose evidence does not check out is refused, with the reason; fix it or leave the point out, and call again.',
    parameters: {
      candidate: { type: 'string', required: true, description: 'Path of the reviewed diagram\'s candidate file (as given in the request).' },
      basis: { type: 'string', required: true, enum: ['code', 'description'], description: 'code: the review was checked against the repository; description: the diagram has no code behind it.' },
      software: { type: 'string', required: true, description: 'What kind of software this is and how it runs, as established from the code, in one line.' },
      verdict: { type: 'string', required: true, description: 'One or two sentences on the architecture as a whole.' },
      findings: {
        type: 'array',
        required: true,
        items: { type: 'object', additionalProperties: true },
        description: `Up to ${MAX_FINDINGS}, the ones that matter: {"level": "risk"|"warn"|"info"|"good", "title": "…", "detail": "what the code does and why it matters", "suggestion": "a change that can be made (required unless good)", "evidence": [ up to 4 citations ]}.`,
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } },
      render: (_a, v) => [
        {
          type: 'text',
          text: `Saved the review of "${v?.title}" (${v?.findings} points, ${v?.cited} citations${v?.basis === 'code' ? ' checked against the code' : ' to the diagram\'s components'}). The person sees it in the Archify panel beside the diagram. Reply with the verdict and the most important points in a few sentences; do not repeat the citations.`,
        },
      ],
      presentationMeta: (_a, v) => ({ archifyReview: true, id: String(v?.id ?? ''), title: String(v?.title ?? ''), findings: Number(v?.findings) || 0, basis: String(v?.basis ?? '') }),
    },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    execute: (args, exec) => submitReview(ctx, store, args, exec),
  });
}

// --- the panel's own runs: a new diagram, a review ------------------------------------

/** What `service` in the Host gives, or undefined. */
const service = (ctx, name) => {
  try {
    return ctx.get?.(name);
  } catch {
    return undefined;
  }
};

/** A folder the person typed or picked: absolute, `~/…` expanded, and an existing directory. */
export function folderOf(input) {
  const raw = String(input ?? '').trim();
  if (raw === '') return '';
  const dir = raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(dir)) throw new ToolInputError('give the folder as an absolute path');
  let ok = false;
  try {
    ok = statSync(dir).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) throw new ToolInputError(`not a folder: ${dir}`);
  return dir;
}

/**
 * The panel's runs. Each starts a conversation of its own (in the project's
 * workspace, or in the plugin's own folder for a described subject), sends
 * the prompt as the person's first message, and is followed in `jobs`.
 */
export function createRunner(ctx, { jobs, store, workdir }) {
  async function placeOf(dir) {
    const folder = dir || workdir;
    mkdirSync(folder, { recursive: true });
    const reg = service(ctx, 'workspaceRegistry');
    const ws = reg?.create ? await reg.create(folder, dir ? basename(dir) : 'Archify').catch(() => undefined) : undefined;
    return ws?.id ? { workspaceId: ws.id } : { cwd: folder };
  }

  /** Send `text` to a conversation (a new one when `sessionId` is not given or is gone). */
  async function send({ text, title, dir, sessionId }) {
    const controller = service(ctx, 'sessionController');
    if (!controller?.create || !controller?.resolveAgent) throw new Error('this Harness cannot start conversations from a plugin');
    let id = sessionId;
    let found = id ? await controller.resolveAgent(id).catch((error) => ({ error })) : null;
    if (!found || 'error' in found) {
      id = `session-${randomUUID()}`;
      await controller.create({ sessionId: id, ...(await placeOf(dir)) });
      found = await controller.resolveAgent(id);
      if ('error' in found) throw found.error;
      try {
        if (title) service(ctx, 'sessionTitle')?.rename?.(found.agent.session, title);
      } catch {
        // A title is cosmetic.
      }
    }
    const agent = found.agent;
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
    if (typeof agent.followup === 'function') agent.followup(message);
    else if (typeof agent.steer === 'function') agent.steer(message);
    else throw new Error('this Harness cannot send a message from a plugin');
    try {
      await service(ctx, 'sessions')?.flush?.(agent.session);
    } catch {
      // Ordinary persistence follows.
    }
    return id;
  }

  return {
    /** The prompt for a new diagram (with the repository's scan when `scanned`). */
    async prompt(body, { scanned = false } = {}) {
      // A preview of a folder that is not there yet still shows its prompt, with the reason beside it.
      let dir;
      let folderError = '';
      try {
        dir = folderOf(body.dir);
      } catch (error) {
        if (!body.lenient) throw error;
        dir = String(body.dir ?? '').trim();
        folderError = String(error?.message ?? error);
      }
      const type = PICKABLE.includes(body.type) ? body.type : 'auto';
      const digest = dir && scanned && !folderError ? (await scanRepo(dir)).text : '';
      return { dir, type, ...(folderError ? { folderError } : {}), prompt: generationPrompt({ lang: body.lang === 'zh' ? 'zh' : 'en', type, focus: String(body.focus ?? ''), dir, quality: body.quality === 'standard' ? 'standard' : 'showcase', digest: folderError ? '' : digest }) };
    },
    /** Start a new diagram in a conversation of its own. */
    async generate(body) {
      const dir = folderOf(body.dir);
      const type = PICKABLE.includes(body.type) ? body.type : 'auto';
      const focus = String(body.focus ?? '').trim();
      const lang = body.lang === 'zh' ? 'zh' : 'en';
      const quality = body.quality === 'standard' ? 'standard' : 'showcase';
      // The same settings while their run is still going (a second click, another window) get that run, not a new one.
      // Nothing is awaited between the check and the job, so two requests at once still start one.
      const key = createHash('sha256').update(JSON.stringify(['diagram', dir, type, focus, quality, lang])).digest('hex').slice(0, 24);
      const same = jobs.running(key);
      if (same) return { ok: true, already: true, job: same };
      const title = ['Archify', type === 'auto' ? '' : typeName(type, lang), dir ? basename(dir) : focus.slice(0, 40)].filter(Boolean).join(' · ');
      const job = jobs.create({ kind: 'diagram', key, type, dir, focus: focus.slice(0, 200), lang, quality, title });
      try {
        const { prompt } = await this.prompt(body, { scanned: true });
        const sessionId = await send({ text: prompt, title, dir });
        jobs.update(job.id, { sessionId, state: 'running', activity: 'thinking', seenAt: Date.now() });
        return { ok: true, job: jobs.get(job.id) };
      } catch (error) {
        jobs.update(job.id, { state: 'failed', error: String(error?.message ?? error).slice(0, 300), endedAt: Date.now() });
        return { ok: false, reason: String(error?.message ?? error), job: jobs.get(job.id) };
      }
    },
    /** A change to a delivered page, in the conversation that drew it (which knows its context), or a new one beside it. */
    async edit(body) {
      const item = store.get(String(body.id ?? ''));
      if (!item) return { ok: false, reason: 'missing' };
      const instruction = String(body.text ?? '').trim().slice(0, 4000);
      if (!instruction) return { ok: false, reason: 'empty' };
      const lang = body.lang === 'zh' ? 'zh' : 'en';
      const text = editPrompt({ lang, title: item.title, type: item.type, candidate: item.candidate, output: item.html, instruction });
      const job = jobs.create({ kind: 'edit', type: item.type, dir: item.cwd, focus: instruction.slice(0, 120), title: `Archify · ${lang === 'zh' ? '改图' : 'edit'} · ${item.title}`, pageId: item.id });
      try {
        const sessionId = await send({ text, title: job.title, dir: item.cwd, sessionId: item.sessionId });
        jobs.update(job.id, { sessionId, state: 'running', activity: 'thinking', seenAt: Date.now() });
        return { ok: true, job: jobs.get(job.id) };
      } catch (error) {
        jobs.update(job.id, { state: 'failed', error: String(error?.message ?? error).slice(0, 300), endedAt: Date.now() });
        return { ok: false, reason: String(error?.message ?? error), job: jobs.get(job.id) };
      }
    },
    /** Ask for a review of a delivered Architecture, in the conversation that drew it when it is still there. */
    async review(body) {
      const item = store.get(String(body.id ?? ''));
      if (!item) return { ok: false, reason: 'missing' };
      const fromFolder = jobs.list(40).some((j) => j.kind === 'diagram' && j.dir && Array.isArray(j.pages) && j.pages.includes(item.id));
      const { basis, repo } = await reviewBasis(item, { fromFolder });
      const text = reviewPrompt({ lang: body.lang === 'zh' ? 'zh' : 'en', title: item.title, candidate: item.candidate, repo, revision: await headOf(repo), basis });
      const job = jobs.create({ kind: 'review', type: item.type, dir: item.cwd, title: `Archify · ${body.lang === 'zh' ? '点评' : 'review'} · ${item.title}`, pageId: item.id });
      try {
        const sessionId = await send({ text, title: job.title, dir: item.cwd, sessionId: body.newConversation === true ? '' : item.sessionId });
        jobs.update(job.id, { sessionId, state: 'running', activity: 'thinking', seenAt: Date.now() });
        return { ok: true, job: jobs.get(job.id) };
      } catch (error) {
        jobs.update(job.id, { state: 'failed', error: String(error?.message ?? error).slice(0, 300), endedAt: Date.now() });
        return { ok: false, reason: String(error?.message ?? error), job: jobs.get(job.id) };
      }
    },
  };
}

// --- the plugin ---------------------------------------------------------------------

/**
 * Register the skill, the tools, the gallery routes and the `/archify` command.
 * @param ctx - plugin context.
 * @param {unknown} config - the Loader row's config.
 */
export function apply(ctx, config) {
  const settings = settingsOf(config);
  const dir = join(homeDir(), 'cache', 'archify');
  const store = createStore(dir);
  const jobs = createJobs(dir);
  const runner = createRunner(ctx, { jobs, store, workdir: settings.workdir || join(homeDir(), 'archify', 'workspace') });

  if (settings.enabled && typeof ctx.tools?.register === 'function') {
    const hooks = { onDelivered: (item) => jobs.delivered(item.sessionId, item.id) };
    ctx.effect(() => ctx.tools.register(buildRenderTool(ctx, store, settings, hooks)));
    ctx.effect(() => ctx.tools.register(buildCliTool(ctx, settings)));
    ctx.effect(() => ctx.tools.register(buildScanTool(ctx)));
    ctx.effect(() => ctx.tools.register(buildReviewTool(ctx, store)));
  }

  // The panel follows the conversations it started: their tool calls, and their end.
  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => {
      try {
        if (event?.type === 'tool/call' && session?.id) jobs.noteCall(session.id, event.data?.name);
      } catch {
        // Following a job is a convenience.
      }
    });
    ctx.on('agent/status', (payload) => {
      try {
        const sid = payload?.agent?.session?.id;
        if (sid && payload.status === 'idle') jobs.idle(sid);
      } catch {
        // Ignored.
      }
    });
  }

  if (settings.skill && typeof ctx.inject === 'function') {
    ctx.inject(['skills'], (scope) => {
      if (typeof scope.skills?.registerProvider !== 'function') return;
      scope.effect(() => scope.skills.registerProvider(skillProvider()));
    });
  }

  const commands = ctx.get?.('commands');
  if (commands !== undefined && typeof commands?.register === 'function') {
    ctx.effect(() =>
      commands.register({
        name: 'archify',
        description: 'Open the Archify panel: every diagram and explainer page drawn in your conversations',
        handler: () => {
          const n = store.size();
          return { kind: 'success', text: n === 0 ? 'No diagrams yet. Ask for one: "draw the architecture of this repo".' : `${n} page${n > 1 ? 's' : ''} in the Archify panel.` };
        },
      }),
    );
  }

  const mountRoutes = (scope) => {
    const webServer = scope.webServer;
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: STATE_ROUTE,
        handler: (_req, res) =>
          serveJson(res, () => ({ total: store.size(), tools: settings.enabled, canRun: typeof service(ctx, 'sessionController')?.create === 'function', home: homedir(), upstream: upstream() })),
      }),
    );
    // A thrown input error is an answer the panel shows, not a server failure.
    const answer = (produce) => async (body) => {
      try {
        return await produce(body);
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? error) };
      }
    };
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: PROMPT_ROUTE,
        handler: (req, res) => postJson(req, res, answer(async (body) => ({ ok: true, ...(await runner.prompt(body)) }))),
      }),
    );
    scope.effect(() => webServer.register({ kind: 'exact', path: GENERATE_ROUTE, handler: (req, res) => postJson(req, res, answer((body) => runner.generate(body))) }));
    scope.effect(() => webServer.register({ kind: 'exact', path: ASK_ROUTE, handler: (req, res) => postJson(req, res, answer((body) => runner.review(body))) }));
    scope.effect(() => webServer.register({ kind: 'exact', path: EDIT_ROUTE, handler: (req, res) => postJson(req, res, answer((body) => runner.edit(body))) }));
    scope.effect(() => webServer.register({ kind: 'exact', path: JOBS_ROUTE, handler: (_req, res) => serveJson(res, () => ({ jobs: jobs.list(12) })) }));
    scope.effect(() => webServer.register({ kind: 'exact', path: DISMISS_ROUTE, handler: (req, res) => postJson(req, res, (body) => ({ ok: jobs.remove(String(body.id ?? '')) })) }));
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: REVIEW_ROUTE,
        handler: (req, res) =>
          serveJson(res, async () => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const item = store.get(url.searchParams.get('id') ?? '');
            if (!item) return { supported: false, reason: 'missing' };
            if (!existsSync(item.candidate)) return { supported: false, reason: 'no-candidate' };
            const fromFolder = jobs.list(40).some((j) => j.kind === 'diagram' && j.dir && Array.isArray(j.pages) && j.pages.includes(item.id));
            const { basis, repo } = await reviewBasis(item, { fromFolder });
            return { supported: true, basis, repo: repo ? basename(repo) : '', review: item.review ?? null };
          }),
      }),
    );
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: LIST_ROUTE,
        handler: (req, res) =>
          serveJson(res, () => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
            const page = store.list({ limit, before: url.searchParams.get('before') ?? '' });
            return { ...page, items: page.items.map(publicItem) };
          }),
      }),
    );
    scope.effect(() => webServer.register({ kind: 'prefix', path: FILE_ROUTE, handler: (req, res) => servePage(store, req, res) }));
    // What each diagram type looks like: a thumbnail, and its example as a live page.
    scope.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: PREVIEW_ROUTE,
        handler: (req, res) => {
          const name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname.slice(PREVIEW_ROUTE.length + 1));
          const file = previewFile(name);
          if (!file) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'image/webp');
          res.setHeader('cache-control', 'public, max-age=86400');
          res.setHeader('x-content-type-options', 'nosniff');
          if (req.method === 'HEAD') return void res.end();
          createReadStream(file).on('error', () => res.end()).pipe(res);
        },
      }),
    );
    scope.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: EXAMPLE_ROUTE,
        handler: (req, res) => {
          const type = new URL(req.url ?? '/', 'http://localhost').pathname.slice(EXAMPLE_ROUTE.length + 1).split('/')[0];
          if (!EXAMPLES[type]) {
            res.statusCode = 404;
            res.end();
            return;
          }
          void examplePage(type, dir).then((file) => streamPage(req, res, file), () => streamPage(req, res, ''));
        },
      }),
    );
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: DELETE_ROUTE,
        handler: (req, res) => postJson(req, res, (body) => ({ ok: store.remove(String(body.id ?? '')) })),
      }),
    );
    scope.effect(() =>
      webServer.register({
        kind: 'exact',
        path: OPEN_ROUTE,
        handler: (req, res) =>
          postJson(req, res, async (body) => {
            const item = store.get(String(body.id ?? ''));
            if (!item || !existsSync(item.html)) return { ok: false, reason: 'missing' };
            await openWithSystem(item.html, body.action === 'reveal');
            return { ok: true };
          }),
      }),
    );
  };
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mountRoutes);
  else if (ctx.webServer) mountRoutes({ webServer: ctx.webServer, effect: (fn) => ctx.effect(fn) });

  ctx.effect(() => () => {
    store.flush();
    jobs.flush();
  });
}

/** One gallery item as the page sees it. */
function publicItem(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    path: item.html,
    folder: dirname(item.html),
    sessionId: item.sessionId,
    cwd: item.cwd ?? '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    gates: item.gates,
    browserSkipped: item.browserSkipped === true,
    bytes: item.bytes,
    version: item.version,
    reviewedAt: item.review?.at ?? 0,
    aspect: item.aspect ?? 0,
    missing: item.missing === true,
    url: `${FILE_ROUTE}/${item.id}`,
  };
}

/**
 * The response headers of one page. The page runs in a sandbox with an opaque
 * origin, embedded or opened on its own: its scripts (the Archify viewer) work,
 * and nothing on it can reach the Harness page or its routes.
 */
export const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': 'sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox allow-modals',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

/** Stream one gallery page; `?download=1` saves it. */
function servePage(store, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const id = decodeURIComponent(url.pathname.slice(FILE_ROUTE.length + 1)).split('/')[0];
  streamPage(req, res, store.get(id)?.html ?? '');
}

/** Stream one page file in its sandbox, or say it is gone. */
function streamPage(req, res, file) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const item = file ? { html: file } : null;
  let size = 0;
  try {
    if (item?.html) size = statSync(item.html).size;
  } catch {
    size = 0;
  }
  if (!item || size === 0) {
    res.statusCode = 404;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('This page is no longer on disk.');
    return;
  }
  res.statusCode = 200;
  for (const [k, v] of Object.entries(PAGE_HEADERS)) res.setHeader(k, v);
  res.setHeader('content-length', String(size));
  if (url.searchParams.get('download') === '1') {
    const name = basename(item.html).replace(/[^\w.\-]+/g, '_') || 'archify.html';
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(item.html);
  stream.on('error', () => {
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
  stream.pipe(res);
}

/** Open a file with the default app, or show it in its folder. */
function openWithSystem(path, reveal) {
  const platform = process.platform;
  let cmd;
  let args;
  if (platform === 'darwin') {
    cmd = 'open';
    args = reveal ? ['-R', path] : [path];
  } else if (platform === 'win32') {
    cmd = reveal ? 'explorer.exe' : 'cmd.exe';
    args = reveal ? [`/select,${path}`] : ['/c', 'start', '""', path];
  } else {
    cmd = 'xdg-open';
    args = [reveal ? dirname(path) : path];
  }
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, () => resolve());
  });
}

/**
 * Answer one state-changing request. Only a JSON POST is taken: a cross-site page
 * cannot send one without a CORS preflight, which these routes never grant.
 */
function postJson(req, res, produce) {
  const type = String(req.headers?.['content-type'] ?? '');
  if (req.method !== 'POST' || !/^application\/json\b/i.test(type)) {
    res.statusCode = req.method === 'POST' ? 415 : 405;
    res.end();
    return;
  }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    serveJson(res, () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        return { ok: false, reason: 'bad-request' };
      }
      return produce(body && typeof body === 'object' ? body : {});
    });
  });
}

/** Answer one request as JSON; a thrown handler becomes a stable error body. */
function serveJson(res, produce) {
  Promise.resolve()
    .then(produce)
    .then((body) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(body));
    })
    .catch((error) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, reason: error?.message ?? String(error) }));
    });
}

export { CLI, SKILL_ROOT };
