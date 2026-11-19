/**
 * One example per diagram type, from Archify's own examples: the panel shows
 * a thumbnail of each (`assets/previews/<type>-<theme>.webp`, made by
 * `scripts/build-previews.py`) and, on a click, the example itself as a live
 * page, rendered here on first use and kept in the cache.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SKILL_ROOT, parseJsonOutput, runArchify } from './run.mjs';

export const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'deployment-release.lifecycle.json',
  erd: 'orders.erd.json',
  tree: 'payment-platform.tree.json',
  class: 'payments.class.json',
  timeline: 'payment-incident.timeline.json',
  waterfall: 'checkout-request.waterfall.json',
  explainer: 'delivery.explainer.json',
  // Not a type: a before/after delta page of two versions of one architecture.
  compare: ['checkout-platform.base.architecture.json', 'checkout-platform.head.architecture.json'],
};

export const PREVIEWS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'previews');

/** The thumbnail of a type in a theme, if the package has it. */
export function previewFile(name) {
  const m = /^([a-z]+)-(light|dark)\.webp$/.exec(String(name ?? ''));
  if (!m || !EXAMPLES[m[1]]) return '';
  const file = join(PREVIEWS, `${m[1]}-${m[2]}.webp`);
  return existsSync(file) ? file : '';
}

const inflight = new Map();

/**
 * The example page of a type: rendered once per example version into
 * `<cacheDir>/examples/`, then served from there.
 * @returns {Promise<string>} the HTML path, or '' when it cannot be rendered
 */
export function examplePage(type, cacheDir, { timeoutMs = 60_000 } = {}) {
  const name = EXAMPLES[type];
  if (!name) return Promise.resolve('');
  const sources = (Array.isArray(name) ? name : [name]).map((n) => join(SKILL_ROOT, 'examples', n));
  let digest;
  try {
    const hash = createHash('sha256');
    for (const f of sources) hash.update(readFileSync(f));
    digest = hash.digest('hex').slice(0, 12);
  } catch {
    return Promise.resolve('');
  }
  const dir = join(cacheDir, 'examples');
  const out = join(dir, `${type}-${digest}.html`);
  try {
    if (statSync(out).size > 0) return Promise.resolve(out);
  } catch {
    // Not rendered yet.
  }
  if (inflight.has(out)) return inflight.get(out);
  const job = (async () => {
    mkdirSync(dir, { recursive: true });
    const args = type === 'compare' ? ['compare', 'architecture', ...sources, out, '--json'] : ['deliver', type, sources[0], out, '--json', '--quality', 'showcase'];
    const run = await runArchify(args, { cwd: dir, timeoutMs });
    const receipt = parseJsonOutput(run.stdout);
    return receipt?.ok !== false && existsSync(out) ? out : '';
  })().finally(() => inflight.delete(out));
  inflight.set(out, job);
  return job;
}
