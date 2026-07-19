// ─── Publish & Share routes (Workstream E, server) ───────────────────────────
// Static hosting for self-contained Canopy mini-apps.
//
// Security model (persona review §8 / plan Workstream E):
//   • Unlisted, unguessable ids (128-bit). noindex everywhere. No directory.
//   • Server-side re-validation: static-only HTML, size cap. Never trust the client.
//   • Viewer page: sandboxed iframe + CSP that mirrors the local no-network
//     sandbox — a malicious or prompt-injected artifact cannot exfiltrate
//     viewer data or phone home.
//   • Ownership = device token (hashed at rest). Revoke → 410 permanently.
//   • No viewer tracking beyond an aggregate view counter shown to the owner.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const MAX_SHARE_BYTES = 2 * 1024 * 1024;

// Mirrors src/utils/sharePublish.ts STATIC_VIOLATION_PATTERNS — keep in sync.
const STATIC_VIOLATION_PATTERNS = [
  ['network_fetch', /\bfetch\s*\(/i],
  ['network_xhr', /\bXMLHttpRequest\b/i],
  ['network_websocket', /\bnew\s+WebSocket\b/i],
  ['network_eventsource', /\bnew\s+EventSource\b/i],
  ['network_sendbeacon', /\bnavigator\s*\.\s*sendBeacon\b/i],
  ['form_action', /<form\b[^>]*\baction\s*=\s*["'](?!#|["'])/i],
  ['external_script', /<script\b[^>]*\bsrc\s*=/i],
  ['external_stylesheet', /<link\b[^>]*\bhref\s*=\s*["']https?:/i],
  ['external_iframe', /<iframe\b[^>]*\bsrc\s*=\s*["']https?:/i],
  ['external_import', /\bimport\s*\(\s*["']https?:/i],
  ['meta_refresh_redirect', /<meta\b[^>]*http-equiv\s*=\s*["']refresh/i],
];
const EXTERNAL_RESOURCE = /<(?:img|video|audio|source|object|embed)\b[^>]*\bsrc\s*=\s*["']https?:/i;

export function validateShareableHtml(html) {
  const violations = [];
  if (!html || !String(html).trim()) return { ok: false, violations: ['empty_document'] };
  if (Buffer.byteLength(String(html), 'utf8') > MAX_SHARE_BYTES) violations.push('too_large');
  for (const [reason, pattern] of STATIC_VIOLATION_PATTERNS) {
    if (pattern.test(html)) violations.push(reason);
  }
  const withoutAnchors = String(html).replace(/<a\b[^>]*>/gi, '');
  if (EXTERNAL_RESOURCE.test(withoutAnchors)) violations.push('external_media');
  return { ok: violations.length === 0, violations };
}

export function isValidShareId(id) {
  return typeof id === 'string'
    && id.length > 0
    && id.length <= 64
    && /^[A-Za-z0-9_-]+$/.test(id);
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The viewer shell: sandboxed srcdoc iframe + slim attribution frame + CTA.
 *  The app html is embedded via srcdoc with quotes escaped; the iframe sandbox
 *  allows scripts but no same-origin, no forms, no popups, no top-navigation. */
export const DEFAULT_CTA_URL = 'https://canopy.app?ref=share';

export function renderViewerPage({ title, agentName, html, ctaUrl }) {
  const safeTitle = escapeHtml(title || 'A Canopy mini-app');
  const safeAgent = escapeHtml(agentName || 'a Canopy agent team');
  const safeCta = escapeHtml(ctaUrl || DEFAULT_CTA_URL);
  const srcdoc = escapeHtml(html);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle} · Made with Canopy</title>
<style>
  html,body{margin:0;height:100%;background:#0f1a17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .frame{display:flex;flex-direction:column;height:100%}
  iframe{flex:1;border:0;width:100%;background:#fff}
  .bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;color:#c9e5dd;font-size:13px}
  .bar a{color:#7fd6c2;font-weight:700;text-decoration:none;white-space:nowrap}
  .bar .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style>
</head>
<body>
<div class="frame">
  <iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${srcdoc}" title="${safeTitle}"></iframe>
  <div class="bar">
    <span class="t">${safeTitle} — built by ${safeAgent} with Canopy</span>
    <a href="${safeCta}" rel="noopener">Build your own →</a>
  </div>
</div>
</body>
</html>`;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

function shareFilePath(sharesDir, id) {
  // isValidShareId is checked by all callers, but keep path join defensive.
  return path.join(sharesDir, `${id}.json`);
}

function readShare(sharesDir, id) {
  try {
    return JSON.parse(fs.readFileSync(shareFilePath(sharesDir, id), 'utf8'));
  } catch {
    return null;
  }
}

function writeShare(sharesDir, id, record) {
  fs.mkdirSync(sharesDir, { recursive: true });
  fs.writeFileSync(shareFilePath(sharesDir, id), JSON.stringify(record));
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerShareRoutes(app, { sharesDir, createRateLimiter, ctaUrl }) {
  const resolvedCtaUrl = ctaUrl || process.env.CANOPY_SHARE_CTA_URL || DEFAULT_CTA_URL;
  const publishLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 10 * 60_000, max: 30, keyPrefix: 'share-publish' })
    : (_req, _res, next) => next();
  const viewLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'share-view' })
    : (_req, _res, next) => next();

  app.post('/api/share/publish', publishLimit, (req, res) => {
    const { html, title, agentName, deviceToken } = req.body || {};
    if (typeof deviceToken !== 'string' || deviceToken.length < 32) {
      return res.status(400).json({ error: 'invalid_device_token' });
    }
    const validation = validateShareableHtml(html);
    if (!validation.ok) {
      return res.status(422).json({ error: 'not_static', violations: validation.violations });
    }
    const id = crypto.randomBytes(16).toString('base64url'); // 128-bit unguessable
    writeShare(sharesDir, id, {
      html: String(html),
      title: String(title || '').slice(0, 200),
      agentName: String(agentName || '').slice(0, 200),
      ownerTokenHash: hashToken(deviceToken),
      createdAt: Date.now(),
      revoked: false,
      views: 0,
    });
    return res.json({ id });
  });

  app.post('/api/share/revoke', publishLimit, (req, res) => {
    const { id, deviceToken } = req.body || {};
    if (!isValidShareId(id)) return res.status(400).json({ error: 'invalid_id' });
    const record = readShare(sharesDir, id);
    if (!record) return res.status(404).json({ error: 'not_found' });
    if (record.ownerTokenHash !== hashToken(deviceToken || '')) {
      return res.status(403).json({ error: 'not_owner' });
    }
    record.revoked = true;
    record.html = ''; // scrub content at revocation, not just flag it
    writeShare(sharesDir, id, record);
    return res.json({ ok: true });
  });

  app.get('/share/:id', viewLimit, (req, res) => {
    const { id } = req.params;
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (!isValidShareId(id)) return res.status(404).send('Not found');
    const record = readShare(sharesDir, id);
    if (!record) return res.status(404).send('Not found');
    if (record.revoked) return res.status(410).send('This link was revoked by its owner.');

    record.views = (record.views || 0) + 1;
    try { writeShare(sharesDir, id, record); } catch { /* view count is best-effort */ }

    // CSP mirrors the local no-network sandbox: inline-only, no connect-src.
    res.set('Content-Security-Policy', [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "img-src data: blob:",
      "media-src data: blob:",
      "font-src data:",
      "frame-src 'self' data:",
      "connect-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; '));
    res.set('Referrer-Policy', 'no-referrer');
    return res.type('html').send(renderViewerPage({ ...record, ctaUrl: resolvedCtaUrl }));
  });
}
