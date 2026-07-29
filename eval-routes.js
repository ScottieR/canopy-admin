// Eval run ingestion + retrieval — makes onboarding-quality evals observable
// in the admin Dashboard ("Onboarding Quality" section).
//
// Reports are produced by canopy/scripts/evalPowerUp.mjs (deterministic script
// engine today; the hosted agent tool-loop harness will report to the same
// endpoint with engine: "agent_loop", so script-vs-agent quality is directly
// comparable over time).
//
// Auth: NOT in PUBLIC_POSTS — the standard x-admin-key header applies
// (server-security.js). The eval runner passes CANOPY_ADMIN_KEY.
// Storage: flat JSON files under data/evals/ — eval volume is tiny (a few
// runs a day), no database needed.

import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_REPORT_BYTES = 256 * 1024;
const SUITE_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function registerEvalRoutes(app, { evalsDir, createRateLimiter }) {
  const rateLimit = createRateLimiter
    ? createRateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'evals' })
    : (req, res, next) => next();

  const ensureDir = () => fs.mkdir(evalsDir, { recursive: true });

  app.post('/api/evals/report', rateLimit, async (req, res) => {
    try {
      const report = req.body;
      if (!report || typeof report !== 'object') {
        return res.status(400).json({ error: 'Report body required' });
      }
      const suite = String(report.suite || '');
      if (!SUITE_PATTERN.test(suite)) {
        return res.status(400).json({ error: 'Invalid suite name' });
      }
      if (!Array.isArray(report.results)) {
        return res.status(400).json({ error: 'results[] required' });
      }
      const serialized = JSON.stringify({
        suite,
        engine: String(report.engine || 'script'),
        configVariant: typeof report.configVariant === 'string' ? report.configVariant.slice(0, 40) : 'default',
        runAt: report.runAt || new Date().toISOString(),
        gitSha: report.gitSha ? String(report.gitSha).slice(0, 40) : null,
        total: Number(report.total) || report.results.length,
        passed: Number(report.passed) || 0,
        failed: Number(report.failed) || 0,
        results: report.results.slice(0, 200),
        receivedAt: new Date().toISOString(),
      });
      if (serialized.length > MAX_REPORT_BYTES) {
        return res.status(413).json({ error: 'Report too large' });
      }
      await ensureDir();
      const filename = `${suite}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      await fs.writeFile(path.join(evalsDir, filename), serialized);
      res.json({ ok: true, id: filename });
    } catch (err) {
      console.error('[EVALS] report failed:', err.message);
      res.status(500).json({ error: 'Failed to store eval report' });
    }
  });

  app.get('/api/evals/runs', async (req, res) => {
    try {
      await ensureDir();
      const suiteFilter = req.query.suite ? String(req.query.suite) : null;
      if (suiteFilter && !SUITE_PATTERN.test(suiteFilter)) {
        return res.status(400).json({ error: 'Invalid suite filter' });
      }
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
      const files = (await fs.readdir(evalsDir)).filter(f => f.endsWith('.json'));
      const runs = [];
      for (const file of files) {
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(evalsDir, file), 'utf8'));
          if (suiteFilter && parsed.suite !== suiteFilter) continue;
          runs.push({ id: file, ...parsed });
        } catch { /* skip corrupt file */ }
      }
      runs.sort((a, b) => String(b.runAt).localeCompare(String(a.runAt)));
      const limited = runs.slice(0, limit);
      // Summaries for the list; full failure detail only on the latest run to
      // keep the payload small.
      res.json({
        runs: limited.map((r, i) => ({
          id: r.id,
          suite: r.suite,
          engine: r.engine,
          runAt: r.runAt,
          gitSha: r.gitSha,
          total: r.total,
          passed: r.passed,
          failed: r.failed,
          ...(i === 0 ? { results: r.results } : {}),
        })),
      });
    } catch (err) {
      console.error('[EVALS] list failed:', err.message);
      res.status(500).json({ error: 'Failed to list eval runs' });
    }
  });
}
