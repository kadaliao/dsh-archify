/**
 * Fix the slips a model makes against a diagram's schema before Archify sees
 * the candidate: each one would otherwise cost a failed render and a repair
 * round (a model step of its own).
 *
 * The walk follows the diagram type's own JSON Schema (and the shared
 * `common.schema.json`):
 * - a property the schema does not know is removed, where the schema allows no others;
 * - an enum value off by case or separators ("Security_Group") is spelled right,
 *   a known synonym ("cache", "queue", "vpc", "async") becomes its enum value,
 *   and an optional one that matches nothing is removed;
 * - a list over `maxItems` keeps its first items, a label over `maxLength` is cut;
 * - a source given as a bare path becomes `{path}`, a number written as text a number;
 * - a missing `schema_version` or `diagram_type` is filled in, and
 *   `meta.quality_profile` follows the quality the render runs at.
 * Everything else (ids, references between elements, required fields) is left
 * for Archify's diagnostics: guessing there would change the diagram's meaning.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SKILL_ROOT } from './run.mjs';

const SCHEMAS = join(SKILL_ROOT, 'schemas');
const cache = new Map();

/** One schema file, parsed once. */
function schemaFile(name) {
  if (!cache.has(name)) {
    try {
      cache.set(name, JSON.parse(readFileSync(join(SCHEMAS, name), 'utf8')));
    } catch {
      cache.set(name, null);
    }
  }
  return cache.get(name);
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_./]+/g, '-').replace(/-+/g, '-');

/** Words that mean an enum value, by the enum they belong to (matched on its exact value list). */
const COMPONENT_WORDS = {
  frontend: ['client', 'web', 'webapp', 'ui', 'app', 'mobile', 'ios', 'android', 'browser', 'spa', 'desktop', 'cli', 'user', 'users', 'actor', 'person', 'customer', 'portal', 'site', 'website', 'dashboard', 'console', 'terminal'],
  backend: ['service', 'services', 'server', 'api', 'worker', 'function', 'lambda', 'microservice', 'job', 'scheduler', 'cron', 'gateway', 'api-gateway', 'bff', 'proxy', 'compute', 'container', 'module', 'library', 'sdk', 'plugin', 'engine', 'process', 'daemon', 'app-server', 'runtime', 'handler', 'controller', 'agent', 'tool', 'host'],
  database: ['db', 'datastore', 'data-store', 'store', 'storage', 'cache', 'redis', 'memcached', 'sql', 'nosql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'mongo', 'sqlite', 'table', 'index', 'search', 'elasticsearch', 'opensearch', 'warehouse', 'datalake', 'data-lake', 'lake', 'file', 'files', 'filesystem', 'file-system', 'disk', 'volume', 'blob', 'object-storage', 's3', 'bucket', 'vector-db', 'vectorstore', 'kv'],
  cloud: ['cdn', 'hosting', 'platform', 'infra', 'infrastructure', 'kubernetes', 'k8s', 'cluster', 'paas', 'iaas', 'serverless', 'edge', 'load-balancer', 'loadbalancer', 'lb', 'dns'],
  security: ['auth', 'authentication', 'authorization', 'iam', 'firewall', 'waf', 'identity', 'oauth', 'oidc', 'sso', 'vault', 'secret', 'secrets', 'kms', 'policy', 'guard', 'shield', 'lock'],
  messagebus: ['queue', 'mq', 'message-queue', 'kafka', 'bus', 'event-bus', 'eventbus', 'stream', 'streams', 'pubsub', 'pub-sub', 'topic', 'broker', 'event', 'events', 'rabbitmq', 'sqs', 'sns', 'nats', 'kinesis', 'channel'],
  external: ['third-party', 'thirdparty', '3rd-party', 'saas', 'partner', 'vendor', 'outside', 'internet', 'remote', 'provider', 'llm', 'openai', 'payment', 'email', 'sms'],
};
const ICON_WORDS = {
  ...COMPONENT_WORDS,
  person: ['user', 'users', 'human', 'people', 'actor', 'customer', 'member', 'operator', 'admin'],
  clock: ['time', 'timer', 'schedule', 'cron', 'deadline', 'duration'],
  calendar: ['date', 'day', 'month', 'plan'],
  briefcase: ['work', 'business', 'office', 'job-role'],
  success: ['done', 'ok', 'complete', 'completed', 'check', 'pass'],
  failure: ['error', 'fail', 'failed', 'x'],
  decision: ['branch', 'choice', 'question'],
  waiting: ['wait', 'pending', 'pause', 'hourglass'],
  start: ['begin', 'entry', 'play'],
  stop: ['end', 'finish', 'terminal', 'halt'],
};
// A person is a person on an icon, but a component's type has no "person": that stays frontend.
delete ICON_WORDS.frontend;
ICON_WORDS.frontend = COMPONENT_WORDS.frontend.filter((w) => !ICON_WORDS.person.includes(w));
const BOUNDARY_WORDS = {
  'security-group': ['vpc', 'subnet', 'network', 'security', 'firewall', 'private', 'private-network', 'dmz', 'sg', 'trust-boundary', 'trust-zone', 'secure', 'perimeter'],
};
const VARIANT_WORDS = {
  dashed: ['async', 'asynchronous', 'event', 'events', 'optional', 'background', 'queue', 'pubsub', 'stream', 'weak', 'eventual', 'callback', 'webhook', 'dotted', 'notify'],
  emphasis: ['primary', 'main', 'critical', 'hot', 'important', 'highlight', 'bold', 'strong', 'key'],
  security: ['secure', 'auth', 'encrypted', 'tls', 'mtls', 'https', 'signed'],
  default: ['sync', 'synchronous', 'normal', 'plain', 'request', 'call', 'solid', 'regular'],
};

/** The synonym table for an enum, picked by its values; the fallback for a required one. */
function wordsFor(values) {
  const key = [...values].sort().join('|');
  if (key === 'backend|cloud|database|external|frontend|messagebus|security') return { words: COMPONENT_WORDS };
  if (values.includes('person') && values.includes('messagebus') && values.includes('none')) return { words: ICON_WORDS };
  if (key === 'region|security-group') return { words: BOUNDARY_WORDS, fallback: 'region' };
  if (key === 'dashed|default|emphasis|security') return { words: VARIANT_WORDS };
  return { words: {} };
}

/** The enum value `value` means, or undefined. */
export function enumValue(value, values) {
  if (typeof value !== 'string') return undefined;
  const n = norm(value);
  const direct = values.find((v) => typeof v === 'string' && norm(v) === n);
  if (direct !== undefined) return direct;
  const { words } = wordsFor(values);
  for (const [to, list] of Object.entries(words)) if (values.includes(to) && list.includes(n)) return to;
  // A compound word ("payment-service", "redis-cache") by its last, then first, known part.
  const parts = n.split('-').filter(Boolean);
  for (const part of [...parts].reverse()) {
    const hit = values.find((v) => typeof v === 'string' && norm(v) === part);
    if (hit !== undefined) return hit;
    for (const [to, list] of Object.entries(words)) if (values.includes(to) && list.includes(part)) return to;
  }
  return undefined;
}

/** Resolve a `$ref` from the file `file`: `common.schema.json#/$defs/x` or `#/$defs/x`. */
function resolve(node, file) {
  let at = node;
  let where = file;
  for (let hops = 0; isObject(at) && typeof at.$ref === 'string' && hops < 8; hops += 1) {
    const [target, pointer = ''] = at.$ref.split('#');
    if (target) where = target;
    const root = schemaFile(where);
    let next = root;
    for (const step of pointer.split('/').filter(Boolean)) next = next?.[step.replace(/~1/g, '/').replace(/~0/g, '~')];
    // Keywords beside the $ref (a description, a narrower bound) stay with it.
    const { $ref: _ref, ...beside } = at;
    at = isObject(next) ? { ...next, ...beside } : beside;
  }
  return { node: at, file: where };
}

/** Every property name any branch of an object schema knows: deleting one a branch allows would be wrong. */
function knownProperties(node, file, seen = new Set()) {
  const names = new Set(Object.keys(node.properties ?? {}));
  for (const k of ['allOf', 'anyOf', 'oneOf']) {
    for (const branch of Array.isArray(node[k]) ? node[k] : []) {
      const r = resolve(branch, file);
      if (seen.has(r.node)) continue;
      seen.add(r.node);
      for (const n of knownProperties(r.node, r.file, seen)) names.add(n);
    }
  }
  for (const k of ['then', 'else']) {
    if (isObject(node[k])) for (const n of knownProperties(resolve(node[k], file).node, file, seen)) names.add(n);
  }
  return names;
}

const CUTTABLE = /^(label|sublabel|tag|title|subtitle|note|description|summary|caption|text|detail|name)$/;

/**
 * Walk `value` against `node`, fixing in place what the module comment lists.
 * @returns the value to keep (possibly converted), or `undefined` to drop it.
 */
function walk(value, rawNode, file, path, key, required, changes) {
  const { node, file: at } = resolve(rawNode, file);
  if (!isObject(node)) return value;

  if (Array.isArray(node.enum) && !node.enum.includes(value)) {
    const fixed = enumValue(value, node.enum);
    if (fixed !== undefined) {
      changes.push({ path, change: 'enum', from: value, to: fixed });
      return fixed;
    }
    const { fallback } = wordsFor(node.enum);
    if (required && fallback !== undefined && typeof value === 'string') {
      changes.push({ path, change: 'enum', from: value, to: fallback });
      return fallback;
    }
    if (!required) {
      changes.push({ path, change: 'removed', from: value, reason: 'not an allowed value' });
      return undefined;
    }
    return value;
  }

  const type = node.type;
  if ((type === 'integer' || type === 'number') && typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    if (type === 'number' || Number.isInteger(n)) {
      changes.push({ path, change: 'number', from: value, to: n });
      return n;
    }
  }
  if (typeof value === 'string' && Number.isInteger(node.maxLength) && [...value].length > node.maxLength && !node.pattern && CUTTABLE.test(key)) {
    const cut = `${[...value].slice(0, Math.max(1, node.maxLength - 1)).join('')}…`;
    changes.push({ path, change: 'shortened', from: value, to: cut });
    return cut;
  }

  if (Array.isArray(value)) {
    if (node.items && !node.prefixItems) {
      const items = resolve(node.items, at);
      for (let i = 0; i < value.length; i += 1) {
        // A source given as a bare path.
        if (typeof value[i] === 'string' && items.node?.type === 'object' && Array.isArray(items.node.required) && items.node.required.length === 1 && items.node.required[0] === 'path') {
          changes.push({ path: `${path}/${i}`, change: 'object', from: value[i], to: { path: value[i] } });
          value[i] = { path: value[i] };
        }
        const kept = walk(value[i], items.node, items.file, `${path}/${i}`, key, true, changes);
        if (kept !== undefined) value[i] = kept;
      }
    }
    if (Number.isInteger(node.maxItems) && value.length > node.maxItems) {
      changes.push({ path, change: 'trimmed', from: value.length, to: node.maxItems });
      value.length = node.maxItems;
    }
    return value;
  }

  if (isObject(value) && (node.properties || node.additionalProperties === false)) {
    const props = node.properties ?? {};
    const known = node.additionalProperties === false && !node.patternProperties ? knownProperties(node, at) : null;
    const req = new Set(Array.isArray(node.required) ? node.required : []);
    for (const k of Object.keys(value)) {
      if (props[k]) {
        const kept = walk(value[k], props[k], at, `${path}/${k}`, k, req.has(k), changes);
        if (kept === undefined) delete value[k];
        else value[k] = kept;
      } else if (known && !known.has(k)) {
        changes.push({ path: `${path}/${k}`, change: 'removed', reason: 'not a property of this element' });
        delete value[k];
      }
    }
  }
  return value;
}

/**
 * Fix a candidate's schema slips.
 * @param {string} type - diagram type (not `explainer`, whose draft is Markdown)
 * @param {unknown} spec - the candidate object (not changed)
 * @param {{quality?: 'showcase' | 'standard'}} [o]
 * @returns {{spec: unknown, changes: Array<{path: string, change: string, from?: unknown, to?: unknown, reason?: string}>}}
 */
export function sanitize(type, spec, { quality } = {}) {
  const schema = schemaFile(`${type}.schema.json`);
  if (!schema || !isObject(spec)) return { spec, changes: [] };
  const fixed = JSON.parse(JSON.stringify(spec));
  const changes = [];
  const props = schema.properties ?? {};
  if (fixed.schema_version === undefined) {
    const v = props.schema_version?.const ?? (Array.isArray(props.schema_version?.enum) ? Math.max(...props.schema_version.enum) : undefined);
    if (v !== undefined) {
      fixed.schema_version = v;
      changes.push({ path: '/schema_version', change: 'added', to: v });
    }
  }
  if (fixed.diagram_type === undefined && props.diagram_type?.const) {
    fixed.diagram_type = props.diagram_type.const;
    changes.push({ path: '/diagram_type', change: 'added', to: fixed.diagram_type });
  }
  walk(fixed, schema, `${type}.schema.json`, '', '', true, changes);
  if (quality && isObject(fixed.meta) && fixed.meta.quality_profile !== quality) {
    changes.push({ path: '/meta/quality_profile', change: 'quality', from: fixed.meta.quality_profile, to: quality });
    fixed.meta.quality_profile = quality;
  }
  return { spec: fixed, changes };
}

/** The candidate's own name for an element at a JSON pointer: its id or label, for a readable report. */
function nameAt(spec, path) {
  const steps = path.split('/').filter(Boolean);
  let at = spec;
  let name = '';
  for (const s of steps) {
    at = at?.[s];
    if (isObject(at) && (at.id || at.label)) name = String(at.id ?? at.label);
  }
  return name;
}

/** One line per change, for the model and the tool card. */
export function describeChanges(spec, changes, limit = 12) {
  const lines = changes.slice(0, limit).map((c) => {
    const who = nameAt(spec, c.path);
    const where = `${c.path}${who ? ` (${who})` : ''}`;
    const show = (v) => JSON.stringify(v).slice(0, 60);
    if (c.change === 'enum') return `${where}: ${show(c.from)} → ${show(c.to)}`;
    if (c.change === 'removed') return `${where}: removed${c.from !== undefined ? ` ${show(c.from)}` : ''} (${c.reason})`;
    if (c.change === 'trimmed') return `${where}: kept the first ${c.to} of ${c.from}`;
    if (c.change === 'shortened') return `${where}: shortened to ${show(c.to)}`;
    if (c.change === 'added') return `${where}: set to ${show(c.to)}`;
    if (c.change === 'quality') return `${where}: ${show(c.from)} → ${show(c.to)} (the quality this render runs at)`;
    return `${where}: ${show(c.from)} → ${show(c.to)}`;
  });
  if (changes.length > limit) lines.push(`…and ${changes.length - limit} more`);
  return lines;
}
