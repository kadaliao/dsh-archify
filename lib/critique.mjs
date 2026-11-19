/**
 * An architecture review the model writes after reading the code, checked
 * before it is kept: every point rests on evidence the plugin can verify.
 *
 * - basis `code`: each finding cites repository files with line ranges; the
 *   plugin checks each file is in the repository and the lines exist, and keeps
 *   those lines so the reader sees the code the point rests on.
 * - basis `description`: the diagram was drawn from a description, with no code
 *   behind it; each finding cites the diagram's own components.
 * A finding without evidence is refused, so the model either backs it up or
 * leaves it out.
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';

export const LEVELS = ['risk', 'warn', 'info', 'good'];
export const MAX_FINDINGS = 12;
const MAX_EVIDENCE = 4;
/** Lines of code kept per citation, to show beside the point. */
const EXCERPT = 12;
const MAX_FILE = 8 * 1024 * 1024;

const text = (v, n) => String(v ?? '').trim().slice(0, n);

/**
 * The cited lines of a repository file, or why they cannot be cited.
 * @returns {{path: string, line: number, end_line: number, excerpt: string, more: boolean} | {error: string}}
 */
export function excerptOf(root, e) {
  const raw = String(e?.path ?? '').trim().replace(/\\/g, '/');
  if (!raw) return { error: 'path is required (relative to the repository root)' };
  if (isAbsolute(raw) || raw.split('/').includes('..')) return { error: `path "${raw}" must be relative to the repository root and stay inside it` };
  const rel = normalize(raw).split(sep).join('/').replace(/^\.\//, '');
  if (rel === '.git' || rel.startsWith('.git/')) return { error: `"${rel}" is Git's own data, not code` };
  let content;
  try {
    const st = statSync(join(root, rel));
    if (!st.isFile()) return { error: `"${rel}" is not a file` };
    if (st.size > MAX_FILE) return { error: `"${rel}" is too large to cite` };
    content = readFileSync(join(root, rel), 'utf8');
  } catch {
    return { error: `"${rel}" is not in the repository` };
  }
  const lines = content.split('\n');
  const total = lines.length - (content.endsWith('\n') ? 1 : 0);
  const line = Number(e.line);
  if (!Number.isInteger(line) || line < 1) return { error: `"${rel}": line is required, the first line of the code the point rests on` };
  const end = e.end_line === undefined || e.end_line === null || e.end_line === '' ? line : Number(e.end_line);
  if (!Number.isInteger(end) || end < line) return { error: `"${rel}": end_line must be a line number not before line` };
  if (end > total) return { error: `"${rel}" has ${total} lines, so lines ${line}–${end} do not exist; cite lines that hold the code` };
  const shown = lines.slice(line - 1, Math.min(end, line + EXCERPT - 1)).map((l) => l.replace(/\r$/, '').slice(0, 220));
  return { path: rel, line, end_line: end, excerpt: shown.join('\n'), more: end - line + 1 > shown.length };
}

/**
 * Check a submitted review.
 * @param {object} input - basis, software, verdict, findings[{level, title, detail, suggestion, evidence[]}]
 * @param {{repoRoot?: string, componentIds?: string[]}} o
 * @returns {{ok: true, review: object} | {ok: false, errors: string[]}}
 */
export function checkReview(input, { repoRoot = '', componentIds = [] } = {}) {
  const errors = [];
  const basis = input?.basis === 'description' ? 'description' : 'code';
  if (basis === 'code' && !repoRoot) errors.push('basis is "code" but this diagram has no Git checkout behind it to check citations against; review the described design with basis "description"');
  const verdict = text(input?.verdict, 700);
  if (!verdict) errors.push('verdict is required: one or two sentences on the architecture as a whole');
  const software = text(input?.software, 200);
  if (!software) errors.push('software is required: what kind of software this is and how it runs, as read from the code (e.g. "macOS menu-bar app, Swift with AppKit and SwiftUI")');
  const list = Array.isArray(input?.findings) ? input.findings : [];
  if (list.length === 0) errors.push('findings must hold at least one point');
  if (list.length > MAX_FINDINGS) errors.push(`at most ${MAX_FINDINGS} findings: keep the ones that matter`);
  const findings = [];
  list.slice(0, MAX_FINDINGS).forEach((f, i) => {
    const at = `findings[${i}]`;
    const level = LEVELS.includes(f?.level) ? f.level : null;
    if (!level) errors.push(`${at}.level must be one of ${LEVELS.join(', ')}`);
    const title = text(f?.title, 160);
    if (!title) errors.push(`${at}.title is required`);
    const detail = text(f?.detail, 1500);
    if (!detail) errors.push(`${at}.detail is required: what the code does and why it matters`);
    const suggestion = text(f?.suggestion, 1000);
    if (level && level !== 'good' && !suggestion) errors.push(`${at}.suggestion is required for a problem: a change that can be made`);
    const cited = Array.isArray(f?.evidence) ? f.evidence.slice(0, MAX_EVIDENCE) : [];
    const evidence = [];
    cited.forEach((e, j) => {
      const where = `${at}.evidence[${j}]`;
      if (e && typeof e === 'object' && e.component !== undefined) {
        const id = String(e.component);
        if (!componentIds.includes(id)) errors.push(`${where}: "${id}" is not a component of the diagram`);
        else evidence.push({ component: id, note: text(e.note, 240) });
        return;
      }
      if (basis !== 'code') {
        errors.push(`${where}: a review of a described design cites the diagram's components, as {"component": "<id>"}`);
        return;
      }
      const r = excerptOf(repoRoot, e);
      if ('error' in r) errors.push(`${where}: ${r.error}`);
      else evidence.push({ ...r, note: text(e.note, 240) });
    });
    if (basis === 'code' && !evidence.some((x) => x.path)) errors.push(`${at} ("${title || '?'}") cites no code: give the file and lines it rests on, or leave the point out`);
    if (basis === 'description' && evidence.length === 0) errors.push(`${at} ("${title || '?'}") cites no component of the diagram`);
    findings.push({ level, title, detail, suggestion, evidence });
  });
  if (errors.length > 0) return { ok: false, errors };
  const order = { risk: 0, warn: 1, info: 2, good: 3 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { ok: true, review: { basis, software, verdict, findings } };
}
