// Run: node --test connections-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isValidToken,
  isValidAgentId,
  validatePendingCreatePayload,
  validateCompletePayload,
  renderConnectPage,
  renderStatePage,
  registerConnectionRoutes,
} from './connections-routes.js';

// ─── validators ──────────────────────────────────────────────────────────────

const VALID_TOKEN = '5a1e1e0a-0000-4000-8000-000000000000';
const VALID_PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const VALID_NONCE = Buffer.alloc(12, 9).toString('base64');
const VALID_EPHEMERAL = Buffer.alloc(32, 5).toString('base64');
const futureIso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

function validCreateBody(overrides = {}) {
  return {
    token: VALID_TOKEN,
    agentId: 'agent-1',
    providerName: 'Seats.aero',
    secretName: 'SEATS_AERO_API_KEY',
    tokenUrl: 'https://seats.aero/account',
    instructions: 'Sign in and copy your API key.',
    placeholder: 'sk_...',
    publicKey: VALID_PUBLIC_KEY,
    expiresAt: futureIso(15 * 60_000),
    ...overrides,
  };
}

test('isValidToken / isValidAgentId', () => {
  assert.ok(isValidToken(VALID_TOKEN));
  assert.ok(!isValidToken('not-a-uuid'));
  assert.ok(!isValidToken('../../etc/passwd'));
  assert.ok(isValidAgentId('agent-1_ok'));
  assert.ok(!isValidAgentId('Agent With Spaces'));
  assert.ok(!isValidAgentId('a'.repeat(64)));
});

test('validatePendingCreatePayload accepts a well-formed request', () => {
  const { record, error } = validatePendingCreatePayload(validCreateBody());
  assert.equal(error, undefined);
  assert.equal(record.providerName, 'Seats.aero');
  assert.equal(record.secretName, 'SEATS_AERO_API_KEY');
  assert.equal(record.tokenUrl, 'https://seats.aero/account');
});

test('validatePendingCreatePayload rejects non-http(s) tokenUrl', () => {
  const { error } = validatePendingCreatePayload(validCreateBody({ tokenUrl: 'javascript:alert(1)' }));
  assert.equal(error, 'invalid_token_url');
});

test('validatePendingCreatePayload rejects a malformed agentId', () => {
  const { error } = validatePendingCreatePayload(validCreateBody({ agentId: 'Agent; rm -rf /' }));
  assert.equal(error, 'invalid_agent_id');
});

test('validatePendingCreatePayload rejects a public key of the wrong length', () => {
  const { error } = validatePendingCreatePayload(
    validCreateBody({ publicKey: Buffer.alloc(16, 1).toString('base64') }),
  );
  assert.equal(error, 'invalid_public_key');
});

test('validatePendingCreatePayload rejects expiresAt outside the tolerance window', () => {
  assert.equal(validatePendingCreatePayload(validCreateBody({ expiresAt: futureIso(-1000) })).error, 'invalid_expires_at');
  assert.equal(
    validatePendingCreatePayload(validCreateBody({ expiresAt: futureIso(60 * 60_000) })).error,
    'invalid_expires_at',
  );
});

test('validatePendingCreatePayload clamps instructions and falls back placeholder', () => {
  const { record } = validatePendingCreatePayload(
    validCreateBody({ instructions: 'x'.repeat(1000), placeholder: '' }),
  );
  assert.equal(record.instructions.length, 600);
  assert.equal(record.placeholder, 'Paste your API key here');
});

test('validateCompletePayload accepts well-formed ciphertext envelope', () => {
  const { record, error } = validateCompletePayload({
    ciphertext: Buffer.from('ciphertext-bytes').toString('base64'),
    nonce: VALID_NONCE,
    ephemeralPublicKey: VALID_EPHEMERAL,
  });
  assert.equal(error, undefined);
  assert.ok(record.ciphertext);
});

test('validateCompletePayload rejects wrong-length nonce/ephemeral key', () => {
  assert.equal(
    validateCompletePayload({
      ciphertext: 'YQ==',
      nonce: Buffer.alloc(8).toString('base64'), // wrong length
      ephemeralPublicKey: VALID_EPHEMERAL,
    }).error,
    'invalid_nonce',
  );
  assert.equal(
    validateCompletePayload({
      ciphertext: 'YQ==',
      nonce: VALID_NONCE,
      ephemeralPublicKey: Buffer.alloc(16).toString('base64'), // wrong length
    }).error,
    'invalid_ephemeral_public_key',
  );
});

// ─── page rendering — no plaintext-in-HTML, no XSS ──────────────────────────

test('renderConnectPage embeds config as an inert JSON island, never innerHTML', () => {
  const page = renderConnectPage({
    token: VALID_TOKEN,
    providerName: '<script>alert(1)</script>',
    instructions: 'Do the thing.',
    placeholder: 'sk_...',
    tokenUrl: 'https://example.com',
    publicKey: VALID_PUBLIC_KEY,
    expiresAt: futureIso(60_000),
  });
  assert.ok(page.includes('type="application/json" id="connect-config"'));
  assert.ok(page.includes('/connect-widget.js'));
  // Title uses escapeHtml; the JSON island uses < escaping — either way the
  // raw tag must never appear unescaped in the response.
  assert.ok(!page.includes('<script>alert(1)</script>'));
});

test('renderStatePage escapes its message', () => {
  const page = renderStatePage({ title: 'Expired', message: '<img src=x onerror=alert(1)>' });
  assert.ok(!page.includes('<img src=x onerror=alert(1)>'));
});

// ─── route handlers (express-free harness, mirrors share-routes.test.js) ────

function makeApp() {
  const routes = { GET: new Map(), POST: new Map() };
  return {
    post(routePath, ...handlers) { routes.POST.set(routePath, handlers.at(-1)); },
    get(routePath, ...handlers) { routes.GET.set(routePath, handlers.at(-1)); },
    async run(method, routePath, { body, params, query } = {}) {
      const handler = routes[method].get(routePath);
      assert.ok(handler, `route registered: ${method} ${routePath}`);
      let statusCode = 200; let jsonBody = null; let sent = null; const headers = {};
      const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { jsonBody = payload; return this; },
        send(payload) { sent = payload; return this; },
        set(name, value) { if (typeof name === 'object') Object.assign(headers, name); else headers[name] = value; return this; },
        type() { return this; },
        sendFile(filePath) { sent = fs.readFileSync(filePath, 'utf8'); return this; },
      };
      await handler({ body: body || {}, params: params || {}, query: query || {}, ip: '127.0.0.1' }, res);
      return { statusCode, jsonBody, sent, headers };
    },
  };
}

/** Minimal in-memory stand-in for createPostgresConnectionsStore's interface. */
function makeInMemoryStore() {
  const rows = new Map();
  return {
    async create(record) {
      rows.set(record.token, { ...record, status: 'pending' });
    },
    async getByToken(token) {
      return rows.get(token) || null;
    },
    async complete(token, envelope) {
      const row = rows.get(token);
      if (!row || row.status !== 'pending' || Date.parse(row.expiresAt) <= Date.now()) return false;
      Object.assign(row, envelope, { status: 'completed' });
      return true;
    },
    async pullCompletedForAgent(agentId) {
      const out = [];
      for (const [token, row] of rows) {
        if (row.agentId === agentId && row.status === 'completed') {
          out.push({ token, ciphertext: row.ciphertext, nonce: row.nonce, ephemeralPublicKey: row.ephemeralPublicKey });
          rows.delete(token);
        }
      }
      return out;
    },
    async sweepExpired() {
      for (const [token, row] of rows) {
        if (row.status === 'pending' && Date.parse(row.expiresAt) <= Date.now()) rows.delete(token);
      }
    },
    _rows: rows,
  };
}

test('full lifecycle: create -> view -> complete -> poll (destructive) -> gone', async () => {
  const store = makeInMemoryStore();
  const app = makeApp();
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-public-'));
  registerConnectionRoutes(app, { store, publicDir });

  const created = await app.run('POST', '/api/connections/pending', { body: validCreateBody() });
  assert.equal(created.statusCode, 201);

  const viewed = await app.run('GET', '/connect/:token', { params: { token: VALID_TOKEN } });
  assert.equal(viewed.statusCode, 200);
  assert.ok(viewed.headers['Content-Security-Policy'].includes("script-src 'self'"));
  assert.ok(viewed.sent.includes('Seats.aero'));

  const completed = await app.run('POST', '/api/connections/complete/:token', {
    params: { token: VALID_TOKEN },
    body: { ciphertext: Buffer.from('ct').toString('base64'), nonce: VALID_NONCE, ephemeralPublicKey: VALID_EPHEMERAL },
  });
  assert.equal(completed.statusCode, 200);

  // A second completion attempt must fail — single-use.
  const doubleComplete = await app.run('POST', '/api/connections/complete/:token', {
    params: { token: VALID_TOKEN },
    body: { ciphertext: Buffer.from('ct').toString('base64'), nonce: VALID_NONCE, ephemeralPublicKey: VALID_EPHEMERAL },
  });
  assert.equal(doubleComplete.statusCode, 410);

  const viewedAfterComplete = await app.run('GET', '/connect/:token', { params: { token: VALID_TOKEN } });
  assert.equal(viewedAfterComplete.statusCode, 410);

  const polled = await app.run('GET', '/api/connections/pending', { query: { agent_id: 'agent-1' } });
  assert.equal(polled.statusCode, 200);
  assert.equal(polled.jsonBody.completed.length, 1);
  assert.equal(polled.jsonBody.completed[0].token, VALID_TOKEN);

  // Destructive read: a second poll must NOT return the same completion again.
  const polledAgain = await app.run('GET', '/api/connections/pending', { query: { agent_id: 'agent-1' } });
  assert.equal(polledAgain.jsonBody.completed.length, 0);

  fs.rmSync(publicDir, { recursive: true, force: true });
});

test('unknown/invalid token 404s without leaking whether it ever existed differently', async () => {
  const store = makeInMemoryStore();
  const app = makeApp();
  registerConnectionRoutes(app, { store, publicDir: os.tmpdir() });

  for (const token of ['not-a-uuid', '../../etc/passwd', VALID_TOKEN]) {
    const result = await app.run('GET', '/connect/:token', { params: { token } });
    assert.equal(result.statusCode, 404, token);
  }
});

test('expired pending row is rejected by complete and by the view page', async () => {
  const store = makeInMemoryStore();
  const app = makeApp();
  registerConnectionRoutes(app, { store, publicDir: os.tmpdir() });

  await store.create({ ...validCreateBody(), expiresAt: new Date(Date.now() - 1000).toISOString() });

  const viewed = await app.run('GET', '/connect/:token', { params: { token: VALID_TOKEN } });
  assert.equal(viewed.statusCode, 410);

  const completed = await app.run('POST', '/api/connections/complete/:token', {
    params: { token: VALID_TOKEN },
    body: { ciphertext: Buffer.from('ct').toString('base64'), nonce: VALID_NONCE, ephemeralPublicKey: VALID_EPHEMERAL },
  });
  assert.equal(completed.statusCode, 410);
});

test('routes 503 when no store is configured (Postgres unset)', async () => {
  const app = makeApp();
  registerConnectionRoutes(app, { store: null, publicDir: os.tmpdir() });

  const created = await app.run('POST', '/api/connections/pending', { body: validCreateBody() });
  assert.equal(created.statusCode, 503);

  const viewed = await app.run('GET', '/connect/:token', { params: { token: VALID_TOKEN } });
  assert.equal(viewed.statusCode, 503);

  const polled = await app.run('GET', '/api/connections/pending', { query: { agent_id: 'agent-1' } });
  assert.equal(polled.statusCode, 503);
});

test('poll rejects a malformed agent_id', async () => {
  const store = makeInMemoryStore();
  const app = makeApp();
  registerConnectionRoutes(app, { store, publicDir: os.tmpdir() });

  const result = await app.run('GET', '/api/connections/pending', { query: { agent_id: '../../etc/passwd' } });
  assert.equal(result.statusCode, 400);
});

test('connect-widget.js 503s with a clear message when unbuilt, 200s when present', async () => {
  const store = makeInMemoryStore();
  const app = makeApp();
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-public-'));
  registerConnectionRoutes(app, { store, publicDir });

  const missing = await app.run('GET', '/connect-widget.js', {});
  assert.equal(missing.statusCode, 503);
  assert.ok(missing.sent.includes('npm run build:connect-widget'));

  fs.writeFileSync(path.join(publicDir, 'connect-widget.js'), 'export default 1;');
  const present = await app.run('GET', '/connect-widget.js', {});
  assert.equal(present.statusCode, 200);
  assert.ok(present.sent.includes('export default 1;'));

  fs.rmSync(publicDir, { recursive: true, force: true });
});
