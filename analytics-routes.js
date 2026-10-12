// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
// Express port of the kit's api/e and api/stats route handlers. The Canopy desktop app (Tauri) has no
// server of its own, so its tracker (canopy/src/lib/analytics/client.ts) posts here.
import { timingSafeEqual } from 'node:crypto';
import { UAParser } from 'ua-parser-js';
import { tsImport } from 'tsx/esm/api';

const MAX_BODY = 32 * 1024;
const BOT = /bot|crawl|spider|slurp|headless|preview/i;

// Best-effort, per instance: enough to stop one client flooding the table
const WINDOW_MS = 60 * 1000;
const MAX_EVENTS_PER_WINDOW = 300;
const hits = new Map();

function overLimit(ip, count) {
  const t = Date.now();
  const entry = hits.get(ip);
  if (!entry || t - entry.start > WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: t, count });
    return count > MAX_EVENTS_PER_WINDOW;
  }
  entry.count += count;
  return entry.count > MAX_EVENTS_PER_WINDOW;
}

// The kit's server files are TypeScript, the same files every app has. They're loaded once, on first use.
let kit = null;
export function loadAnalyticsKit() {
  kit ??= Promise.all(
    ['events', 'server/collect', 'server/db', 'server/metrics', 'server/ai-usage'].map((file) => tsImport(`./analytics/${file}.ts`, import.meta.url)),
  ).then(([events, collect, db, metrics, aiUsage]) => ({ ...events, ...collect, ...db, ...metrics, ...aiUsage }));
  return kit;
}

/* ---- what the server spends on model APIs (analytics/server/ai-usage.ts) ---- */

const deviceOf = async (req) => (await loadAnalyticsKit()).deviceFrom({ headers: { get: (name) => req.get(name) ?? null } });

/** Records a finished Anthropic Messages call. Never throws: cost tracking must not break the feature it measures. */
export async function recordAnthropicCall(feature, requestedModel, message, req) {
  try {
    const { recordAiUsage, anthropicUsage } = await loadAnalyticsKit();
    if (!message?.usage) return;
    await recordAiUsage({ feature, ...anthropicUsage(message, requestedModel), device: await deviceOf(req) });
  } catch (error) {
    console.error('analytics: recording AI usage failed', error);
  }
}

/** Records a finished Gemini generateContent call from its usageMetadata. Never throws. */
export async function recordGeminiCall(feature, model, data, req) {
  try {
    const { recordAiUsage } = await loadAnalyticsKit();
    const usage = data?.usageMetadata;
    if (!usage) return;
    const cached = usage.cachedContentTokenCount ?? 0;
    await recordAiUsage({
      feature,
      provider: 'google',
      model: data.modelVersion ?? model,
      // promptTokenCount includes the cached part; thinking is billed as output
      inputTokens: Math.max(0, (usage.promptTokenCount ?? 0) - cached),
      cacheReadTokens: cached,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      outcome: data.candidates?.[0]?.finishReason?.toLowerCase() ?? 'unknown',
      device: await deviceOf(req),
    });
  } catch (error) {
    console.error('analytics: recording AI usage failed', error);
  }
}

/** Records a paid call that reports no token usage (speech synthesis): counted, with no cost. Never throws. */
export async function recordModelCall(feature, provider, model, req) {
  try {
    const { recordAiUsage } = await loadAnalyticsKit();
    await recordAiUsage({ feature, provider, model: model ?? 'unknown', outcome: 'ok', device: await deviceOf(req) });
  } catch (error) {
    console.error('analytics: recording AI usage failed', error);
  }
}

function authorized(req) {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  const given = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Visitor country from the load balancer, when it adds one; the IP itself is never stored. */
function country(req) {
  const raw = req.get('x-vercel-ip-country') ?? req.get('x-appengine-country') ?? req.get('x-client-region') ?? '';
  return /^[A-Z]{2}$/i.test(raw) ? raw.toUpperCase() : null;
}

/** Validates a batch from the tracker and stores it. Anything that isn't ours is dropped. */
async function collect(req, allowedOrigins) {
  const { APP, ANALYTICS_ENV, db, ensureSchema, ownerMark, parseBatch } = await loadAnalyticsKit();
  const sql = db();
  if (!sql) return;

  // Only the desktop app's webview and our own pages post here
  const origin = req.get('origin');
  try {
    if (origin && !allowedOrigins.has(origin) && new URL(origin).host !== req.get('host')) return;
  } catch {
    return;
  }

  const ua = req.get('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return;

  if (Number(req.get('content-length') ?? 0) > MAX_BODY) return;
  const body = req.body;
  const rows = parseBatch(body);
  if (!rows.length) return;
  if (overLimit(req.ip || 'local', rows.length)) return;

  const parsed = new UAParser(ua);
  const deviceType = parsed.getDevice().type ?? 'desktop';
  // Names only, never versions: "Safari" on "macOS"
  const browser = parsed.getBrowser().name?.slice(0, 40) || null;
  const os = parsed.getOS().name?.slice(0, 40) || null;
  const where = country(req);

  await ensureSchema(sql);
  await sql`insert into analytics_events ${sql(
    rows.map((r) => ({ ...r, props: sql.json(r.props), app: APP, env: ANALYTICS_ENV, country: where, device_type: deviceType, browser, os })),
  )}`;
  // The owner's own device (marked as "me"): still counted, and left out of "without me" reports
  const me = ownerMark(body);
  const device = rows[0].device_id;
  if (me === true) await sql`insert into analytics_owner_devices (app, device_id) values (${APP}, ${device}) on conflict do nothing`;
  if (me === false) await sql`delete from analytics_owner_devices where app = ${APP} and device_id = ${device}`;
}

/**
 * Register before the /api rate limiter and the admin-key middleware: the collector has its own limit, and
 * the stats answer to STATS_TOKEN, not the admin key.
 */
export function registerAnalyticsRoutes(app, { allowedOrigins }) {
  /**
   * The collector for the desktop tracker. Short, neutral path so content blockers that match "analytics"
   * or "collect" leave it alone. Always answers 204: tracking must never break the app.
   */
  app.post('/api/e', async (req, res) => {
    // Cloud Run throttles CPU once a response is sent, so the insert finishes first
    try {
      await collect(req, allowedOrigins);
    } catch (error) {
      console.error('analytics: insert failed', error);
    }
    res.status(204).end();
  });

  /**
   * Usage stats as JSON for scottieryan.com's nightly job:
   *
   *   curl -H "Authorization: Bearer $STATS_TOKEN" https://canopy-admin-418538192879.us-central1.run.app/api/stats
   *
   * Every app answers with the same shape (analytics/server/metrics.ts).
   * Add ?without=me to leave out the owner's own devices.
   *
   * Without the token it answers 401, naming only the app and the kit version it runs, so anyone rolling
   * the kit out can check what is actually deployed.
   *
   * This path is also the admin Dashboard's own stats (server.js), which present x-admin-key: those
   * requests pass through to that handler untouched.
   */
  app.get('/api/stats', async (req, res, next) => {
    if (req.get('x-admin-key')) return next();
    try {
      const { APP, KIT, ANALYTICS_ENV, db, ensureSchema, appStats } = await loadAnalyticsKit();
      res.set('cache-control', 'no-store');
      if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized', app: APP, kit: KIT });
      const sql = db();
      if (!sql) return res.status(503).json({ error: "Analytics isn't configured (set ANALYTICS_DATABASE_URL)." });
      await ensureSchema(sql);
      return res.json(await appStats(sql, APP, ANALYTICS_ENV, undefined, req.query.without === 'me'));
    } catch (error) {
      console.error('analytics: stats failed', error);
      return res.status(500).json({ error: 'Stats query failed' });
    }
  });
}
