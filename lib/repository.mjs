/**
 * The repository identity a diagram's source evidence needs, filled from the
 * checkout itself. Archify checks `meta.repository` strictly (a credential-free
 * remote that matches `origin`, a full commit that exists, canonical HTTPS for
 * web links), and a model writing it by hand often needs several failed
 * renders to get there. The tool knows the origin and HEAD, so it writes them.
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SKILL_ROOT } from './run.mjs';

const { parseRepositoryRemote } = await import(pathToFileURL(join(SKILL_ROOT, 'renderers', 'shared', 'repository-location.mjs')).href);

const HOSTS = { github: 'github.com', gitee: 'gitee.com', gitlab: 'gitlab.com' };
/** Where each diagram type keeps the nodes that carry `sources` (Archify's own table). */
export const EVIDENCE_NODES = { architecture: 'components', workflow: 'nodes', sequence: 'participants', dataflow: 'nodes', lifecycle: 'states', erd: 'entities', tree: 'nodes', class: 'types', timeline: 'events', waterfall: 'spans' };
const SHA = /^[0-9a-f]{40}$/i;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => resolve({ ok: !error, out: String(stdout ?? '').trim() }));
  });
}

/** Origin and HEAD of the checkout at `root`, or null outside one. */
export async function repositoryFacts(root) {
  if (!root) return null;
  const [origin, head] = await Promise.all([git(root, ['remote', 'get-url', 'origin']), git(root, ['rev-parse', 'HEAD'])]);
  if (!head.ok || !SHA.test(head.out)) return null;
  return { root, origin: origin.ok ? origin.out : '', head: head.out.toLowerCase() };
}

/** The `meta.repository` Archify accepts for a checkout, or null when its origin cannot be matched. */
export function repositoryFor(origin, head) {
  const loc = parseRepositoryRemote(origin);
  if (!loc || !SHA.test(head ?? '')) return null;
  // A public forge's SSH and HTTPS addresses are one repository: the HTTPS one gives web links.
  if (loc.provider && loc.endpoint === 'standard' && HOSTS[loc.provider] && !/[^\w.\-/]/.test(loc.path)) return { url: `https://${HOSTS[loc.provider]}/${loc.path}`, revision: head, link_mode: 'web' };
  return { url: loc.url, revision: head, link_mode: 'local-only' };
}

/** Whether the candidate claims source evidence. */
export function citesEvidence(type, spec) {
  const coll = EVIDENCE_NODES[type];
  if (!coll || !isObject(spec)) return false;
  return isObject(spec.meta?.repository) || (Array.isArray(spec[coll]) && spec[coll].some((n) => Array.isArray(n?.sources) && n.sources.length > 0));
}

/**
 * Make a candidate's repository identity the checkout's own.
 * @param {object|null} facts - from `repositoryFacts`, null outside a Git checkout
 * @returns {Promise<{spec: object, changes: string[]}>}
 */
export async function fixRepository(type, spec, facts) {
  if (!citesEvidence(type, spec)) return { spec, changes: [] };
  const out = JSON.parse(JSON.stringify(spec));
  const want = facts ? repositoryFor(facts.origin, facts.head) : null;
  if (!want) {
    // Nothing Archify could verify the evidence against: keep the diagram, leave out what it cannot carry.
    const coll = EVIDENCE_NODES[type];
    let dropped = 0;
    for (const n of Array.isArray(out[coll]) ? out[coll] : []) {
      if (Array.isArray(n?.sources)) {
        dropped += n.sources.length;
        delete n.sources;
      }
    }
    if (isObject(out.meta)) delete out.meta.repository;
    const why = facts ? `the repository's origin remote (${facts.origin ? 'not a forge or Git SSH address' : 'none'}) cannot be matched` : 'the working directory is not in a Git repository';
    return { spec: out, changes: [`removed /meta/repository and ${dropped} cited source${dropped === 1 ? '' : 's'}: ${why}, so source evidence cannot be verified`] };
  }
  out.meta = isObject(out.meta) ? out.meta : {};
  const cur = isObject(out.meta.repository) ? out.meta.repository : {};
  const next = { ...cur };
  const changes = [];
  const curLoc = parseRepositoryRemote(cur.url, { authored: true, provider: cur.provider });
  const wantLoc = parseRepositoryRemote(want.url, { authored: true });
  const webOk = (cur.link_mode ?? 'web') !== 'web' || (curLoc?.protocol === 'https:' && want.link_mode === 'web');
  if (!curLoc || curLoc.identity !== wantLoc.identity || !webOk) {
    next.url = want.url;
    next.link_mode = want.link_mode;
    changes.push(`/meta/repository/url: ${JSON.stringify(cur.url ?? null)} → ${JSON.stringify(want.url)} (link_mode ${want.link_mode}), the checkout's origin`);
  }
  if (next.provider !== undefined && next.provider !== wantLoc.provider) {
    changes.push(`/meta/repository/provider: removed ${JSON.stringify(next.provider)} (it does not match ${want.url})`);
    delete next.provider;
  }
  const known = SHA.test(cur.revision ?? '') && (await git(facts.root, ['cat-file', '-e', `${cur.revision}^{commit}`])).ok;
  if (!known) {
    next.revision = facts.head;
    changes.push(`/meta/repository/revision: ${JSON.stringify(cur.revision ?? null)} → ${facts.head} (HEAD)`);
  }
  out.meta.repository = next;
  return changes.length > 0 ? { spec: out, changes } : { spec, changes: [] };
}
