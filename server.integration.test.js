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
    await new Promise((resolve, reject) => {
      // Stop accepting new keep-alive requests before terminating the sockets
      // opened by Node's fetch client. Calling closeAllConnections first can
      // leave server.close() waiting forever on newer Node releases.
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
});

test('public client configuration remains readable with security headers', async () => {
  const response = await fetch(`${baseUrl}/api/models`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const models = await response.json();
  assert.ok(Array.isArray(models.models) && models.models.length > 0);

  const agentsResponse = await fetch(`${baseUrl}/api/agents`);
  assert.equal(agentsResponse.status, 200);
  const agents = await agentsResponse.json();
  assert.ok(agents.Researcher, 'clean checkouts must include the public persona catalog');
});

test('server-funded LLM routes require admin authentication before parsing input', async () => {
  const response = await fetch(`${baseUrl}/api/canopy-helper/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { conversation_history: ['must not be sent'] } }),
  });
  assert.equal(response.status, 401);
  assert.equal((await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'test' }),
  })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/agents/add-suggestion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'Researcher', bookTitle: 'A title' }),
  })).status, 401);
});

test('first-run Eddy bootstrap is public but rejects non-onboarding payloads', async () => {
  const response = await fetch(`${baseUrl}/api/canopy-helper/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello', context: { onboarding: { in_onboarding: false } } }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /only during onboarding/);
});

test('authenticated admin generation pipelines remain reachable', async () => {
  const headers = { 'content-type': 'application/json', 'x-admin-key': 'integration-admin-key' };
  assert.equal((await fetch(`${baseUrl}/api/generate`, {
    method: 'POST', headers, body: JSON.stringify({}),
  })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/generate-accessories-2d`, {
    method: 'POST', headers, body: JSON.stringify({}),
  })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/meshy-task`, {
    method: 'POST', headers, body: JSON.stringify({}),
  })).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/meshy-check/not.valid`, {
    headers: { 'x-admin-key': 'integration-admin-key' },
  })).status, 400);
});

test('authenticated helper requests are still sanitized before any provider call', async () => {
  const response = await fetch(`${baseUrl}/api/canopy-helper/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'integration-admin-key' },
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
