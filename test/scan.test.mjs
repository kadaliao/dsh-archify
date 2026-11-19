import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanRemote, composeLines, manifestLine, scanRepo, treeOutline } from '../lib/scan.mjs';

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'archify-scan-'));
  const put = (rel, text) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put('package.json', JSON.stringify({ name: 'shop', description: 'An online shop', workspaces: ['services/*'], scripts: { dev: 'x', test: 'y' } }));
  put('services/orders/package.json', JSON.stringify({ name: '@shop/orders', main: 'src/index.js', dependencies: { express: '^5', pg: '^8', kafkajs: '^2' } }));
  put('services/orders/src/index.js', 'export {}\n');
  put('services/payments/go.mod', 'module example.com/payments\n\nrequire (\n\tgithub.com/stripe/stripe-go v76.0.0\n\tgithub.com/redis/go-redis/v9 v9.0.0\n)\n');
  put('services/payments/cmd/server/main.go', 'package main\n');
  put('web/src/main.tsx', 'export {}\n');
  put('docker-compose.yml', 'services:\n  orders:\n    build: ./services/orders\n    ports:\n      - "3000:3000"\n    depends_on:\n      - db\n      - kafka\n  db:\n    image: postgres:16@sha256:' + 'a'.repeat(64) + '  # pinned\n  kafka:\n    image: bitnami/kafka:3\n');
  put('Dockerfile', 'FROM --platform=$BUILDPLATFORM node:22 AS build\nFROM node:22-slim\nEXPOSE 3000\nCMD ["node", "server.js"]\n');
  put('deploy/k8s/orders.yaml', 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: orders\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: orders\n');
  put('infra/main.tf', 'resource "aws_db_instance" "main" {}\nmodule "vpc" {}\n');
  put('.github/workflows/test.yml', 'name: test\n');
  put('.env.example', 'DATABASE_URL=postgres://user:hunter2@db/shop\nSTRIPE_SECRET_KEY=sk_test_shouldnotappear\n');
  put('.env', 'REAL_SECRET=topsecretvalue\n');
  put('node_modules/left-pad/index.js', 'x');
  put('README.md', '# Shop\n\n[![build](https://x/badge.svg)](https://x)\n\nAn online shop with orders and payments.\n\n```\nnpm run dev\n```\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://ghp_token123@github.com/acme/shop.git'], { cwd: root });
  return root;
}

test('a scan names the structure, manifests, deployment and Git facts, and no secret', async () => {
  const root = repo();
  const { text, facts } = await scanRepo(join(root, 'services'));
  assert.equal(facts.root.endsWith(root.split('/').pop()), true);
  assert.match(facts.revision, /^[0-9a-f]{40}$/);
  assert.equal(facts.remote, 'https://github.com/acme/shop.git');
  assert.match(text, /Git: https:\/\/github\.com\/acme\/shop\.git at [0-9a-f]{40} \(main\)/);
  assert.match(text, /services\/ \(\d+\)/);
  assert.match(text, /package\.json: "shop" — An online shop; workspaces/);
  assert.match(text, /services\/orders\/package\.json: "@shop\/orders"; main src\/index\.js; dependencies express, pg, kafkajs/);
  assert.match(text, /go\.mod: example\.com\/payments; dependencies github\.com\/stripe\/stripe-go/);
  assert.match(text, /docker-compose\.yml services: orders \(build \.\/services\/orders; ports 3000:3000; depends on db, kafka\); db \(image postgres:16\); kafka/);
  assert.match(text, /Dockerfile: FROM node:22 → node:22-slim; EXPOSE 3000/);
  assert.match(text, /Kubernetes: Deployment orders/);
  assert.match(text, /Terraform: aws_db_instance\.main, module vpc/);
  assert.match(text, /CI workflows: test\.yml/);
  assert.match(text, /Configuration names .*DATABASE_URL, STRIPE_SECRET_KEY/);
  assert.match(text, /Likely entry points: .*services\/payments\/cmd\/server\/main\.go/);
  assert.match(text, /An online shop with orders and payments/);
  assert.doesNotMatch(text, /```/);
  // The code map: what each file imports, and where its declarations start.
  assert.match(text, /Code map, from \d+ source files/);
  assert.match(text, /services\/payments\/cmd\/server\/main\.go \(2\)/);
  for (const secret of ['hunter2', 'sk_test_shouldnotappear', 'topsecretvalue', 'ghp_token123', 'REAL_SECRET', 'left-pad', 'badge.svg', 'npm run dev']) assert.doesNotMatch(text, new RegExp(secret), secret);
});

test('scan helpers: remotes, compose, manifests, the folder outline', () => {
  assert.equal(cleanRemote('https://user:pass@gitlab.com/a/b.git'), 'https://gitlab.com/a/b.git');
  assert.equal(cleanRemote('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.equal(cleanRemote(''), '');
  assert.deepEqual(composeLines('services:\n  api:\n    image: x\n    depends_on:\n      db:\n        condition: service_healthy\n  db:\n    image: y\n'), ['api (image x; depends on db)', 'db (image y)']);
  assert.match(manifestLine('requirements.txt', 'flask==3\n# c\nredis>=5\n'), /dependencies flask, redis/);
  assert.match(manifestLine('Cargo.toml', '[package]\nname = "x"\n[dependencies]\nserde = "1"\ntokio = { version = "1" }\n'), /"x"; dependencies serde, tokio/);
  const dirs = new Map([['a', 30], ['a/b', 10], ...Array.from({ length: 15 }, (_, i) => [`a/g${String(i).padStart(2, '0')}`, 1]), ['z', 0]]);
  const lines = treeOutline(dirs, { perParent: 4 });
  assert.equal(lines[0], 'a/ (30)');
  assert.ok(lines.includes('  b/ (10)'));
  assert.ok(lines.some((l) => /… 12 more folders/.test(l)), lines.join('\n'));
  assert.ok(!lines.some((l) => l.startsWith('z/')));
});

test('a folder outside Git is scanned as it is', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'archify-scan-plain-'));
  writeFileSync(join(dir, 'app.py'), 'print(1)\n');
  const { text, facts } = await scanRepo(dir);
  assert.equal(facts.revision, '');
  assert.match(text, /not a Git repository/);
  assert.match(text, /Languages \(files\): Python 1/);
});

test('the code map folds imports into a module graph and finds the declarations worth citing', async () => {
  const { codeMap, declarations, importsOf } = await import('../lib/scan.mjs');
  assert.deepEqual(declarations('export async function start() {}\nfunction helper() {}\n    function Panel(props) {\nclass Store {}\n', '.js').map((d) => `${d.name}:${d.line}`), ['start:1', 'helper:2', 'Panel:3', 'Store:4']);
  assert.deepEqual(declarations('def run():\n    pass\nclass Job:\n    def inner(self): pass\n', '.py').map((d) => d.name), ['run', 'Job']);
  assert.deepEqual(declarations('func (s *Server) Start() {}\ntype Config struct {}\n', '.go').map((d) => d.name), ['Start', 'Config']);
  assert.deepEqual(importsOf("import x from './a.js';\nconst y = require('../b');\nimport('./c');\nimport 'react';", '.js'), ['./a.js', '../b', './c', 'react']);
  const root = mkdtempSync(join(tmpdir(), 'archify-map-'));
  const put = (rel, text) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  put('web/src/main.ts', "import { api } from '@/api/client';\nexport function boot() {}\n");
  put('web/src/api/client.ts', "export const api = 1;\n");
  put('server/app/routes.py', 'from app.services import billing\ndef register():\n    pass\n');
  put('server/app/services/billing.py', 'class Billing:\n    pass\n');
  put('server/app/services/__init__.py', '');
  put('gen/models.go', '// Code generated by ent, DO NOT EDIT.\npackage gen\n');
  put('cli/main.py', 'from app.services.billing import Billing\ndef main():\n    pass\n');
  const files = ['web/src/main.ts', 'web/src/api/client.ts', 'server/app/routes.py', 'server/app/services/billing.py', 'server/app/services/__init__.py', 'gen/models.go', 'cli/main.py'];
  const { lines } = codeMap(root, files, { entries: ['web/src/main.ts'] });
  const out = lines.join('\n');
  assert.match(out, /web\/src\/main\.ts \(3\) → web\/src\/api\/client\.ts \| boot:2/);
  assert.match(out, /server\/app\/routes\.py \(4\) → server\/app\/services\/__init__\.py \| register:2/);
  assert.match(out, /Module graph[^\n]*\n {2}cli\/ \[1\] → server 1/);
  assert.doesNotMatch(out, /gen\/models\.go/, 'generated code is left out');
});
