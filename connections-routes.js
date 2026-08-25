// ─── Web-hosted connection token capture ──────────────────────────────────────
// Lets a Canopy agent ask the user for a provider API key over Slack via a plain
// https:// link instead of a canopy:// deep link that requires the desktop app
// to be reachable from the user's device. Full protocol + threat model:
// canopy/WEB_CONNECTIONS.md (this file is the implementation of that spec).
//
// Storage is Postgres, not per-instance local files (contrast share-routes.js's
// sharesDir): a single capture round-trips through the desktop's register POST,
// the browser's complete POST, and the desktop's poll GET, which can each land
// on a different Cloud Run instance. Only a shared store is correct here.
//
// Security model:
//   • The key is encrypted client-side (in the user's browser, see
//     src/connect-widget/main.ts) to the requesting Canopy install's X25519
//     public key before it's ever sent here. This server only ever sees
//     ciphertext — it cannot decrypt what it stores even if fully compromised.
//   • Unguessable, single-use tokens (UUID v4). 15-minute TTL, enforced both
//     here and by the /connect/:token page itself.
//   • GET /api/connections/pending is destructive: a completed row is deleted
//     the moment it's returned to the polling desktop. No separate ack call.
//   • No admin-key auth on any of these routes (see server-security.js) — the
//     desktop app has no admin key to present, and the /connect/:token page is
//     opened by an anonymous end user. Protection is the token itself (for
//     complete/view) and rate limiting (for the unauthenticated create/poll
//     surface) — same posture as /api/share/publish.

import fs from 'fs';
import path from 'path';
import { escapeHtml } from './share-routes.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^[a-z0-9_-]{1,63}$/;
const SECRET_NAME_RE = /^[A-Z0-9_]{1,100}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const MAX_PROVIDER_NAME = 200;
const MAX_INSTRUCTIONS = 600;
const MAX_PLACEHOLDER = 200;
const MAX_CIPHERTEXT_B64 = 8 * 1024; // real API keys are a few hundred bytes at most
const DEFAULT_PLACEHOLDER = 'Paste your API key here';
// Canopy always sends expiresAt = now + 15m. Allow generous slack for clock
// skew between the desktop and this server without opening the window much.
const EXPIRES_AT_TOLERANCE_MS = 20 * 60_000;

export function isValidToken(token) {
  return typeof token === 'string' && UUID_RE.test(token);
}

export function isValidAgentId(agentId) {
  return typeof agentId === 'string' && AGENT_ID_RE.test(agentId);
}

function decodeBase64Exact(value, exactByteLength) {
  if (typeof value !== 'string' || !value || value.length > 8192 || !BASE64_RE.test(value)) {
    return null;
  }
  const bytes = Buffer.from(value, 'base64');
  if (exactByteLength !== undefined && bytes.length !== exactByteLength) return null;
  return bytes;
}

/** Validates a POST /api/connections/pending body. Returns {record} or {error}. */
export function validatePendingCreatePayload(body) {
  const b = body && typeof body === 'object' ? body : {};

  if (!isValidToken(b.token)) return { error: 'invalid_token' };
  if (!isValidAgentId(b.agentId)) return { error: 'invalid_agent_id' };

  const providerName = typeof b.providerName === 'string' ? b.providerName.trim() : '';
  if (!providerName || providerName.length > MAX_PROVIDER_NAME) {
    return { error: 'invalid_provider_name' };
  }

  if (typeof b.secretName !== 'string' || !SECRET_NAME_RE.test(b.secretName)) {
    return { error: 'invalid_secret_name' };
  }

  let tokenUrl = null;
  if (b.tokenUrl != null) {
    if (typeof b.tokenUrl !== 'string') return { error: 'invalid_token_url' };
    try {
      const parsed = new URL(b.tokenUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'invalid_token_url' };
      }
      tokenUrl = parsed.toString();
    } catch {
      return { error: 'invalid_token_url' };
    }
  }

  let instructions = null;
  if (b.instructions != null) {
    if (typeof b.instructions !== 'string') return { error: 'invalid_instructions' };
    instructions = b.instructions.trim().slice(0, MAX_INSTRUCTIONS) || null;
  }

  const placeholder =
    (typeof b.placeholder === 'string' && b.placeholder.trim().slice(0, MAX_PLACEHOLDER)) ||
    DEFAULT_PLACEHOLDER;

  if (!decodeBase64Exact(b.publicKey, 32)) return { error: 'invalid_public_key' };

  const expiresAtMs = typeof b.expiresAt === 'string' ? Date.parse(b.expiresAt) : NaN;
  const now = Date.now();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now || expiresAtMs > now + EXPIRES_AT_TOLERANCE_MS) {
    return { error: 'invalid_expires_at' };
  }

  return {
    record: {
      token: b.token,
      agentId: b.agentId,
      providerName,
      secretName: b.secretName,
      tokenUrl,
      instructions,
      placeholder,
      publicKey: b.publicKey,
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  };
}

/** Validates a POST /api/connections/complete/:token body. Returns {record} or {error}. */
export function validateCompletePayload(body) {
  const b = body && typeof body === 'object' ? body : {};

  const ciphertextBytes =
    typeof b.ciphertext === 'string' && b.ciphertext.length <= MAX_CIPHERTEXT_B64
      ? decodeBase64Exact(b.ciphertext)
      : null;
  if (!ciphertextBytes || ciphertextBytes.length === 0) return { error: 'invalid_ciphertext' };
  if (!decodeBase64Exact(b.nonce, 12)) return { error: 'invalid_nonce' };
  if (!decodeBase64Exact(b.ephemeralPublicKey, 32)) return { error: 'invalid_ephemeral_public_key' };

  return {
    record: {
      ciphertext: b.ciphertext,
      nonce: b.nonce,
      ephemeralPublicKey: b.ephemeralPublicKey,
    },
  };
}

// ─── Postgres-backed store ──────────────────────────────────────────────────

function rowToRecord(row) {
  return {
    token: row.token,
    agentId: row.agent_id,
    providerName: row.provider_name,
    secretName: row.secret_name,
    tokenUrl: row.token_url,
    instructions: row.instructions,
    placeholder: row.placeholder,
    publicKey: row.public_key,
    status: row.status,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
  };
}

export function createPostgresConnectionsStore(pgPool) {
  return {
    async create(record) {
      await pgPool.query(
        `INSERT INTO pending_connections
           (token, agent_id, provider_name, secret_name, token_url, instructions, placeholder, public_key, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.token,
          record.agentId,
          record.providerName,
          record.secretName,
          record.tokenUrl,
          record.instructions,
          record.placeholder,
          record.publicKey,
          record.expiresAt,
        ],
      );
    },

    async getByToken(token) {
      const { rows } = await pgPool.query(
        `SELECT token, agent_id, provider_name, secret_name, token_url, instructions,
                placeholder, public_key, status, expires_at
         FROM pending_connections WHERE token = $1`,
        [token],
      );
      return rows[0] ? rowToRecord(rows[0]) : null;
    },

    // Conditional UPDATE (WHERE status='pending' AND not expired) makes this atomic
    // against a concurrent double-submit or a submit racing past the TTL — no
    // separate read-then-write transaction needed.
    async complete(token, { ciphertext, nonce, ephemeralPublicKey }) {
      const { rowCount } = await pgPool.query(
        `UPDATE pending_connections
         SET status = 'completed', ciphertext = $1, nonce = $2, ephemeral_public_key = $3, completed_at = now()
         WHERE token = $4 AND status = 'pending' AND expires_at > now()`,
        [ciphertext, nonce, ephemeralPublicKey, token],
      );
      return rowCount > 0;
    },

    // Destructive read: rows are deleted as part of being returned. See the
    // module doc comment for why this is intentional, not a bug.
    async pullCompletedForAgent(agentId) {
      const { rows } = await pgPool.query(
        `DELETE FROM pending_connections
         WHERE agent_id = $1 AND status = 'completed'
         RETURNING token, ciphertext, nonce, ephemeral_public_key`,
        [agentId],
      );
      return rows.map((r) => ({
        token: r.token,
        ciphertext: r.ciphertext,
        nonce: r.nonce,
        ephemeralPublicKey: r.ephemeral_public_key,
      }));
    },

    async sweepExpired() {
      await pgPool.query(
        `DELETE FROM pending_connections WHERE status = 'pending' AND expires_at <= now()`,
      );
    },
  };
}

// ─── Page rendering ──────────────────────────────────────────────────────────

const PAGE_STYLE = `
html,body{margin:0;min-height:100%;background:#faf9f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#303330}
.wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}
.card{max-width:420px;width:100%;background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,0.06)}
h1{font-size:20px;margin:0 0 12px;line-height:1.3}
p{line-height:1.5;color:#5a5f5a;margin:0 0 16px}
.msg{font-size:15px;margin:0}
a.token-link{display:inline-block;margin-bottom:20px;color:#3c6663;font-weight:600;text-decoration:none;font-size:14px}
input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #d9d4c9;border-radius:10px;font-size:15px;margin-bottom:14px}
button{width:100%;padding:12px 14px;border:0;border-radius:10px;background:#3c6663;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:disabled{opacity:0.6;cursor:default}
#status-message{margin-top:14px;font-size:13px;min-height:18px}
#status-message[data-kind="error"]{color:#b3261e}
#status-message[data-kind="success"]{color:#1e7a4c}
`;

function pageShell({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · Canopy</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<div class="wrap"><div class="card">${bodyHtml}</div></div>
</body>
</html>`;
}

export function renderStatePage({ title, message }) {
  return pageShell({ title, bodyHtml: `<p class="msg">${escapeHtml(message)}</p>` });
}

export function renderConnectPage({ token, providerName, instructions, placeholder, tokenUrl, publicKey, expiresAt }) {
  const config = { token, providerName, instructions, placeholder, tokenUrl, publicKey, expiresAt };
  // </script>-breakout and HTML-comment-breakout defense for the JSON data island.
  const configJson = JSON.stringify(config).replace(/</g, '\\u003c');
  const bodyHtml = `
  <h1>Connect <span id="provider-name"></span></h1>
  <p id="instructions"></p>
  <a id="token-link" class="token-link" href="#" target="_blank" rel="noopener noreferrer" hidden>Where do I find this? &rarr;</a>
  <form id="connect-form" autocomplete="off">
    <input id="key-input" type="password" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
    <button id="submit-btn" type="submit">Connect</button>
  </form>
  <p id="status-message" role="status"></p>
  <script type="application/json" id="connect-config">${configJson}</script>
  <script type="module" src="/connect-widget.js"></script>`;
  return pageShell({ title: `Connect ${providerName}`, bodyHtml });
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerConnectionRoutes(app, { store, createRateLimiter, publicDir }) {
  const noopLimiter = (_req, _res, next) => next();
  const createLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 10 * 60_000, max: 30, keyPrefix: 'connections-create' })
    : noopLimiter;
  const completeLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 10 * 60_000, max: 20, keyPrefix: 'connections-complete' })
    : noopLimiter;
  const viewLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'connections-view' })
    : noopLimiter;
  const pollLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'connections-poll' })
    : noopLimiter;

  app.post('/api/connections/pending', createLimit, async (req, res) => {
    if (!store) return res.status(503).json({ error: 'connections_service_unconfigured' });
    const { record, error } = validatePendingCreatePayload(req.body);
    if (error) return res.status(400).json({ error });
    try {
      await store.create(record);
    } catch (e) {
      if (String(e?.code) === '23505') return res.status(409).json({ error: 'token_exists' });
      console.error('[CONNECTIONS] create failed:', e.message);
      return res.status(500).json({ error: 'create_failed' });
    }
    return res.status(201).json({ ok: true });
  });

  app.post('/api/connections/complete/:token', completeLimit, async (req, res) => {
    if (!store) return res.status(503).json({ error: 'connections_service_unconfigured' });
    const { token } = req.params;
    if (!isValidToken(token)) return res.status(404).json({ error: 'not_found' });
    const { record, error } = validateCompletePayload(req.body);
    if (error) return res.status(400).json({ error });
    let completed;
    try {
      completed = await store.complete(token, record);
    } catch (e) {
      console.error('[CONNECTIONS] complete failed:', e.message);
      return res.status(500).json({ error: 'complete_failed' });
    }
    if (!completed) return res.status(410).json({ error: 'expired_or_used' });
    return res.json({ status: 'ok' });
  });

  app.get('/api/connections/pending', pollLimit, async (req, res) => {
    if (!store) return res.status(503).json({ error: 'connections_service_unconfigured' });
    const agentId = typeof req.query.agent_id === 'string' ? req.query.agent_id : '';
    if (!isValidAgentId(agentId)) return res.status(400).json({ error: 'invalid_agent_id' });
    try {
      await store.sweepExpired();
    } catch {
      // best-effort — a missed sweep just means an expired row lingers until next poll
    }
    try {
      const completed = await store.pullCompletedForAgent(agentId);
      return res.json({ completed });
    } catch (e) {
      console.error('[CONNECTIONS] poll failed:', e.message);
      return res.status(500).json({ error: 'poll_failed' });
    }
  });

  app.get('/connect/:token', viewLimit, async (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    const { token } = req.params;
    if (!isValidToken(token)) {
      return res.status(404).type('html').send(renderStatePage({ title: 'Not found', message: 'This link is invalid.' }));
    }
    if (!store) {
      return res
        .status(503)
        .type('html')
        .send(renderStatePage({ title: 'Unavailable', message: 'This service is temporarily unavailable. Try again shortly.' }));
    }

    let record;
    try {
      record = await store.getByToken(token);
    } catch (e) {
      console.error('[CONNECTIONS] lookup failed:', e.message);
      return res.status(500).type('html').send(renderStatePage({ title: 'Error', message: 'Something went wrong. Try again shortly.' }));
    }

    if (!record) {
      return res
        .status(404)
        .type('html')
        .send(renderStatePage({ title: 'Not found', message: 'This link is invalid or was already used.' }));
    }
    if (record.status === 'completed') {
      return res
        .status(410)
        .type('html')
        .send(
          renderStatePage({
            title: 'Already used',
            message: 'This link was already used. Ask the agent to send a new one if you need to reconnect.',
          }),
        );
    }
    if (Date.parse(record.expiresAt) <= Date.now()) {
      return res
        .status(410)
        .type('html')
        .send(renderStatePage({ title: 'Expired', message: 'This link has expired. Ask the agent to send a new one.' }));
    }

    // Strict same-origin-only CSP: no inline scripts anywhere on this page (the
    // config data island is type="application/json", inert regardless of CSP),
    // all logic lives in the same-origin /connect-widget.js bundle.
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self'",
        "connect-src 'self'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
    res.set('Referrer-Policy', 'no-referrer');
    return res.type('html').send(renderConnectPage(record));
  });

  app.get('/connect-widget.js', (req, res) => {
    const widgetPath = path.join(publicDir, 'connect-widget.js');
    if (!fs.existsSync(widgetPath)) {
      return res.status(503).type('text/plain').send('connect-widget.js not built — run `npm run build:connect-widget`');
    }
    res.set('Cache-Control', 'public, max-age=3600');
    return res.type('application/javascript').sendFile(widgetPath);
  });
}
