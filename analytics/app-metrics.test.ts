// app-analytics kit v8: this file is this app's own.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import { appStats } from "./server/metrics";

/**
 * Canopy's own metrics, and its declared funnel, features and activation (flows.ts), against a real
 * Postgres. Skipped without ANALYTICS_TEST_DATABASE_URL.
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("Canopy appMetrics", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const APP = "canopytest";
  const DAY = 86400000;
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const at = (daysAgo: number, i: number) => new Date(todayStart - daysAgo * DAY + 12 * 3600000 + i * 1000);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [A, B, C] = [21, 22, 23].map(id);

  type Ev = [device: string, daysAgo: number, name: string, path: string, props?: object];
  const events: Ev[] = [
    // A goes the whole way and carries on
    [A, 5, "pageview", "/onboarding"],
    [A, 5, "onboarding_step_completed", "/onboarding", { step: "discovery" }],
    [A, 5, "onboarding_step_completed", "/onboarding", { step: "powerup" }],
    [A, 5, "agent_created", "/onboarding", { role: "Researcher", imported: false }],
    [A, 5, "reply_received", "/architect/overview", { starter: true }],
    [A, 4, "reply_received", "/architect/overview", { starter: false }],
    [A, 4, "reply_received", "/architect/overview", { starter: false }],
    [A, 4, "agent_created", "/onboarding", { role: "custom", imported: false }],
    [A, 3, "connection_added", "/architect/connections", { type: "slack" }],
    [A, 3, "connection_added", "/architect/connections", { type: "github" }],
    [A, 2, "forum_created", "/forum", { agents: 2 }],
    [A, 2, "forum_completed", "/forum"],
    [A, 2, "forum_completed", "/forum"], // a follow-up run
    // B deploys but never hears back; imports a second agent
    [B, 3, "pageview", "/onboarding"],
    [B, 3, "onboarding_step_completed", "/onboarding", { step: "discovery" }],
    [B, 3, "onboarding_step_completed", "/onboarding", { step: "powerup" }],
    [B, 3, "agent_created", "/onboarding", { role: "Researcher", imported: false }],
    [B, 2, "agent_created", "/onboarding", { role: "custom", imported: true }],
    [B, 2, "connection_added", "/architect/connections", { type: "slack" }],
    [B, 1, "forum_created", "/forum", { agents: 3 }],
    // C stops at discovery
    [C, 1, "pageview", "/onboarding"],
    [C, 1, "onboarding_step_completed", "/onboarding", { step: "discovery" }],
    // Older than the window: left out of every 30-day number
    [C, 40, "agent_created", "/onboarding", { role: "Coder", imported: false }],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = ${APP}`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, name, path, props = {}], i) => ({
        app: APP, env: "test", ts: at(daysAgo, i), device_id: device, session_id: id(500 + daysAgo), name, path, props: sql.json(props as postgres.JSONValue), mode: "app",
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app = ${APP}`;
    await sql.end();
  });

  it("reports agents, connections, forums and replies", async () => {
    const { appMetrics } = await appStats(sql, APP, "test", "UTC");
    expect(appMetrics).toEqual({
      agents: {
        created30d: 4,
        imported30d: 1,
        perCreator30d: 2,
        byRole30d: [
          { role: "Researcher", agents: 2, users: 2 },
          { role: "custom", agents: 2, users: 2 },
        ],
      },
      connections: {
        byType30d: [
          { type: "slack", connections: 2, users: 2 },
          { type: "github", connections: 1, users: 1 },
        ],
      },
      forums: { created30d: 2, completedRuns30d: 2, completedPerCreated30d: 1, perCreator30d: 1, agentsPerForum30d: 2.5 },
      replies: { total30d: 3, perUser30d: 3, fromStarterTask30d: 0.333 },
    });
  });

  it("measures the first-agent funnel, features and activation as declared in flows.ts", async () => {
    const { flows } = await appStats(sql, APP, "test", "UTC");
    const [funnel] = flows.funnels;
    expect(funnel.key).toBe("onboarding");
    expect(funnel.steps.map((s) => s.users)).toEqual([3, 3, 2, 2, 1]);
    expect(funnel.completed).toBe(1);
    expect(Object.fromEntries(flows.features.map((f) => [f.key, f.adoption.users]))).toEqual({
      agents: 3, chat: 1, forums: 2, connections: 2, companions: 0, publishing: 0,
    });
    expect(flows.activation?.allTime.activated).toBe(1);
  });
});
