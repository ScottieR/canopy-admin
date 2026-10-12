// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import { routeSource } from "./events";
import { appStats, KIT } from "./server/metrics";

/**
 * Runs the stats SQL against a real Postgres. Skipped unless
 * ANALYTICS_TEST_DATABASE_URL points at a scratch database (its
 * analytics_events rows for app "test" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("appStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  /** Noon on a past day, or a minute ago for today */
  const at = (daysAgo: number, minute = 0) => new Date(daysAgo === 0 ? Date.now() - 60000 + minute * 1000 : today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [A, B, C, K] = [1, 2, 3, 4].map(id);

  type Ev = [device: string, session: number, daysAgo: number, name: string, path: string, props?: object, mode?: string];
  const events: Ev[] = [
    // A: first seen 10 days ago, back the next day (a bounce), and today
    [A, 1, 10, "pageview", "/"],
    [A, 1, 10, "engage", "/", { ms: 20000 }],
    [A, 1, 10, "pageview", "/reading"],
    [A, 1, 10, "engage", "/reading", { ms: 40000 }],
    [A, 2, 9, "pageview", "/"],
    [A, 2, 9, "engage", "/", { ms: 5000 }],
    [A, 3, 0, "pageview", "/daily"],
    [A, 3, 0, "engage", "/daily", { ms: 30000 }],
    [A, 3, 0, "share_created", "/daily", { kind: "backup", method: "copy" }],
    // B: arrived from a shared link 3 days ago, never came back
    [B, 4, 3, "pageview", "/open"],
    [B, 4, 3, "share_opened", "/open", { kind: "takeaway" }],
    [B, 4, 3, "pageview", "/readings/[id]"],
    [B, 4, 3, "engage", "/readings/[id]", { ms: 60000 }],
    // C: new today, two sessions, the first a bounce
    [C, 5, 0, "pageview", "/"],
    [C, 5, 0, "engage", "/", { ms: 2000 }],
    [C, 6, 0, "pageview", "/cards"],
    [C, 6, 0, "pageview", "/cards/the-fool"],
    [C, 6, 0, "engage", "/cards/the-fool", { ms: 15000 }],
    // K: the farm iPad
    [K, 7, 0, "pageview", "/guest", {}, "kiosk"],
    [K, 7, 0, "engage", "/guest", { ms: 120000 }, "kiosk"],
    [K, 7, 0, "reading_drawn", "/guest", { spread: "three" }, "kiosk"],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'test'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, s, daysAgo, name, path, props = {}, mode = "app"], i) => ({
        app: "test",
        env: "test",
        ts: at(daysAgo, i),
        device_id: device,
        session_id: id(100 + s),
        name,
        path,
        props: sql.json(props as postgres.JSONValue),
        mode,
        standalone: s === 3,
        referrer: s === 1 ? "instagram.com" : null,
        country: "US",
        device_type: device === K ? "tablet" : "mobile",
        // B's rows are from before the kit recorded these
        browser: device === B ? null : device === K ? "Mobile Safari" : "Chrome",
        os: device === B ? null : device === K ? "iOS" : "Android",
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app in ('test', 'pagetest', 'bouncetest', 'onetest')`;
    await sql.end();
  });

  it("counts users, actives and stickiness", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    expect(s.totals).toEqual({ users: 4, sessions: 7, pageviews: 10 });
    expect(s.active).toMatchObject({ dau: 3, dauYesterday: 0, wau: 4, mau: 4 });
    // 6 device-days over the 11 days since launch, ÷ 4 monthly users
    expect(s.active.stickiness).toBeCloseTo(6 / 11 / 4, 3);
    const day = s.daily.at(-1)!;
    expect(s.daily).toHaveLength(90);
    expect(day).toMatchObject({ users: 3, newUsers: 2, returningUsers: 1, sessions: 4, pageviews: 5, mau: 4 });
  });

  it("reads the numbers with and without the owner's own devices, still counting them by default", async () => {
    await sql`delete from analytics_owner_devices where app = 'test'`;
    expect((await appStats(sql, "test", "test", "UTC")).owner).toEqual({ devices: 0, excluded: false });
    // A is the owner's phone (?track=me)
    await sql`insert into analytics_owner_devices (app, device_id) values ('test', ${A})`;
    const all = await appStats(sql, "test", "test", "UTC");
    expect(all.owner).toEqual({ devices: 1, excluded: false });
    expect(all.totals.users).toBe(4);
    const others = await appStats(sql, "test", "test", "UTC", true);
    expect(others.owner).toEqual({ devices: 1, excluded: true });
    expect(others.totals).toEqual({ users: 3, sessions: 4, pageviews: 6 });
    expect(others.active).toMatchObject({ dau: 2, wau: 3, mau: 3 });
    // A's share is the owner's: counted with them, gone without
    expect(all.shares.created30d).toBeGreaterThan(others.shares.created30d);
    await sql`delete from analytics_owner_devices where app = 'test'`;
  });

  it("measures engagement", async () => {
    const { engagement } = await appStats(sql, "test", "test", "UTC");
    expect(engagement.sessions).toBe(7);
    expect(engagement.sessionsPerUser).toBeCloseTo(7 / 4, 3);
    expect(engagement.avgSessionSeconds).toBeCloseTo(292 / 7, 0);
    expect(engagement.medianSessionSeconds).toBe(30);
    expect(engagement.pagesPerSession).toBeCloseTo(10 / 7, 1);
    expect(engagement.bounceRate).toBeCloseTo(2 / 7, 3);
    expect(engagement.avgDailySecondsPerUser).toBeCloseTo(292 / 6, 0);
  });

  it("counts a bounce as GA4 does: a key event saves a short one-page session, the tracker's own events don't", async () => {
    await sql`delete from analytics_events where app = 'bouncetest'`;
    const rows: [session: number, names: string[]][] = [
      [1, ["pageview", "engage", "reading_drawn"]],   // 3s, but drew a reading: engaged
      [2, ["pageview", "engage"]],                    // bounce
      [3, ["pageview", "engage", "share_opened"]],    // opened from a shared link, left: bounce
      [4, ["pageview", "engage", "share_offered"]],   // a link shown on screen, nothing done: bounce
    ];
    await sql`insert into analytics_events ${sql(rows.flatMap(([s, names]) => names.map((name, i) => ({
      app: "bouncetest", env: "test", ts: new Date(Date.now() - 3600000 + s * 60000 + i * 1000),
      device_id: id(900 + s), session_id: id(950 + s), name, path: "/",
      props: sql.json(name === "engage" ? { ms: 3000 } : {}), mode: "app",
    }))))}`;
    const { engagement } = await appStats(sql, "bouncetest", "test", "UTC");
    expect(engagement.sessions).toBe(4);
    expect(engagement.bounceRate).toBe(0.75);
  });

  it("finds the one-and-done: a first session that bounced, with no return inside 7 days", async () => {
    await sql`delete from analytics_events where app = 'onetest'`;
    // [device, session, days ago, engaged?]
    const visits: [number, number, number, boolean][] = [
      [1, 1, 20, false],                     // bounced, never back: one-and-done
      [2, 2, 20, false], [2, 3, 18, true],   // bounced, back 2 days later
      [3, 4, 20, false], [3, 5, 10, true],   // bounced, back only after 10 days: one-and-done
      [4, 6, 20, true],                      // engaged first time, never back
      [5, 7, 3, false],                      // bounced 3 days ago: too soon to tell
    ];
    await sql`insert into analytics_events ${sql(visits.flatMap(([d, s, daysAgo, engaged]) => [
      ["pageview", {}], ["engage", { ms: engaged ? 30000 : 2000 }],
    ].map(([name, props], i) => ({
      app: "onetest", env: "test", ts: at(daysAgo, s * 2 + i), device_id: id(800 + d), session_id: id(850 + s),
      name: name as string, path: "/", props: sql.json(props as postgres.JSONValue), mode: "app",
    }))))}`;
    const { retention } = await appStats(sql, "onetest", "test", "UTC");
    expect(retention.oneAndDone).toBe(0.5);
    // The main fixture's only eligible user (A) was engaged the first time
    expect((await appStats(sql, "test", "test", "UTC")).retention.oneAndDone).toBe(0);
  });

  it("measures retention", async () => {
    const { retention } = await appStats(sql, "test", "test", "UTC");
    expect(retention.returnedWithin1Day).toBe(0.5);
    expect(retention.returnedWithin7Days).toBe(1);
    expect(retention.returnedWithin30Days).toBeNull();
    expect(retention.cohorts.reduce((n, c) => n + c.users, 0)).toBe(4);
    for (const c of retention.cohorts) expect(c.weeks).toHaveLength(8);
  });

  it("counts shares and where people came from", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    expect(s.shares).toMatchObject({ created30d: 1, opened30d: 1, createdAllTime: 1, openedAllTime: 1, newUsersFromShares30d: 1 });
    expect(s.shares.byKind30d).toEqual([{ kind: "backup", method: "copy", created: 1 }]);
    expect(s.events.map((e) => e.name).sort()).toEqual(["reading_drawn", "share_created", "share_opened"]);
    expect(s.modes).toEqual(expect.arrayContaining([{ mode: "kiosk", sessions: 1, users: 1 }]));
    expect(s.topPages[0]).toMatchObject({ path: "/", views: 3, users: 2 });
    expect(s.referrers).toEqual([{ referrer: "instagram.com", sessions: 1 }]);
    expect(s.standaloneShare).toBeCloseTo(1 / 7, 3);
    expect(s.devices).toEqual(expect.arrayContaining([{ type: "tablet", users: 1 }]));
  });

  it("compares this period with the one before", async () => {
    const { growth, kit } = await appStats(sql, "test", "test", "UTC");
    expect(kit).toBe(KIT);
    // A was the only user 10 and 9 days ago; B, C and the kiosk are new this week
    expect(growth).toMatchObject({ wauPrevious: 1, wauChange: 3, mauPrevious: 0, mauChange: null });
    expect(growth).toMatchObject({ newUsers7d: 3, newUsersPrevious7d: 1, newUsers7dChange: 2, newUsers30d: 4, newUsersPrevious30d: 0, newUsers30dChange: null });
  });

  it("accounts for each week's users and how many days people are active", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    expect(s.lifecycle).toHaveLength(8);
    expect(s.lifecycle.reduce((n, w) => n + w.new, 0)).toBe(4);
    for (const w of s.lifecycle) expect(w.active).toBe(w.new + w.retained + w.resurrected);
    // Whatever weekday the test runs on: last week's users either stayed or churned
    s.lifecycle.slice(1).forEach((w, i) => expect(w.retained + w.churned).toBe(s.lifecycle[i].active));
    expect(s.lifecycle.at(-1)!.active).toBeGreaterThanOrEqual(3);
    // A: 3 different days; B, C and the kiosk: one each
    expect(s.activeDays30d).toEqual([
      { days: "1", users: 3 },
      { days: "2-3", users: 1 },
      { days: "4-7", users: 0 },
      { days: "8-14", users: 0 },
      { days: "15-30", users: 0 },
    ]);
    // Only A is 7+ days old, and wasn't here on day 7
    expect(s.retention).toMatchObject({ day7: 0, day30: null });
  });

  it("measures time spent and entries and exits per page", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    expect(s.engagement.totalSeconds).toBe(292);
    // "/": A twice (20 s, then 5 s) and C once (2 s). A's first session left from /reading.
    expect(s.topPages[0]).toEqual({
      path: "/", views: 3, users: 2, avgSeconds: 9, dynamic: false, sessions: 3, totalSeconds: 27, medianSeconds: 5,
      secondsPerUser: 13.5, timeShare: 0.092, entries: 3, exits: 2, exitRate: 0.667,
    });
    const detail = s.topPages.find((p) => p.path === "/readings/[id]")!;
    expect(detail).toMatchObject({ dynamic: true, views: 1, totalSeconds: 60, entries: 0, exits: 1, exitRate: 1 });
    // Viewed but never timed: no average rather than zero
    expect(s.topPages.find((p) => p.path === "/cards")).toMatchObject({ views: 1, avgSeconds: null, totalSeconds: 0, medianSeconds: 0 });
    expect(s.topPages.reduce((n, p) => n + p.entries, 0)).toBe(7);
  });

  it("folds record pages into one row per route, including rows recorded before the route was declared", async () => {
    const uuid = "0f8c2a51-7d3e-4b6a-9c1f-2e5d8a7b6c40";
    const paths = ["/people/123", "/people/456", `/items/${uuid}/edit`, `/items/${id(9)}/edit`, "/cards/the-fool"];
    await sql`delete from analytics_events where app = 'pagetest'`;
    await sql`insert into analytics_events ${sql(
      paths.flatMap((path, i) => [
        { app: "pagetest", env: "test", ts: at(1, i), device_id: id(50 + i), session_id: id(150 + i), name: "pageview", path, props: sql.json({}), mode: "app" },
        { app: "pagetest", env: "test", ts: at(1, i + 1), device_id: id(50 + i), session_id: id(150 + i), name: "engage", path, props: sql.json({ ms: 10000 }), mode: "app" },
      ]),
    )}`;
    const { topPages } = await appStats(sql, "pagetest", "test", "UTC");
    expect(topPages.map((p) => [p.path, p.views, p.users, p.totalSeconds, p.dynamic])).toEqual([
      ["/items/[id]/edit", 2, 2, 20, true],
      ["/people/[id]", 2, 2, 20, true],
      ["/cards/the-fool", 1, 1, 10, false],
    ]);
    // A declared pattern is matched by the same expression in the tracker and in Postgres
    const [{ short, deeper }] = await sql`select ${"/r/x7Kp2"} ~ ${routeSource("/r/[code]")} short, ${"/r/x7Kp2/print"} ~ ${routeSource("/r/[code]")} deeper`;
    expect([short, deeper]).toEqual([true, false]);
    expect(new RegExp(routeSource("/r/[code]")).test("/r/x7Kp2/")).toBe(true);
  });

  it("shows where new users came from and how far shares travel", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    // A arrived from Instagram and came back; B opened a shared link; C and the kiosk came directly
    expect(s.acquisition).toEqual([
      { source: "direct", newUsers: 2, returned: 0, returnRate: 0 },
      { source: "instagram.com", newUsers: 1, returned: 1, returnRate: 1 },
      { source: "share", newUsers: 1, returned: 0, returnRate: 0 },
    ]);
    expect(s.campaigns).toEqual([]);
    expect(s.shares).toMatchObject({ sharers30d: 1, shareRate30d: 0.25, opensPerShare30d: 1, kFactor30d: 0.25 });
  });

  it("breaks users down by browser and system, and sessions by hour and weekday", async () => {
    const s = await appStats(sql, "test", "test", "UTC");
    expect(s.browsers).toEqual([
      { browser: "Chrome", users: 2 },
      { browser: "Mobile Safari", users: 1 },
      { browser: "unknown", users: 1 },
    ]);
    expect(s.operatingSystems).toEqual([
      { os: "Android", users: 2 },
      { os: "iOS", users: 1 },
      { os: "unknown", users: 1 },
    ]);
    expect(s.usageByHour.map((h) => h.hour)).toEqual([...Array(24).keys()]);
    expect(s.usageByHour.reduce((n, h) => n + h.sessions, 0)).toBe(7);
    // The three sessions on earlier days all started at noon
    expect(s.usageByHour[12].sessions).toBeGreaterThanOrEqual(3);
    expect(s.usageByWeekday.map((d) => d.weekday)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(s.usageByWeekday.reduce((n, d) => n + d.sessions, 0)).toBe(7);
  });

  it("reports no model spend for an app that makes no model calls", async () => {
    const { ai } = await appStats(sql, "test", "test", "UTC");
    expect(ai).toMatchObject({ calls30d: 0, costUsd30d: 0, costChange: null, costPerCall30d: null, byFeature30d: [], byModel30d: [], unpricedModels: [] });
    expect(ai.monthToDate).toEqual({ usd: 0, calls: 0 });
    expect(ai.daily).toHaveLength(30);
    expect(ai.daily.at(-1)).toMatchObject({ calls: 0, costUsd: 0, users: 0 });
  });
});
