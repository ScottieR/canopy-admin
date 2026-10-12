// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import { timelineStats } from "./server/timeline-metrics";

/**
 * Runs the timeline SQL against a real Postgres. Skipped unless
 * ANALYTICS_TEST_DATABASE_URL points at a scratch database (its
 * analytics_events rows for app "timelinetest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("timelineStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const date = (daysAgo: number) => new Date(today - daysAgo * DAY).toISOString().slice(0, 10);
  const at = (daysAgo: number, minute: number) => new Date(daysAgo === 0 ? Date.now() - 60000 + minute * 1000 : today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const A = "aaaaaaaa-0000-4000-8000-000000000001";
  const B = "bbbbbbbb-0000-4000-8000-000000000002";

  type Ev = [device: string, daysAgo: number, name: string, props?: object, referrer?: string];
  const events: Ev[] = [
    // B: came directly 40 days ago, and made a project yesterday
    [B, 40, "pageview"],
    // A: arrived from Instagram yesterday and made two projects, then one more today
    [A, 1, "pageview", {}, "instagram.com"],
    [A, 1, "project_created", { template: "blank" }, "instagram.com"],
    [A, 1, "project_created", { template: "blank" }, "instagram.com"],
    [A, 1, "engage", { ms: 40000 }, "instagram.com"],
    [B, 1, "project_created", { template: "tour" }],
    [A, 0, "pageview"],
    [A, 0, "engage", { ms: 5000 }],
    [A, 0, "project_created", { template: "tour" }],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'timelinetest'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, name, props = {}, referrer = null], i) => ({
        app: "timelinetest",
        env: "test",
        ts: at(daysAgo, i),
        device_id: device,
        session_id: `${device.slice(0, 24)}${String(100000000000 + daysAgo)}`,
        name,
        path: "/",
        props: sql.json(props as postgres.JSONValue),
        mode: "app",
        referrer,
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app = 'timelinetest'`;
    await sql.end();
  });

  it("puts every event on shared day, week and month axes", async () => {
    const { timeline } = await timelineStats(sql, "timelinetest", "test", "UTC");
    expect(timeline.days).toHaveLength(90);
    expect(timeline.days.at(-1)).toBe(date(0));
    expect(timeline.days[0]).toBe(date(89));
    expect(timeline.weeks).toHaveLength(26);
    // Mondays, a week apart, ending with the week today is in
    expect(timeline.weeks.every((w) => new Date(w + "T00:00:00Z").getUTCDay() === 1)).toBe(true);
    expect(today - new Date(timeline.weeks.at(-1)! + "T00:00:00Z").getTime()).toBeLessThan(7 * DAY);
    expect(timeline.months).toHaveLength(12);
    expect(timeline.months.at(-1)).toBe(date(0).slice(0, 7));

    // Time on a page isn't an event; the rest come most frequent first
    expect(timeline.events.map((e) => [e.name, e.total])).toEqual([
      ["project_created", 4],
      ["pageview", 3],
    ]);
    const [made, views] = timeline.events;
    for (const s of [made.daily, made.weekly, made.monthly]) expect(s.count.reduce((n, c) => n + c, 0)).toBe(4);
    // Yesterday: three projects by two people. Today: one.
    expect(made.daily.count.slice(-2)).toEqual([3, 1]);
    expect(made.daily.users.slice(-2)).toEqual([2, 1]);
    // A made projects on two days of what may be one week: still one user that week, so never more than two
    expect(Math.max(...made.weekly.users)).toBe(2);
    expect(Math.max(...made.monthly.users)).toBe(2);
    // B's first visit, 40 days back
    expect(views.daily.count[89 - 40]).toBe(1);
    expect(views.daily.count.reduce((n, c) => n + c, 0)).toBe(3);
    expect(made.daily.count).toHaveLength(90);
    expect(made.weekly.users).toHaveLength(26);
    expect(made.monthly.count).toHaveLength(12);
  });

  it("lists the latest events one by one, each with its time and its user's source", async () => {
    const { recentEvents } = await timelineStats(sql, "timelinetest", "test", "UTC");
    expect(recentEvents.map((e) => [e.name, e.user])).toEqual([
      ["project_created", "aaaaaaaa"],
      ["pageview", "aaaaaaaa"],
      ["project_created", "bbbbbbbb"],
      ["project_created", "aaaaaaaa"],
      ["project_created", "aaaaaaaa"],
      ["pageview", "aaaaaaaa"],
      ["pageview", "bbbbbbbb"],
    ]);
    expect(recentEvents[0]).toMatchObject({ path: "/", mode: "app", props: { template: "tour" }, source: "instagram.com", firstSeen: date(1) });
    expect(recentEvents[2]).toMatchObject({ props: { template: "tour" }, source: "direct", firstSeen: date(40) });
    // Real timestamps, newest first
    const times = recentEvents.map((e) => Date.parse(e.at));
    expect(times.every((t) => Number.isFinite(t))).toBe(true);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("copes with an app nobody has used", async () => {
    const empty = await timelineStats(sql, "nobody-here", "test", "UTC");
    expect(empty.timeline.events).toEqual([]);
    expect(empty.timeline.days).toHaveLength(90);
    expect(empty.recentEvents).toEqual([]);
  });
});
