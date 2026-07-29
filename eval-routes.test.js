// Run: node --test eval-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { registerEvalRoutes } from './eval-routes.js';

function makeApp() {
  const evalsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canopy-evals-'));
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerEvalRoutes(app, { evalsDir });
  return { app, evalsDir };
}

function listenOnce(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

const VALID_REPORT = {
  suite: 'powerup_script',
  engine: 'script',
  runAt: new Date().toISOString(),
  gitSha: 'abc1234',
  total: 2,
  passed: 1,
  failed: 1,
  results: [
    { caseId: 'a', passed: true, failures: [] },
    { caseId: 'b', passed: false, failures: ['ask order mismatch'] },
  ],
};

test('publish → list lifecycle', async () => {
  const { app } = makeApp();
  const { server, port } = await listenOnce(app);
  try {
    const post = await fetch(`http://127.0.0.1:${port}/api/evals/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(VALID_REPORT),
    });
    assert.equal(post.status, 200);
    const { ok, id } = await post.json();
    assert.equal(ok, true);
    assert.ok(id.startsWith('powerup_script-'));

    const list = await fetch(`http://127.0.0.1:${port}/api/evals/runs?suite=powerup_script`);
    assert.equal(list.status, 200);
    const { runs } = await list.json();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].passed, 1);
    assert.equal(runs[0].failed, 1);
    // Latest run carries full failure detail.
    assert.equal(runs[0].results[1].failures[0], 'ask order mismatch');
  } finally {
    server.close();
  }
});

test('rejects invalid suite names (path-safety)', async () => {
  const { app } = makeApp();
  const { server, port } = await listenOnce(app);
  try {
    for (const suite of ['../etc/passwd', 'Suite With Spaces', '', 'x'.repeat(80)]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/evals/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VALID_REPORT, suite }),
      });
      assert.equal(res.status, 400, `suite "${suite}" must be rejected`);
    }
    const badList = await fetch(`http://127.0.0.1:${port}/api/evals/runs?suite=../x`);
    assert.equal(badList.status, 400);
  } finally {
    server.close();
  }
});

test('rejects reports without results[] and oversized reports', async () => {
  const { app } = makeApp();
  const { server, port } = await listenOnce(app);
  try {
    const noResults = await fetch(`http://127.0.0.1:${port}/api/evals/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suite: 'powerup_script' }),
    });
    assert.equal(noResults.status, 400);

    const huge = {
      ...VALID_REPORT,
      results: Array.from({ length: 200 }, (_, i) => ({
        caseId: `case-${i}`, passed: false, failures: ['y'.repeat(2000)],
      })),
    };
    const tooBig = await fetch(`http://127.0.0.1:${port}/api/evals/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(huge),
    });
    assert.equal(tooBig.status, 413);
  } finally {
    server.close();
  }
});

test('list is empty (not an error) with no runs', async () => {
  const { app } = makeApp();
  const { server, port } = await listenOnce(app);
  try {
    const list = await fetch(`http://127.0.0.1:${port}/api/evals/runs`);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).runs, []);
  } finally {
    server.close();
  }
});
