/**
 * A repository at a glance, for a diagram of a codebase: what the model would
 * otherwise collect over several steps of listing folders and opening files.
 *
 * It reads names and structure only: the folder tree, languages, manifests
 * (names, entry points, dependencies), Docker Compose services, Dockerfiles,
 * Kubernetes kinds, Terraform resources, CI workflows, configuration *key
 * names* from `.env.example`-style files (never a value, never `.env` itself),
 * likely entry points and the start of the README, plus the Git remote and
 * revision Archify's source evidence needs.
 *
 * Its code map says what the model would otherwise grep and page through: for
 * the source files that matter most, which other files of the repository each
 * imports (folded into a module graph between folders) and its largest
 * top-level declarations with their line numbers, ready to cite.
 */

import { execFile } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, posix as pp, relative, sep } from 'node:path';

const IGNORED = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'vendor', 'bower_components', '.venv', 'venv', 'env', '__pycache__', '.mypy_cache', '.pytest_cache',
  '.tox', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', '.archify', '.dsh', '.idea', '.vscode', '.gradle', 'Pods', 'DerivedData', '.terraform', 'tmp', '.yarn', '.pnpm-store',
]);
const LANGUAGES = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.py': 'Python', '.go': 'Go',
  '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.scala': 'Scala', '.rb': 'Ruby', '.php': 'PHP', '.cs': 'C#', '.fs': 'F#', '.swift': 'Swift', '.m': 'Objective-C',
  '.c': 'C', '.h': 'C', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.dart': 'Dart', '.lua': 'Lua', '.sh': 'Shell', '.vue': 'Vue',
  '.svelte': 'Svelte', '.sql': 'SQL', '.proto': 'Protocol Buffers', '.tf': 'Terraform', '.zig': 'Zig', '.clj': 'Clojure', '.hs': 'Haskell', '.ml': 'OCaml', '.r': 'R', '.jl': 'Julia',
};
const MANIFESTS = new Set(['package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'mix.exs', 'pubspec.yaml', 'deno.json']);
const ENV_SAMPLES = /^\.env\.(example|sample|template|dist|defaults)$|^example\.env$|^sample\.env$/i;
const ENTRY = /^(main|index|app|server|cli|wsgi|asgi|manage|program|startup)\.(js|mjs|cjs|ts|tsx|py|go|rs|java|kt|rb|php|cs|swift|ex)$/i;
const MAX_FILE = 512 * 1024;
const MAX_ENTRIES = 25_000;

const readSmall = (file) => {
  try {
    if (statSync(file).size > MAX_FILE) return '';
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const posix = (p) => p.split(sep).join('/');
const more = (list, n) => (list.length > n ? `${list.slice(0, n).join(', ')} (+${list.length - n})` : list.join(', '));

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => resolve(error ? '' : String(stdout).trim()));
  });
}

/** Strip credentials from a remote URL: `https://token@host/x` names the host only. */
export function cleanRemote(url) {
  const u = String(url ?? '').trim();
  if (u === '') return '';
  try {
    if (/^[a-z]+:\/\//i.test(u)) {
      const parsed = new URL(u);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString().replace(/\/$/, '');
    }
  } catch {
    return '';
  }
  return u;
}

/** Walk the tree once: file counts per folder, languages, and the files worth reading. */
function walkTree(root) {
  const dirs = new Map(); // relative dir -> recursive file count
  const top = []; // files at the root
  const lang = new Map();
  const files = [];
  const found = { manifests: [], compose: [], dockerfiles: [], k8s: [], terraform: [], workflows: [], envSamples: [], entries: [], procfile: '', readme: '' };
  let entries = 0;
  const queue = [[root, 0]];
  while (queue.length > 0 && entries < MAX_ENTRIES) {
    const [dir, depth] = queue.shift();
    let list;
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of list) {
      entries += 1;
      const abs = join(dir, e.name);
      const rel = posix(relative(root, abs));
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (IGNORED.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
        dirs.set(rel, 0);
        if (depth < 6) queue.push([abs, depth + 1]);
        continue;
      }
      if (!e.isFile()) continue;
      // Count the file in every folder above it.
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        const d = parts.slice(0, i).join('/');
        if (dirs.has(d)) dirs.set(d, dirs.get(d) + 1);
      }
      if (depth === 0) top.push(e.name);
      files.push(rel);
      const ext = extname(e.name).toLowerCase();
      if (LANGUAGES[ext]) lang.set(LANGUAGES[ext], (lang.get(LANGUAGES[ext]) ?? 0) + 1);
      const name = e.name;
      if (depth <= 3 && (MANIFESTS.has(name) || /\.csproj$/i.test(name))) found.manifests.push(rel);
      if (depth <= 3 && /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(name)) found.compose.push(rel);
      if (depth <= 3 && /^Dockerfile(\.[\w-]+)?$|\.Dockerfile$/i.test(name)) found.dockerfiles.push(rel);
      if (depth <= 4 && /\.ya?ml$/i.test(name) && /(^|\/)(k8s|kubernetes|deploy|deployment|deployments|manifests|helm|charts|kustomize|infra|ops)(\/|$)/i.test(rel)) found.k8s.push(rel);
      if (depth <= 4 && ext === '.tf') found.terraform.push(rel);
      if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel)) found.workflows.push(rel);
      if (depth <= 2 && ENV_SAMPLES.test(name)) found.envSamples.push(rel);
      if (depth <= 3 && ENTRY.test(name)) found.entries.push(rel);
      if (depth <= 5 && /(^|\/)cmd\/[^/]+\/main\.go$/.test(rel)) found.entries.push(rel);
      if (depth === 0 && name === 'Procfile') found.procfile = rel;
      if (depth === 0 && !found.readme && /^readme(\.md|\.markdown|\.rst|\.txt)?$/i.test(name)) found.readme = rel;
    }
  }
  return { dirs, top, lang, found, files, truncated: entries >= MAX_ENTRIES };
}

/**
 * Folders to depth 3 with their file counts, in tree order. A folder shows at
 * most `perParent` subfolders (its biggest), so generated code with hundreds of
 * small folders does not crowd out the rest.
 */
export function treeOutline(dirs, { depth = 3, perParent = 10, maxLines = 140 } = {}) {
  const children = new Map();
  for (const [d, n] of dirs) {
    if (n === 0 || d.split('/').length > depth) continue;
    const parent = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push([d, n]);
  }
  const lines = [];
  const visit = (parent) => {
    const all = children.get(parent) ?? [];
    const kept = new Set([...all].sort((a, b) => b[1] - a[1]).slice(0, perParent).map(([d]) => d));
    for (const [d, n] of [...all].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!kept.has(d)) continue;
      if (lines.length >= maxLines) return;
      lines.push(`${'  '.repeat(d.split('/').length - 1)}${d.split('/').pop()}/ (${n})`);
      visit(d);
    }
    if (all.length > kept.size && lines.length < maxLines) lines.push(`${'  '.repeat(parent ? parent.split('/').length : 0)}… ${all.length - kept.size} more folders`);
  };
  visit('');
  return lines;
}

/** An image reference without its digest or a trailing comment. */
const imageName = (v) => String(v).replace(/\s+#.*$/, '').replace(/@sha256:[0-9a-f]{64}/gi, '').trim();

/** One manifest in a line: name, entry points, dependencies. */
export function manifestLine(rel, text) {
  const name = basename(rel);
  const deps = [];
  let head = '';
  try {
    if (name === 'package.json' || name === 'composer.json' || name === 'deno.json') {
      const j = JSON.parse(text);
      const bits = [];
      if (j.name || j.description) bits.push([j.name ? `"${j.name}"` : '', j.description ? String(j.description).slice(0, 140) : ''].filter(Boolean).join(' — '));
      if (j.main) bits.push(`main ${j.main}`);
      if (j.bin) bits.push(`bin ${typeof j.bin === 'string' ? j.bin : Object.keys(j.bin).join(', ')}`);
      if (j.workspaces) bits.push(`workspaces ${JSON.stringify(Array.isArray(j.workspaces) ? j.workspaces : j.workspaces.packages ?? j.workspaces).slice(0, 120)}`);
      if (j.scripts) bits.push(`scripts ${more(Object.keys(j.scripts), 8)}`);
      head = bits.join('; ');
      deps.push(...Object.keys(j.dependencies ?? j.require ?? j.imports ?? {}));
    } else if (name === 'pyproject.toml') {
      const project = /^\s*name\s*=\s*"([^"]+)"/m.exec(text);
      if (project) head = `"${project[1]}"`;
      const list = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
      if (list) deps.push(...[...list[1].matchAll(/"([A-Za-z0-9_.\-[\]]+)/g)].map((m) => m[1]));
      const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
      if (poetry) deps.push(...[...poetry[1].matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)].map((m) => m[1]).filter((d) => d !== 'python'));
    } else if (name === 'requirements.txt') {
      deps.push(...text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-')).map((l) => l.split(/[<>=!~;[ ]/)[0]));
    } else if (name === 'go.mod') {
      const mod = /^module\s+(\S+)/m.exec(text);
      if (mod) head = mod[1];
      const block = /require\s*\(([\s\S]*?)\)/.exec(text);
      deps.push(...(block ? block[1] : '').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((d) => d && !d.startsWith('//')));
      deps.push(...[...text.matchAll(/^require\s+(\S+)\s+v/gm)].map((m) => m[1]));
    } else if (name === 'Cargo.toml') {
      const pkg = /\[package\][\s\S]*?name\s*=\s*"([^"]+)"/.exec(text);
      if (pkg) head = `"${pkg[1]}"`;
      const block = /\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
      if (block) deps.push(...[...block[1].matchAll(/^\s*([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]));
    } else if (name === 'pom.xml') {
      const id = /<artifactId>([^<]+)<\/artifactId>/.exec(text);
      if (id) head = id[1];
      const block = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(text);
      if (block) deps.push(...[...block[1].matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]));
    } else if (name === 'build.gradle' || name === 'build.gradle.kts') {
      deps.push(...[...text.matchAll(/(?:implementation|api|compileOnly|runtimeOnly)\s*\(?\s*["']([^"':]+:[^"':]+)/g)].map((m) => m[1].split(':')[1]));
    } else if (name === 'Gemfile') {
      deps.push(...[...text.matchAll(/^\s*gem\s+["']([^"']+)/gm)].map((m) => m[1]));
    } else if (name === 'mix.exs') {
      deps.push(...[...text.matchAll(/\{:([a-z_]+),/g)].map((m) => m[1]));
    } else if (name === 'pubspec.yaml') {
      const block = /^dependencies:\n((?:\s+.*\n?)*)/m.exec(text);
      if (block) deps.push(...[...block[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]));
    } else if (/\.csproj$/i.test(name)) {
      deps.push(...[...text.matchAll(/PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]));
    } else if (name === 'setup.py') {
      const n = /name\s*=\s*["']([^"']+)/.exec(text);
      if (n) head = `"${n[1]}"`;
    }
  } catch {
    head = '(unreadable)';
  }
  const unique = [...new Set(deps.filter(Boolean))];
  return `${rel}: ${[head, unique.length ? `dependencies ${more(unique, 24)}` : ''].filter(Boolean).join('; ') || '(no dependencies listed)'}`;
}

/** Docker Compose services in lines: image or build, ports, what each depends on. */
export function composeLines(text) {
  const lines = text.split('\n');
  const out = [];
  let inServices = false;
  let unit = 0;
  let svc = null;
  let field = '';
  const flush = () => {
    if (!svc) return;
    const bits = [svc.image ? `image ${svc.image}` : svc.build ? `build ${svc.build}` : '', svc.ports.length ? `ports ${svc.ports.join(', ')}` : '', svc.deps.length ? `depends on ${svc.deps.join(', ')}` : ''].filter(Boolean);
    out.push(`${svc.name}${bits.length ? ` (${bits.join('; ')})` : ''}`);
    svc = null;
  };
  for (const raw of lines) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      flush();
      inServices = /^services:\s*$/.test(line);
      unit = 0;
      continue;
    }
    if (!inServices) continue;
    if (unit === 0) unit = indent;
    if (indent === unit) {
      flush();
      const m = /^([\w.-]+):\s*$/.exec(line);
      if (m) svc = { name: m[1], image: '', build: '', ports: [], deps: [] };
      field = '';
      continue;
    }
    if (!svc) continue;
    if (indent === unit * 2) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line);
      field = kv ? kv[1] : '';
      const value = kv ? imageName(kv[2]).replace(/^["']|["']$/g, '') : '';
      if (field === 'image' && value) svc.image = value;
      if (field === 'build' && value) svc.build = value;
      if (field === 'depends_on' && value.startsWith('[')) svc.deps.push(...value.replace(/[[\]"']/g, '').split(',').map((s) => s.trim()).filter(Boolean));
      if (field === 'ports' && value.startsWith('[')) svc.ports.push(...value.replace(/[[\]"']/g, '').split(',').map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (indent > unit * 2) {
      const item = /^-\s*["']?([^"'#]+?)["']?\s*$/.exec(line);
      const key = /^([\w.-]+):\s*$/.exec(line);
      if (field === 'depends_on') {
        if (item) svc.deps.push(item[1]);
        else if (key && indent === unit * 3) svc.deps.push(key[1]);
      } else if (field === 'ports' && item) svc.ports.push(item[1]);
      else if (field === 'build' && !svc.build) {
        const ctx = /^context:\s*(.+)$/.exec(line);
        if (ctx) svc.build = ctx[1];
      }
    }
  }
  flush();
  return out;
}

/** `FROM`, `EXPOSE` and the start command of a Dockerfile. */
function dockerfileLine(rel, text) {
  const from = [...text.matchAll(/^\s*FROM\s+(?:--\S+\s+)*(\S+)/gim)].map((m) => imageName(m[1]));
  const expose = [...text.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].map((m) => m[1].trim());
  const cmd = /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(text);
  return `${rel}: FROM ${from.join(' → ') || '?'}${expose.length ? `; EXPOSE ${expose.join(' ')}` : ''}${cmd ? `; ${cmd[1].trim().slice(0, 80)}` : ''}`;
}

/** Kubernetes objects in a YAML file: `Kind name` per document. */
function k8sObjects(text) {
  return text
    .split(/^---\s*$/m)
    .map((doc) => {
      const kind = /^kind:\s*(\S+)/m.exec(doc);
      if (!kind || !/^apiVersion:/m.test(doc)) return '';
      const name = /^metadata:\s*\n(?:\s+.*\n)*?\s+name:\s*(\S+)/m.exec(doc);
      return `${kind[1]} ${name ? name[1].replace(/["']/g, '') : '?'}`;
    })
    .filter(Boolean);
}

/** The README's opening, without badges and images. */
function readmeHead(text, maxChars = 2200) {
  const kept = [];
  let size = 0;
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = line.trimEnd();
    if (t === '' || /^\s*(\[!\[|!\[|<img|<p align|<a href|<\/?(p|div|picture|source)\b)/i.test(t)) continue;
    kept.push(t);
    size += t.length + 1;
    if (size > maxChars || kept.length >= 40) break;
  }
  return kept.join('\n');
}

/**
 * Scan a repository.
 * @param {string} dir - a folder in it (its Git root, when there is one, is scanned)
 * @param {{maxChars?: number}} [o]
 * @returns {Promise<{root: string, text: string, facts: object}>}
 */
export async function scanRepo(dir, { maxChars = 24_000 } = {}) {
  let root = (await git(dir, ['rev-parse', '--show-toplevel'])) || dir;
  try {
    if (!lstatSync(root).isDirectory()) root = dir;
  } catch {
    root = dir;
  }
  const [remote, revision, branch, dirty, tracked] = await Promise.all([
    git(root, ['config', '--get', 'remote.origin.url']),
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(root, ['status', '--porcelain']),
    git(root, ['ls-files']),
  ]);
  const tree = walkTree(root);
  const facts = {
    root,
    name: basename(root),
    remote: cleanRemote(remote),
    revision: /^[0-9a-f]{40}$/i.test(revision) ? revision : '',
    branch,
    uncommitted: dirty ? dirty.split('\n').length : 0,
    languages: [...tree.lang.entries()].sort((a, b) => b[1] - a[1]),
  };

  const sections = [];
  sections.push(`Repository ${facts.name} at ${root}`);
  if (facts.revision) sections.push(`Git: ${facts.remote || '(no origin remote)'} at ${facts.revision}${branch && branch !== 'HEAD' ? ` (${branch})` : ''}${facts.uncommitted ? `; ${facts.uncommitted} uncommitted change${facts.uncommitted > 1 ? 's' : ''}` : ''}`);
  else sections.push('Git: not a Git repository (cited sources need a repoRoot)');
  if (facts.languages.length) sections.push(`Languages (files): ${facts.languages.slice(0, 8).map(([l, n]) => `${l} ${n}`).join(', ')}`);

  // The tree: folders to depth 3 with their file counts, and the root's files.
  const treeLines = [];
  for (const line of treeOutline(tree.dirs)) treeLines.push(line);
  if (tree.top.length) treeLines.push(`root files: ${more(tree.top, 30)}`);
  sections.push(`Layout (folders to depth 3 with file counts; dependencies and build output left out${tree.truncated ? '; a very large tree, partly scanned' : ''}):\n${treeLines.map((l) => `  ${l}`).join('\n')}`);

  const read = (rel) => readSmall(join(root, rel));
  if (tree.found.manifests.length) sections.push(`Manifests:\n${tree.found.manifests.slice(0, 14).map((m) => `  ${manifestLine(m, read(m))}`).join('\n')}`);

  const infra = [];
  for (const f of tree.found.compose.slice(0, 3)) {
    const svcs = composeLines(read(f));
    if (svcs.length) infra.push(`${f} services: ${svcs.slice(0, 16).join('; ')}`);
  }
  for (const f of tree.found.dockerfiles.slice(0, 6)) infra.push(dockerfileLine(f, read(f)));
  const objects = [];
  for (const f of tree.found.k8s.slice(0, 40)) for (const o of k8sObjects(read(f))) objects.push(`${o} (${f})`);
  if (objects.length) infra.push(`Kubernetes: ${more(objects, 20)}`);
  const resources = [];
  for (const f of tree.found.terraform.slice(0, 30)) {
    for (const m of read(f).matchAll(/^\s*(resource|module|data)\s+"([^"]+)"(?:\s+"([^"]+)")?/gm)) resources.push(m[1] === 'resource' ? `${m[2]}.${m[3]}` : `${m[1]} ${m[2]}${m[3] ? `.${m[3]}` : ''}`);
  }
  if (resources.length) infra.push(`Terraform: ${more(resources, 30)}`);
  if (tree.found.procfile) infra.push(`Procfile: ${read(tree.found.procfile).split('\n').filter(Boolean).slice(0, 6).join('; ')}`);
  if (tree.found.workflows.length) infra.push(`CI workflows: ${more(tree.found.workflows.map((w) => basename(w)), 12)}`);
  if (infra.length) sections.push(`Runtime and deployment:\n${infra.map((l) => `  ${l}`).join('\n')}`);

  const keys = [];
  for (const f of tree.found.envSamples.slice(0, 3)) {
    for (const m of read(f).matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{1,63})\s*=/gm)) keys.push(m[1]);
  }
  if (keys.length) sections.push(`Configuration names (from ${tree.found.envSamples.slice(0, 3).join(', ')}; values not read): ${more([...new Set(keys)], 40)}`);
  if (tree.found.entries.length) sections.push(`Likely entry points: ${more(tree.found.entries, 16)}`);
  // The code map: Git's own file list when there is one (it skips what .gitignore leaves out).
  // Dependencies and build output committed by mistake stay out, as they do in the tree.
  const listed = (tracked ? tracked.split('\n').filter(Boolean) : tree.files).filter((f) => !f.split('/').slice(0, -1).some((d) => IGNORED.has(d)));
  const map = codeMap(root, listed, { entries: tree.found.entries });
  if (map.lines.length > 0) sections.push(`Code map, from ${map.files} source files (tests and generated code left out). An import is evidence of a dependency between the files; name:line is where a declaration starts:\n${map.lines.join('\n')}`);
  if (tree.found.readme) {
    const head = readmeHead(read(tree.found.readme));
    if (head) sections.push(`${tree.found.readme} (opening):\n${head.split('\n').map((l) => `  ${l}`).join('\n')}`);
  }

  let text = sections.join('\n\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 40)}\n… (scan cut at ${maxChars} characters)`;
  return { root, text, facts };
}

const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.swift', '.ex', '.exs', '.dart']);
const TEST = /(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures|testdata|mocks?|examples?|docs?|scripts|benchmarks?)(\/|$)|\.(test|spec)\.[a-z]+$|_test\.(go|py)$|^test_[^/]+\.py$|(^|\/)test_[^/]+\.py$|\.min\.js$|\.d\.ts$|(^|\/)(vendor|third_party|generated|gen|dist|build)(\/|$)/i;
const MAX_SOURCE = 400 * 1024;

/** Top-level declarations of one file: `name:line`, in file order. */
export function declarations(text, ext) {
  const out = [];
  const lines = text.split('\n');
  const push = (name, i) => {
    if (name && !out.some((d) => d.name === name)) out.push({ name, line: i + 1 });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    let m;
    if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts'].includes(ext)) {
      if ((m = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(l))) push(m[1], i);
      else if ((m = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(l))) push(m[1], i);
      // Up to six spaces in: a module wrapped in a factory or an IIFE indents its top level.
      else if ((m = /^\s{0,6}(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/.exec(l))) push(m[1], i);
      else if ((m = /^\s{0,6}class\s+([A-Za-z_$][\w$]*)/.exec(l))) push(m[1], i);
      else if ((m = /^\s{0,4}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.exec(l)) && /^[A-Z]|^use[A-Z]|^create|^build|^handle|^render|^apply|^run/.test(m[1])) push(m[1], i);
    } else if (ext === '.py') {
      if ((m = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(l)) || (m = /^class\s+([A-Za-z_]\w*)/.exec(l))) push(m[1], i);
    } else if (ext === '.go') {
      if ((m = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(l)) || (m = /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/.exec(l))) push(m[1], i);
    } else if (ext === '.rs') {
      if ((m = /^pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|trait|mod)\s+([A-Za-z_]\w*)/.exec(l))) push(m[1], i);
    } else if (['.java', '.kt', '.cs', '.swift', '.dart'].includes(ext)) {
      if ((m = /^\s{0,4}(?:public\s+|internal\s+|open\s+|abstract\s+|final\s+|sealed\s+|data\s+|static\s+|partial\s+)*(?:class|interface|enum|record|struct|object|protocol)\s+([A-Za-z_]\w*)/.exec(l))) push(m[1], i);
    } else if (ext === '.rb') {
      if ((m = /^\s{0,2}(?:class|module)\s+([A-Z][\w:]*)/.exec(l)) || (m = /^\s{0,4}def\s+([a-z_]\w*[?!]?)/.exec(l))) push(m[1], i);
    } else if (ext === '.php') {
      if ((m = /^\s{0,4}(?:final\s+|abstract\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/.exec(l)) || (m = /^\s{0,4}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)/.exec(l))) push(m[1], i);
    } else if (ext === '.ex' || ext === '.exs') {
      if ((m = /^\s{0,2}defmodule\s+([A-Z][\w.]*)/.exec(l)) || (m = /^\s{2,4}def\s+([a-z_]\w*[?!]?)/.exec(l))) push(m[1], i);
    }
  }
  return out;
}

/** Import specifiers of one file that may point inside the repository. */
export function importsOf(text, ext) {
  const out = [];
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.vue', '.svelte'].includes(ext)) {
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  } else if (ext === '.py') {
    for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import|^\s*import\s+([\w.]+)/gm)) out.push(m[1] ?? m[2]);
  } else if (ext === '.go') {
    const block = /import\s*\(([\s\S]*?)\)/.exec(text);
    for (const m of (block ? block[1] : '').matchAll(/"([^"]+)"/g)) out.push(m[1]);
    for (const m of text.matchAll(/^import\s+(?:\w+\s+)?"([^"]+)"/gm)) out.push(m[1]);
  } else if (ext === '.rs') {
    for (const m of text.matchAll(/^\s*(?:pub\s+)?mod\s+([a-z_]\w*)\s*;|^\s*use\s+crate::([a-z_][\w:]*)/gm)) out.push(m[1] ? `mod:${m[1]}` : `crate::${m[2]}`);
  }
  return out.filter(Boolean);
}

/** Python files by every path suffix that names only one of them: `pkg/mod.py` → `src/pkg/mod.py`. */
const suffixCache = new WeakMap();
function pySuffix(files) {
  if (suffixCache.has(files)) return suffixCache.get(files);
  const map = new Map();
  const dup = new Set();
  for (const f of files) {
    if (!f.endsWith('.py')) continue;
    const parts = f.split('/');
    for (let k = 1; k <= parts.length; k += 1) {
      const key = parts.slice(-k).join('/');
      if (map.has(key) && map.get(key) !== f) dup.add(key);
      else map.set(key, f);
    }
  }
  for (const k of dup) map.delete(k);
  suffixCache.set(files, map);
  return map;
}

/** The repository file an import names, or '' (a package, or not found). */
function resolveImport(spec, fromRel, ext, files, goModule) {
  const has = (p) => files.has(p);
  const fromDir = pp.dirname(fromRel);
  if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.vue', '.svelte'].includes(ext)) {
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@/') && !spec.startsWith('~/')) return '';
    // `@/` and `~/` name the importing project's own `src/` (the nearest one above the file).
    const parts = fromRel.split('/');
    const src = parts.lastIndexOf('src');
    const srcRoot = src >= 0 ? parts.slice(0, src + 1).join('/') : 'src';
    const base = spec.startsWith('@/') || spec.startsWith('~/') ? pp.join(srcRoot, spec.slice(2)) : pp.normalize(pp.join(fromDir, spec));
    const stem = base.replace(/\.(js|mjs|cjs|jsx)$/, '');
    for (const c of [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.mts', '.vue', '.svelte'].map((e) => stem + e), ...['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map((i) => pp.join(base, i))]) if (has(c)) return c;
    return '';
  }
  if (ext === '.py') {
    let mod = spec;
    let dir = '';
    if (mod.startsWith('.')) {
      const dots = /^\.+/.exec(mod)[0].length;
      dir = fromDir;
      for (let i = 1; i < dots; i += 1) dir = pp.dirname(dir);
      mod = mod.slice(dots);
    }
    const path = pp.join(dir, mod.replace(/\./g, '/'));
    for (const c of [`${path}.py`, pp.join(path, '__init__.py')]) if (has(c)) return c;
    // An absolute import of a package of this repository, wherever its source root is.
    const tail = mod.replace(/\./g, '/');
    return pySuffix(files).get(`${tail}.py`) ?? pySuffix(files).get(`${tail}/__init__.py`) ?? '';
  }
  if (ext === '.go') {
    if (!goModule || !spec.startsWith(`${goModule.module}/`)) return '';
    const dir = pp.join(goModule.dir, spec.slice(goModule.module.length + 1));
    return [...files].some((f) => pp.dirname(f) === dir) ? `${dir}/` : '';
  }
  if (ext === '.rs') {
    if (spec.startsWith('mod:')) {
      const name = spec.slice(4);
      for (const c of [pp.join(fromDir, `${name}.rs`), pp.join(fromDir, name, 'mod.rs')]) if (has(c)) return c;
    }
    return '';
  }
  return '';
}

/** The `n` declarations with the longest bodies (up to the next one), in file order. */
function largest(decls, total, n) {
  const spans = decls.map((d, i) => ({ ...d, span: (decls[i + 1]?.line ?? total + 1) - d.line }));
  return spans
    .sort((a, b) => b.span - a.span)
    .slice(0, n)
    .sort((a, b) => a.line - b.line);
}

/** A file's folder at a depth: the unit of the module graph. */
const folderOf = (f, depth) => {
  const parts = f.split('/').slice(0, -1);
  return parts.length === 0 ? '.' : parts.slice(0, depth).join('/');
};

/**
 * The code map of `files` (repository-relative paths) under `root`: the
 * module graph between folders, then the key files with what they import and
 * their largest top-level declarations.
 * @param {{entries?: string[], maxFiles?: number, maxChars?: number}} o
 */
export function codeMap(root, files, { entries = [], maxFiles = 40, maxChars = 8000 } = {}) {
  const all = new Set(files);
  let goModule = null;
  const mod = files.find((f) => pp.basename(f) === 'go.mod');
  if (mod) {
    try {
      const m = /^module\s+(\S+)/m.exec(readFileSync(join(root, mod), 'utf8'));
      if (m) goModule = { module: m[1], dir: pp.dirname(mod) === '.' ? '' : pp.dirname(mod) };
    } catch {
      goModule = null;
    }
  }
  const sources = files.filter((f) => CODE.has(extname(f).toLowerCase()) && !TEST.test(f));
  const info = new Map();
  for (const f of sources) {
    let text = '';
    try {
      if (statSync(join(root, f)).size > MAX_SOURCE) continue;
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    // Generated code says so near its top; it is not what a diagram is about.
    if (/(Code generated|DO NOT EDIT|@generated|auto-generated|autogenerated)/i.test(text.slice(0, 600))) continue;
    const ext = extname(f).toLowerCase();
    const deps = [...new Set(importsOf(text, ext).map((s) => resolveImport(s, f, ext, all, goModule)).filter((d) => d && d !== f))];
    info.set(f, { lines: text.split('\n').length, deps, decls: declarations(text, ext), importedBy: 0 });
  }
  for (const [, v] of info) for (const d of v.deps) if (info.has(d)) info.get(d).importedBy += 1;
  if (info.size === 0) return { lines: [], files: 0 };

  // The module graph, by folder: a folder holding too many of the files is split into its
  // subfolders (down to depth 4) while there are fewer than 40 folders.
  const dirOf = (f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.');
  let units = new Set(['']);
  const unitOf = (f) => {
    const d = dirOf(f);
    let best = '';
    for (const u of units) if (u !== '' && (d === u || d.startsWith(`${u}/`)) && u.length > best.length) best = u;
    return best || (d === '.' ? '.' : d.split('/')[0]);
  };
  units = new Set([...info.keys()].map((f) => (dirOf(f) === '.' ? '.' : dirOf(f).split('/')[0])));
  for (let pass = 0; pass < 3; pass += 1) {
    const count = new Map();
    for (const f of info.keys()) count.set(unitOf(f), (count.get(unitOf(f)) ?? 0) + 1);
    const big = [...count.entries()].filter(([u, n]) => u !== '.' && n > Math.max(40, info.size * 0.25) && u.split('/').length < 4).sort((x, y) => y[1] - x[1]);
    let changed = false;
    for (const [u] of big) {
      const subs = new Set([...info.keys()].filter((f) => unitOf(f) === u && dirOf(f) !== u).map((f) => `${u}/${dirOf(f).slice(u.length + 1).split('/')[0]}`));
      if (subs.size === 0 || units.size - 1 + subs.size > 40) continue;
      units.delete(u);
      for (const x of subs) units.add(x);
      if ([...info.keys()].some((f) => dirOf(f) === u)) units.add(u);
      changed = true;
    }
    if (!changed) break;
  }
  const edges = new Map();
  for (const [f, v] of info) {
    const from = unitOf(f);
    for (const d of v.deps) {
      const to = d.endsWith('/') ? unitOf(`${d}x`) : unitOf(d);
      if (to === from) continue;
      const row = edges.get(from) ?? new Map();
      row.set(to, (row.get(to) ?? 0) + 1);
      edges.set(from, row);
    }
  }
  const out = [];
  let size = 0;
  const add = (line, budget) => {
    if (size + line.length > budget) return false;
    out.push(line);
    size += line.length + 1;
    return true;
  };
  const sizes = new Map();
  for (const f of info.keys()) sizes.set(unitOf(f), (sizes.get(unitOf(f)) ?? 0) + 1);
  if (edges.size > 0) {
    out.push('Module graph (folders → the folders they import from, with the number of imports; a target drops the leading folders it shares with its source):');
    const short = (from, to) => {
      const a = from.split('/');
      const b = to.split('/');
      let k = 0;
      while (k < a.length - 1 && k < b.length - 1 && a[k] === b[k]) k += 1;
      return b.slice(k).join('/');
    };
    for (const [from, row] of [...edges.entries()].sort((a, b) => (sizes.get(b[0]) ?? 0) - (sizes.get(a[0]) ?? 0))) {
      const targets = [...row.entries()].sort((a, b) => b[1] - a[1]).map(([to, n]) => `${short(from, to)} ${n}`);
      if (!add(`  ${from}/ [${sizes.get(from) ?? 0}] → ${targets.slice(0, 7).join(', ')}${targets.length > 7 ? ', …' : ''}`, maxChars * 0.45)) {
        out.push('  …');
        break;
      }
    }
  }

  // Key files: entry points, then the most imported and the biggest, taken from each top-level folder in turn.
  const rank = (f) => (entries.includes(f) ? 1e9 : 0) + info.get(f).importedBy * 1e5 + info.get(f).lines;
  const byTop = new Map();
  for (const f of [...info.keys()].sort((a, b) => rank(b) - rank(a))) {
    const top = f.includes('/') ? f.split('/')[0] : '.';
    if (!byTop.has(top)) byTop.set(top, []);
    byTop.get(top).push(f);
  }
  const chosen = [];
  for (let round = 0; chosen.length < maxFiles && [...byTop.values()].some((l) => l.length > round); round += 1) {
    for (const l of byTop.values()) if (l[round] && chosen.length < maxFiles) chosen.push(l[round]);
  }
  out.push(`Key files (lines; → the repository files they import; their largest top-level declarations as name:line):`);
  let shown = 0;
  for (const f of chosen.sort()) {
    const v = info.get(f);
    const decls = largest(v.decls, v.lines, 10).map((d) => `${d.name}:${d.line}`).join(' ');
    const line = `  ${f} (${v.lines})${v.deps.length ? ` → ${v.deps.slice(0, 8).join(', ')}${v.deps.length > 8 ? ` (+${v.deps.length - 8})` : ''}` : ''}${decls ? ` | ${decls}` : ''}`;
    if (!add(line, maxChars)) {
      out.push(`  … ${chosen.length - shown} more key files`);
      break;
    }
    shown += 1;
  }
  return { lines: out, files: info.size };
}
