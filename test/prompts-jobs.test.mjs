import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJobs, STALE_MS, activityOf } from '../lib/jobs.mjs';
import { PICKABLE, generationPrompt, reviewPrompt, typeName } from '../lib/prompts.mjs';

test('a new-diagram prompt names the skill, the type, the folder and the focus, in the reader\'s language', () => {
  const zh = generationPrompt({ lang: 'zh', type: 'sequence', focus: '用户登录', dir: '/code/shop', digest: 'Repository shop …' });
  assert.match(zh, /^用 archify 技能为 shop 这个代码仓库画一张时序图，重点：用户登录。/);
  assert.match(zh, /仓库位置：\/code\/shop/);
  assert.match(zh, /图里的文字用中文/);
  assert.match(zh, /插件刚扫描到的仓库概况[\s\S]*Repository shop/);
  const en = generationPrompt({ lang: 'en', type: 'architecture', dir: '/code/shop' });
  assert.match(en, /^Use the archify skill to draw an architecture diagram of the shop codebase, showing its overall structure\./);
  assert.match(en, /Start with archify_scan/);
  const auto = generationPrompt({ lang: 'en', type: 'auto', focus: 'how a refund works', quality: 'standard' });
  assert.match(auto, /draw the diagram that fits best \(choose the type\): how a refund works/);
  assert.match(auto, /standard quality profile/);
  assert.doesNotMatch(auto, /Repository:/);
  assert.match(generationPrompt({ lang: 'en', type: 'explainer', focus: 'why TLS is slow' }), /one-page explainer/);
  assert.equal(typeName('erd', 'zh'), 'ER 图');
  assert.ok(PICKABLE.includes('auto') && PICKABLE.includes('explainer'));
});

test('a review prompt carries the candidate, the findings and the shape of the answer', () => {
  const zh = reviewPrompt({ lang: 'zh', title: '下单系统', candidate: '/w/.archify/a/candidate.json', findings: ['- [risk] x'], repo: '/w' });
  assert.match(zh, /点评架构图「下单系统」描述的这个系统架构本身/);
  assert.match(zh, /\/w\/\.archify\/a\/candidate\.json/);
  assert.match(zh, /- \[risk\] x/);
  assert.match(zh, /1\. 这是什么软件，一句话总评/);
  assert.match(zh, /先用一句话说清这是什么类型的软件/);
  const app = reviewPrompt({ lang: 'zh', title: '岛民', candidate: '/c.json', kind: 'app' });
  assert.match(app, /运行在一台机器上的应用/);
  assert.match(app, /横向扩展、消息队列、网关、集群、服务监控这些服务端的事在这里不适用/);
  assert.match(app, /2\. 主要风险，按严重程度排（耦合、状态管理、系统与其他应用的依赖、权限、错误处理、性能）/);
  assert.match(reviewPrompt({ lang: 'en', candidate: '/c.json', kind: 'app' }), /scaling out, message queues, gateways, clusters and service monitoring do not apply here/);
  const en = reviewPrompt({ lang: 'en', candidate: '/c.json' });
  assert.match(en, /Review the system architecture/);
  assert.doesNotMatch(en, /structural checks/);
});

test('a job follows its conversation from start to its page, and a review ends done', () => {
  let t = 1000;
  const jobs = createJobs(mkdtempSync(join(tmpdir(), 'archify-jobs-')), { now: () => t });
  const job = jobs.create({ kind: 'diagram', type: 'architecture', dir: '/code' });
  assert.equal(job.state, 'starting');
  jobs.update(job.id, { sessionId: 's1', state: 'running' });
  assert.equal(jobs.bySession('s1').id, job.id);
  t = 2000;
  jobs.noteCall('s1', 'read_file');
  jobs.noteCall('s1', 'archify_render');
  assert.equal(jobs.get(job.id).steps, 2);
  assert.equal(jobs.get(job.id).activity, 'rendering');
  jobs.delivered('s1', 'page1');
  jobs.delivered('s1', 'page1');
  assert.deepEqual(jobs.get(job.id).pages, ['page1']);
  jobs.idle('s1');
  assert.equal(jobs.get(job.id).state, 'done');
  assert.equal(jobs.get(job.id).endedAt, 2000);
  // Ended: no longer followed.
  assert.equal(jobs.bySession('s1'), undefined);
  assert.equal(jobs.noteCall('s1', 'x'), undefined);

  const review = jobs.create({ kind: 'review', sessionId: 's2', state: 'running' });
  jobs.idle('s2');
  assert.equal(jobs.get(review.id).state, 'done');
  const silent = jobs.create({ kind: 'diagram', sessionId: 's3', state: 'running' });
  jobs.idle('s3');
  assert.equal(jobs.get(silent.id).state, 'ended');

  const stale = jobs.create({ kind: 'diagram', sessionId: 's4', state: 'running' });
  t += STALE_MS + 1;
  jobs.list();
  assert.equal(jobs.get(stale.id).state, 'ended');
  assert.equal(jobs.remove(stale.id), true);
  assert.equal(jobs.get(stale.id), undefined);
  assert.equal(activityOf('archify_scan'), 'scanning');
  assert.equal(activityOf('edit_file'), 'editing');
});
