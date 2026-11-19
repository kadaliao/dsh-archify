/**
 * Diagrams started from the panel: each runs in a conversation of its own, and
 * the panel follows it here — working, rendering, delivered or ended — until
 * its page is in the gallery. Kept as a small JSON file beside the gallery, so
 * a restart still shows what was started.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { newId } from './store.mjs';

export const MAX_JOBS = 40;
/** A job that never hears back is shown as ended after this long. */
export const STALE_MS = 30 * 60_000;

/** What a tool call says the conversation is doing now. */
export function activityOf(toolName) {
  const name = String(toolName ?? '');
  if (name === 'archify_render') return 'rendering';
  if (name === 'archify_scan') return 'scanning';
  if (name === 'skill' || name === 'load_skill' || /skill/i.test(name)) return 'loading';
  if (/edit|write|patch/i.test(name)) return 'editing';
  return 'reading';
}

/** @param {string} dir - the plugin's cache directory. */
export function createJobs(dir, { now = () => Date.now() } = {}) {
  const file = join(dir, 'jobs.json');
  let jobs = [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed?.jobs)) jobs = parsed.jobs.filter((j) => j && typeof j.id === 'string');
  } catch {
    jobs = [];
  }
  let timer = null;
  const write = () => {
    timer = null;
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, jobs }), 'utf8');
      renameSync(tmp, file);
    } catch {
      // Following a job is a convenience.
    }
  };
  const save = () => {
    if (timer === null) timer = setTimeout(write, 200);
  };
  const find = (id) => jobs.find((j) => j.id === id);
  const live = (j) => j.state === 'starting' || j.state === 'running';
  return {
    create(fields) {
      const job = { id: newId(), state: 'starting', steps: 0, activity: 'starting', pages: [], startedAt: now(), ...fields };
      jobs.unshift(job);
      if (jobs.length > MAX_JOBS) jobs.length = MAX_JOBS;
      save();
      return job;
    },
    get: find,
    update(id, patch) {
      const job = find(id);
      if (!job) return undefined;
      Object.assign(job, patch);
      save();
      return job;
    },
    /** The live job a conversation runs, if any. */
    bySession(sessionId) {
      return sessionId ? jobs.find((j) => j.sessionId === sessionId && live(j)) : undefined;
    },
    /** A tool call in a job's conversation. */
    noteCall(sessionId, toolName) {
      const job = this.bySession(sessionId);
      if (!job) return undefined;
      job.state = 'running';
      job.steps += 1;
      job.activity = activityOf(toolName);
      job.seenAt = now();
      save();
      return job;
    },
    /** The conversation delivered a page: the job's first page is its answer. */
    delivered(sessionId, pageId) {
      const job = this.bySession(sessionId);
      if (!job) return undefined;
      if (!job.pages.includes(pageId)) job.pages.push(pageId);
      job.activity = 'delivered';
      job.seenAt = now();
      save();
      return job;
    },
    /** The conversation went idle: done with a page, else ended without one (a question, an error). */
    idle(sessionId) {
      const job = this.bySession(sessionId);
      if (!job) return undefined;
      // A review's answer is the reply itself (its saved review); an edit's or a diagram's is its page.
      job.state = job.kind === 'review' || job.pages.length > 0 ? 'done' : 'ended';
      job.endedAt = now();
      save();
      return job;
    },
    remove(id) {
      const at = jobs.findIndex((j) => j.id === id);
      if (at < 0) return false;
      jobs.splice(at, 1);
      save();
      return true;
    },
    list(limit = 12) {
      const t = now();
      for (const j of jobs) {
        if (live(j) && t - (j.seenAt ?? j.startedAt) > STALE_MS) {
          j.state = j.pages.length > 0 ? 'done' : 'ended';
          j.endedAt = t;
          save();
        }
      }
      return jobs.slice(0, limit);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        write();
      }
    },
  };
}
