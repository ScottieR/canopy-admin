// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import { createServer, type Server } from "node:http";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { costOf, priceFor } from "./server/ai-prices";
import { anthropicUsage, checkSpendAlert, deviceFrom, recordAiUsage } from "./server/ai-usage";
import { ensureSchema } from "./server/db";
import { appStats } from "./server/metrics";

describe("model prices", () => {
  it("prices a model whatever suffix or prefix its id carries", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toMatchObject({ input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 });
    expect(priceFor("claude-haiku-4-5@20251001")?.input).toBe(1);
    expect(priceFor("anthropic.claude-opus-5-5")).toMatchObject({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 });
    expect(priceFor("claude-fable-5-1")?.cacheRead).toBe(0.25);
    expect(priceFor("claude-opus-4-1-20250805")?.input).toBe(15);
    // A model the table doesn't know is not a cheaper model that shares the start of its name
    expect(priceFor("claude-opus-4-9")).toBeNull();
    // Google's models, with their preview and release tags and the API's models/ prefix
    expect(priceFor("gemini-3.8-flash")).toMatchObject({ input: 1.5, output: 7.5 });
    expect(priceFor("models/gemini-3.5-flash-lite-preview-09-2026")).toMatchObject({ input: 0.3, output: 2.5 });
    expect(priceFor("gemini-3.1-flash-image-001")?.output).toBe(60);
    expect(priceFor("gemini-3-pro-image")).toBeNull();
  });

  it("adds up a call", () => {
    // Anthropic's own worked example for Claude Opus 5: 10k uncached input, 40k cache reads, 15k output
    const { usd, estimated } = costOf("claude-opus-5", { inputTokens: 10000, cacheReadTokens: 40000, outputTokens: 15000 });
    expect(usd).toBeCloseTo(0.445, 6);
    expect(estimated).toBe(false);
  });

  it("never treats an unknown model as free: it costs the highest listed rate, and says it's an estimate", () => {
    expect(costOf("claude-something-new", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toEqual({ usd: 90, estimated: true });
  });
});

describe("anthropicUsage and deviceFrom", () => {
  it("reads a plain message, keeping one-hour cache writes apart from five-minute ones", () => {
    const usage = { input_tokens: 1000, output_tokens: 600, cache_read_input_tokens: 1500, cache_creation_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 3000, ephemeral_1h_input_tokens: 2000 }, iterations: null };
    expect(anthropicUsage({ model: "claude-opus-5-5", stop_reason: "end_turn", usage }, "claude-opus-5-5")).toEqual({
      model: "claude-opus-5-5",
      fallback: false,
      outcome: "end_turn",
      lines: [{ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 600, cacheReadTokens: 1500, cacheWriteTokens: 3000, cacheWrite1hTokens: 2000 }],
    });
  });

  it("counts every attempt when a fallback model finished the request, each at its own model's rate", () => {
    const u = anthropicUsage(
      {
        model: "claude-opus-4-8",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 900, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
          iterations: [
            { model: "claude-opus-5-5", input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 },
            { model: "claude-opus-4-8", input_tokens: 900, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          ],
        },
      },
      "claude-opus-5-5",
    );
    expect(u.fallback).toBe(true);
    expect(u.lines!.map((l) => l.model)).toEqual(["claude-opus-5-5", "claude-opus-4-8"]);
    const first = (900 * 4 + 40 * 20 + 2000 * 5) / 1e6;
    const second = (900 * 5 + 500 * 25) / 1e6;
    expect(u.lines!.reduce((n, l) => n + costOf(l.model, l).usd, 0)).toBeCloseTo(first + second, 8);
  });

  it("reads a device id only if it is one", () => {
    const request = (v: string | null) => ({ headers: { get: () => v } });
    expect(deviceFrom(request("0F8C2A51-7D3E-4B6A-9C1F-2E5D8A7B6C40"))).toBe("0f8c2a51-7d3e-4b6a-9c1f-2e5d8a7b6c40");
    expect(deviceFrom(request("someone@example.com"))).toBeNull();
    expect(deviceFrom(request(null))).toBeNull();
  });
});

/**
 * Records model calls, reads them back through the stats, and fires the spend
 * alert, against a real Postgres. Skipped unless ANALYTICS_TEST_DATABASE_URL
 * points at a scratch database (its ai_usage rows for apps "aitest" and
 * "alerttest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("model spend", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const d1 = "11111111-0000-4000-8000-000000000001";
  const d2 = "22222222-0000-4000-8000-000000000002";
  const row = (extra: object) => ({
    app: "aitest", env: "test", route: "reading", model: "claude-opus-5-5", fallback: false,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, outcome: "end_turn", device_id: null, ...extra,
  });

  beforeAll(async () => {
    // recordAiUsage finds the database the way the app does
    process.env.ANALYTICS_DATABASE_URL = url;
    await ensureSchema(sql);
    await sql`delete from ai_usage where app in ('aitest', 'alerttest')`;
    await sql`delete from ai_spend_alerts where app = 'alerttest'`;
    // Today: an Opus call with caching ($0.066), a big Haiku call ($2.50), an image at an exact price,
    // and a model with no price (2,000 input tokens at the highest listed rate, $15 a million: $0.03)
    await recordAiUsage({ app: "aitest", feature: "reading", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 10000, cacheWriteTokens: 4000, outcome: "end_turn", device: d1 });
    await recordAiUsage({ app: "aitest", feature: "portrait", model: "claude-haiku-4-5-20251001", inputTokens: 2_000_000, outputTokens: 100_000, outcome: "max_tokens", device: d2 });
    await recordAiUsage({ app: "aitest", feature: "image", provider: "other", model: "some-image-model", costUsd: 0.04 });
    await recordAiUsage({ app: "aitest", feature: "reading", provider: "other", model: "mystery-model-1", inputTokens: 2000, device: "not-a-device" });
    // Five days ago ($2.00), and 40 days ago ($2.00, the period before)
    await sql`insert into ai_usage ${sql([
      row({ ts: new Date(today - 5 * DAY + 12 * 3600000), input_tokens: 500_000, cost_usd: 2, device_id: d1 }),
      row({ ts: new Date(today - 40 * DAY + 12 * 3600000), output_tokens: 100_000, cost_usd: 2 }),
    ])}`;
  });

  afterAll(async () => {
    await sql`delete from ai_usage where app in ('aitest', 'alerttest')`;
    await sql`delete from ai_spend_alerts where app = 'alerttest'`;
    await sql.end();
  });

  it("adds up spend by period, feature, model and user", async () => {
    const { ai } = await appStats(sql, "aitest", "test", "UTC");
    expect(ai).toMatchObject({
      today: { usd: 2.636, calls: 4 },
      yesterday: { usd: 0 },
      calls30d: 5,
      costUsd30d: 4.636,
      costUsdPrevious30d: 2,
      costChange: 1.318,
      costUsdAllTime: 6.636,
      callsAllTime: 6,
      inputTokens30d: 2_503_000,
      outputTokens30d: 102_000,
      cacheReadTokens30d: 10_000,
      cacheWriteTokens30d: 4000,
      costPerCall30d: 0.9272,
      // Nobody has used this made-up app, so there's no one to divide by
      costPerActiveUser30d: null,
      // Two devices were named; their calls cost $4.566
      users30d: 2,
      costPerAiUser30d: 2.283,
      unpricedModels: ["mystery-model-1"],
    });
    expect(ai.monthToDate.usd).toBeGreaterThanOrEqual(2.636);
    expect(ai.byFeature30d).toEqual([
      { feature: "portrait", calls: 1, users: 1, costUsd: 2.5, costPerCall: 2.5, avgInputTokens: 2_000_000, avgOutputTokens: 100_000, cacheHitShare: 0 },
      // Prompts of 15,000 (10,000 of it from the cache), 2,000 and 500,000 tokens
      { feature: "reading", calls: 3, users: 1, costUsd: 2.096, costPerCall: 0.6987, avgInputTokens: 172_333, avgOutputTokens: 667, cacheHitShare: 0.019 },
      { feature: "image", calls: 1, users: 0, costUsd: 0.04, costPerCall: 0.04, avgInputTokens: 0, avgOutputTokens: 0, cacheHitShare: null },
    ]);
    expect(ai.byModel30d).toEqual([
      { model: "claude-haiku-4-5-20251001", calls: 1, fallbackCalls: 0, inputTokens: 2_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 2.5, priced: true },
      { model: "claude-opus-5-5", calls: 2, fallbackCalls: 0, inputTokens: 501_000, outputTokens: 2000, cacheReadTokens: 10_000, cacheWriteTokens: 4000, costUsd: 2.066, priced: true },
      { model: "some-image-model", calls: 1, fallbackCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.04, priced: true },
      { model: "mystery-model-1", calls: 1, fallbackCalls: 0, inputTokens: 2000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.03, priced: false },
    ]);
    expect(ai.outcomes30d).toEqual([
      { outcome: "end_turn", calls: 2 },
      { outcome: "unknown", calls: 2 },
      { outcome: "max_tokens", calls: 1 },
    ]);
    expect(ai.topUsers30d).toEqual([
      { device: "22222222", calls: 1, costUsd: 2.5 },
      { device: "11111111", calls: 2, costUsd: 2.066 },
    ]);
    expect(ai.byHour30d.reduce((n, h) => n + h.calls, 0)).toBe(5);
    expect(ai.daily).toHaveLength(30);
    expect(ai.daily.at(-1)).toEqual({ date: new Date(today).toISOString().slice(0, 10), calls: 4, costUsd: 2.636, users: 2 });
    expect(ai.daily.at(-6)).toMatchObject({ calls: 1, costUsd: 2, users: 1 });
    expect(ai.alert.sent).toEqual([]);
  });

  describe("the spend alert", () => {
    const posts: { title: string; body: string }[] = [];
    let server: Server;
    const add = (route: string, cost: number, n: number) =>
      sql`insert into ai_usage ${sql(Array.from({ length: n }, () => row({ app: "alerttest", env: "production", route, cost_usd: cost })))}`;

    beforeAll(async () => {
      server = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c)).on("end", () => {
          posts.push({ title: String(req.headers.title ?? ""), body });
          res.end("ok");
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      const { port } = server.address() as { port: number };
      process.env.SPEND_ALERT_NTFY_TOPIC = `http://127.0.0.1:${port}/alert-test`;
      process.env.SPEND_ALERT_USD = "10";
    });

    afterAll(() => {
      delete process.env.SPEND_ALERT_NTFY_TOPIC;
      delete process.env.SPEND_ALERT_USD;
      server.close();
    });

    it("stays quiet under the threshold", async () => {
      await add("reading", 0.02, 100); // $2
      expect(await checkSpendAlert(sql, "production", "alerttest")).toBe(false);
      expect(posts).toHaveLength(0);
    });

    it("alerts once when month-to-date spend passes $10, and again past $20", async () => {
      await add("portrait", 0.5, 17); // +$8.50 → $10.50
      expect(await checkSpendAlert(sql, "production", "alerttest")).toBe(true);
      expect(await checkSpendAlert(sql, "production", "alerttest")).toBe(false);
      expect(posts).toHaveLength(1);
      expect(posts[0].title).toBe("Alerttest AI spend passed $10.00 this month");
      expect(posts[0].body).toContain("$10.50 so far");
      expect(posts[0].body).toContain("reading 100 · portrait 17");

      await add("together", 1, 10); // → $20.50
      expect(await checkSpendAlert(sql, "production", "alerttest")).toBe(true);
      expect(posts[1].title).toBe("Alerttest AI spend passed $20.00 this month");
    });

    it("never alerts outside production, and shows what was sent in the stats", async () => {
      expect(await checkSpendAlert(sql, "preview", "alerttest")).toBe(false);
      const { ai } = await appStats(sql, "alerttest", "production", "UTC");
      expect(ai.monthToDate).toEqual({ usd: 20.5, calls: 127 });
      expect(ai.alert).toMatchObject({ thresholdUsd: 10, channels: { ntfy: true, webhook: false } });
      expect(ai.alert.sent.map((a) => a.level)).toEqual([2, 1]);
    });
  });
});
