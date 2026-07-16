import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'integration-admin-key';

const { app } = await import('./server.js');
let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.once('error', reject);
  });
});

after(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
});

test('public client configuration remains readable with security headers', async () => {
  const response = await fetch(`${baseUrl}/api/models`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('canonical Canopy helper endpoint is public but rejects empty input before any LLM call', async () => {
  const response = await fetch(`${baseUrl}/api/canopy-helper/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { conversation_history: ['must not be sent'] } }),
  });
  assert.equal(response.status, 400);
});

test('privileged reads and legacy writes require the admin header', async () => {
  assert.equal((await fetch(`${baseUrl}/api/releases`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/releases?adminKey=integration-admin-key`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/releases`, {
    headers: { 'x-admin-key': 'integration-admin-key' },
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/usage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: 'attacker' }),
  })).status, 401);
});

test('raw remote screen telemetry stays disabled', async () => {
  const response = await fetch(`${baseUrl}/api/telemetry/target`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': 'integration-admin-key',
    },
    body: JSON.stringify({ domText: 'private screen contents' }),
  });
  assert.equal(response.status, 410);
});

test('unapproved browser origins are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/models`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
});
