// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import { flowStats, type Activation, type Feature, type Funnel } from "./server/flow-metrics";

/**
 * Runs the flow SQL against a real Postgres, with a made-up onboarding funnel
 * and feature. Skipped unless ANALYTICS_TEST_DATABASE_URL points at a scratch
 * database (its analytics_events rows for app "flowtest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("flowStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const at = (daysAgo: number, minute = 0) => new Date(daysAgo === 0 ? Date.now() - 60000 + minute * 1000 : today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6].map(id);
  const date = (daysAgo: number) => new Date(today - daysAgo * DAY).toISOString().slice(0, 10);

  const funnels = [
    {
      key: "onboarding",
      label: "Onboarding",
      steps: [
        { key: "welcome", label: "Welcome", event: "pageview", path: "/welcome" },
        { key: "profile", label: "Profile", event: "onboarding_step_completed", where: { step: "profile" } },
        { key: "first", label: "First reading", event: "reading_drawn" },
      ],
    },
  ] as unknown as Funnel[];
  const features = [
    { key: "reading", label: "Readings", event: "reading_drawn" },
    { key: "daily", label: "Daily card", event: "daily_drawn", dayProp: "day" },
    { key: "daily_server_days", label: "Daily card by server day", event: "daily_drawn" },
  ] as unknown as Feature[];

  type Ev = [device: string, daysAgo: number, minute: number, name: string, path?: string, props?: object];
  const events: Ev[] = [
    // A: full funnel 5 days ago in 3 minutes, then a reading every day since (6-day run, alive)
    [A, 5, 0, "pageview", "/welcome"],
    [A, 5, 1, "onboarding_step_completed", "/welcome", { step: "profile" }],
    [A, 5, 3, "reading_drawn", "/"],
    [A, 4, 0, "reading_drawn", "/"],
    [A, 3, 0, "reading_drawn", "/"],
    [A, 2, 0, "reading_drawn", "/"],
    [A, 1, 0, "reading_drawn", "/"],
    [A, 0, 0, "reading_drawn", "/"],
    [A, 0, 1, "reading_drawn", "/"],
    // B: welcome and profile, never a reading
    [B, 3, 0, "pageview", "/welcome"],
    [B, 3, 2, "onboarding_step_completed", "/welcome", { step: "profile" }],
    // C: welcome only; a different step prop must not count
    [C, 2, 0, "pageview", "/welcome"],
    [C, 2, 1, "onboarding_step_completed", "/welcome", { step: "other" }],
    // D: a reading BEFORE the welcome page: out of order, so not a completion. Reading run of 2, ended 9 days ago
    [D, 10, 0, "reading_drawn", "/"],
    [D, 9, 0, "reading_drawn", "/"],
    [D, 8, 0, "pageview", "/welcome"],
    [D, 8, 1, "onboarding_step_completed", "/welcome", { step: "profile" }],
    // E: full funnel 40 days ago (all time only), a reading then and one 38 days ago
    [E, 40, 0, "pageview", "/welcome"],
    [E, 40, 5, "onboarding_step_completed", "/welcome", { step: "profile" }],
    [E, 40, 9, "reading_drawn", "/"],
    [E, 38, 0, "reading_drawn", "/"],
    // F: lives west of the stats time zone. Three evenings running by their own calendar; the second
    // lands on the next server day. A fourth event carries a date that can't be right and is ignored.
    [F, 3, 0, "daily_drawn", "/daily", { day: date(3) }],
    [F, 1, -540, "daily_drawn", "/daily", { day: date(2) }],
    [F, 1, 480, "daily_drawn", "/daily", { day: date(1) }],
    [F, 1, 481, "daily_drawn", "/daily", { day: "2026-02-31" }],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'flowtest'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, minute, name, path = "/", props = {}]) => ({
        app: "flowtest",
        env: "test",
        ts: at(daysAgo, minute),
        device_id: device,
        session_id: id(100 + daysAgo),
        name,
        path,
        props: sql.json(props as postgres.JSONValue),
        mode: "app",
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app in ('flowtest', 'acttest')`;
    await sql.end();
  });

  it("measures the funnel step by step and end to end", async () => {
    const { funnels: [f] } = await flowStats(sql, "flowtest", "test", { funnels, features }, "UTC");
    expect(f.entered).toBe(4);
    expect(f.steps.map((s) => s.users)).toEqual([4, 3, 1]);
    expect(f.steps.map((s) => s.fromPrevious)).toEqual([null, 0.75, 0.333]);
    expect(f.steps.map((s) => s.dropoff)).toEqual([null, 0.25, 0.667]);
    expect(f.steps.map((s) => s.fromStart)).toEqual([1, 0.75, 0.25]);
    expect(f.completed).toBe(1);
    expect(f.completionRate).toBe(0.25);
    expect(f.medianSecondsToComplete).toBe(180);
    expect(f.allTime).toEqual({ entered: 5, completed: 2, completionRate: 0.4 });
  });

  it("measures feature adoption, engagement and streaks", async () => {
    const s = await flowStats(sql, "flowtest", "test", { funnels, features }, "UTC");
    const r = s.features[0];
    expect(r.adoption).toEqual({ users: 3, rate: 0.5, users30d: 2, rate30d: 0.4, newUsers30d: 2 });
    expect(r.engagement.uses30d).toBe(9);
    expect(r.engagement.usesPerUser30d).toBe(4.5);
    expect(r.engagement.daysPerUser30d).toBe(4);
    expect(r.engagement.repeatRate).toBe(1);
    // D (first use 10 days ago, back the next day) and E (back 2 days later); A isn't 7 days old yet
    expect(r.engagement.repeatedWithin7Days).toBe(1);
    expect(r.engagement.weekly).toHaveLength(8);
    expect(r.engagement.weekly.reduce((n, w) => n + w.uses, 0)).toBe(11);
    expect(r.streaks).toMatchObject({ onStreak: 1, onStreak7: 0, medianCurrent: 6, longest: 6, medianLongest: 2 });
    expect(r.streaks.byLongest).toEqual([
      { days: "1", users: 1 },
      { days: "2", users: 1 },
      { days: "3-6", users: 1 },
      { days: "7-13", users: 0 },
      { days: "14-29", users: 0 },
      { days: "30+", users: 0 },
    ]);
    // Any event: A 6 days running; D 3 days (10, 9, 8 days ago); B, C, E and F one day at a time
    expect(s.appStreaks).toMatchObject({ onStreak: 1, longest: 6 });
    expect(s.appStreaks.byLongest[0]).toEqual({ days: "1", users: 4 });
  });

  it("counts a daily habit by the device's own calendar when the event carries it", async () => {
    const { features: [, device, server] } = await flowStats(sql, "flowtest", "test", { funnels, features }, "UTC");
    expect(device.streaks).toMatchObject({ onStreak: 1, medianCurrent: 3, longest: 3 });
    expect(device.engagement.daysPerUser30d).toBe(3);
    expect(server.streaks).toMatchObject({ onStreak: 0, medianCurrent: 1, longest: 1 });
    expect(server.engagement.daysPerUser30d).toBe(2);
  });

  it("answers with empty lists when nothing is declared or recorded", async () => {
    const s = await flowStats(sql, "nothing-here", "test", { funnels, features }, "UTC");
    expect(s.funnels[0]).toMatchObject({ entered: 0, completed: 0, completionRate: null, medianSecondsToComplete: null });
    expect(s.features[0].adoption).toEqual({ users: 0, rate: null, users30d: 0, rate30d: null, newUsers30d: 0 });
    expect(s.appStreaks).toMatchObject({ onStreak: 0, longest: 0, medianCurrent: null });
  });

  it("measures activation, and whether activating on day one goes with coming back", async () => {
    const [P, Q, R, S, U] = [21, 22, 23, 24, 25].map(id);
    const rows: Ev[] = [
      // P: activates five minutes in, back two days later
      [P, 10, 0, "pageview"],
      [P, 10, 5, "project_created"],
      [P, 8, 0, "pageview"],
      // Q: activates on the second visit, exactly two days in
      [Q, 10, 0, "pageview"],
      [Q, 8, 0, "project_created"],
      // R: never activates, never returns
      [R, 9, 0, "pageview"],
      // S: new two days ago, activates within a minute
      [S, 2, 0, "pageview"],
      [S, 2, 1, "project_created"],
      // U: long ago; activates in ten minutes, back three weeks later
      [U, 40, 0, "pageview"],
      [U, 40, 10, "project_created"],
      [U, 20, 0, "pageview"],
    ];
    await sql`delete from analytics_events where app = 'acttest'`;
    await sql`insert into analytics_events ${sql(
      rows.map(([device, daysAgo, minute, name]) => ({
        app: "acttest", env: "test", ts: at(daysAgo, minute), device_id: device, session_id: id(300 + daysAgo), name, path: "/", props: sql.json({}), mode: "app",
      })),
    )}`;
    const activation = { label: "Created a project", event: "project_created" } as unknown as Activation;
    const s = await flowStats(sql, "acttest", "test", { funnels: [], features: [], activation }, "UTC");
    expect(s.activation).toEqual({
      label: "Created a project",
      // P, Q, R and S are new this month; R hasn't activated
      newUsers30d: 4,
      activated30d: 3,
      rate30d: 0.75,
      // Within a day: P, S and U of all five. Within a week: P, Q and U of the four old enough to judge.
      rateWithin1Day: 0.6,
      rateWithin7Days: 0.75,
      // 60 s, 300 s, 600 s and two days
      medianSecondsToActivate: 450,
      allTime: { users: 5, activated: 4, rate: 0.8 },
      retention: {
        // P and U activated on day one: P came back within a week, U only within the month
        activated: { users: 2, returnedWithin7Days: 0.5, returnedWithin30Days: 1 },
        // Q (who came back) and R (who didn't); neither is 30 days old yet
        notActivated: { users: 2, returnedWithin7Days: 0.5, returnedWithin30Days: null },
      },
    });
    // Any one of several events can count: everyone here has a pageview, so everyone is activated on arrival
    const either = { label: "Did anything", anyOf: [{ event: "project_created" }, { event: "pageview" }] } as unknown as Activation;
    const any = (await flowStats(sql, "acttest", "test", { funnels: [], features: [], activation: either }, "UTC")).activation!;
    expect(any).toMatchObject({ allTime: { users: 5, activated: 5, rate: 1 }, medianSecondsToActivate: 0, rateWithin1Day: 1 });
    // No activation event named: nothing to report
    expect((await flowStats(sql, "acttest", "test", { funnels: [], features: [] }, "UTC")).activation).toBeNull();
  });
});
