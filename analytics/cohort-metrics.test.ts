// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cohortStats } from "./server/cohort-metrics";
import { ensureSchema } from "./server/db";
import type { Activation, Feature } from "./server/flow-metrics";

/**
 * Runs the cohort and share-funnel SQL against a real Postgres, with a
 * made-up activation event and features. Skipped unless
 * ANALYTICS_TEST_DATABASE_URL points at a scratch database (its
 * analytics_events rows for app "cohorttest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("cohortStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const at = (daysAgo: number, minute: number) => new Date(today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [A, B, C, D, E, F, G] = [1, 2, 3, 4, 5, 6, 7].map(id);

  const activation = { label: "Created a project", event: "project_created" } as unknown as Activation;
  const features = [
    { key: "projects", label: "Projects", event: "project_created" },
    { key: "notes", label: "Notes", event: "note_added" },
  ] as unknown as Feature[];

  type Ev = [device: string, daysAgo: number, name: string, props?: object, referrer?: string];
  const events: Ev[] = [
    // A: from Instagram 20 days ago. Activates at once, back the next day, and on day 5 adds a note and shares the project.
    [A, 20, "pageview", {}, "instagram.com"],
    [A, 20, "project_created", {}, "instagram.com"],
    [A, 20, "engage", { ms: 60000 }, "instagram.com"],
    [A, 19, "pageview"],
    [A, 19, "engage", { ms: 30000 }],
    [A, 15, "note_added"],
    [A, 15, "share_created", { kind: "project", method: "copy" }],
    // B: opened a shared project 18 days ago, looked, and came back once, eight days later
    [B, 18, "pageview"],
    [B, 18, "share_opened", { kind: "project" }],
    [B, 18, "engage", { ms: 10000 }],
    [B, 10, "pageview"],
    // C: came directly 9 days ago, activated the next day
    [C, 9, "pageview"],
    [C, 8, "project_created"],
    // D: opened a shared project 3 days ago and activated on the spot; not back since
    [D, 3, "share_opened", { kind: "project" }],
    [D, 3, "project_created"],
    // E: came directly 40 days ago and never returned
    [E, 40, "pageview"],
    // F: opened a shared note 2 days ago, back the next day, never activated
    [F, 2, "share_opened", { kind: "note" }],
    [F, 1, "pageview"],
    // G: came from Instagram 5 days ago, looked at two pages, and only then opened a project link a friend sent.
    // That is an open, but G's source is Instagram: the source is how a user arrived.
    [G, 5, "pageview", {}, "instagram.com"],
    [G, 5, "pageview", {}, "instagram.com"],
    [G, 5, "share_opened", { kind: "project" }, "instagram.com"],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'cohorttest'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, name, props = {}, referrer = null], i) => ({
        app: "cohorttest",
        env: "test",
        ts: at(daysAgo, i),
        device_id: device,
        // One session per device per day
        session_id: id(1000 + Number(device.slice(-2)) * 100 + daysAgo),
        name,
        path: "/",
        props: sql.json(props as postgres.JSONValue),
        mode: "app",
        referrer,
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app = 'cohorttest'`;
    await sql.end();
  });

  it("tags every user with their source and compares what each group did", async () => {
    const { bySource } = await cohortStats(sql, "cohorttest", "test", { features, activation }, "UTC");
    expect(bySource).toEqual([
      {
        // B, D and F. Only B's first week is over: one visit, ten seconds, nothing made.
        cohort: "share",
        users: 3,
        usersWithFullWeek: 1,
        usersWithFullMonth: 0,
        returnedWithin1Day: 0.333, // F
        returnedWithin7Days: 0, // B came back on day 8
        returnedWithin30Days: null,
        activatedFirstDay: 0.333, // D
        activatedWithin7Days: 0,
        firstWeek: { sessionsPerUser: 1, activeDaysPerUser: 1, activeSecondsPerUser: 10, shared: 0, features: { projects: 0, notes: 0 } },
      },
      {
        // C and E
        cohort: "direct",
        users: 2,
        usersWithFullWeek: 2,
        usersWithFullMonth: 1,
        returnedWithin1Day: 0.5,
        returnedWithin7Days: 0.5,
        returnedWithin30Days: 0, // E, the only one 30 days old
        activatedFirstDay: 0,
        activatedWithin7Days: 0.5, // C, on day 2
        firstWeek: { sessionsPerUser: 1.5, activeDaysPerUser: 1.5, activeSecondsPerUser: 0, shared: 0, features: { projects: 0.5, notes: 0 } },
      },
      {
        // A and G. Only A's first week is over.
        cohort: "instagram.com",
        users: 2,
        usersWithFullWeek: 1,
        usersWithFullMonth: 0,
        returnedWithin1Day: 0.5,
        returnedWithin7Days: 1,
        returnedWithin30Days: null,
        activatedFirstDay: 0.5,
        activatedWithin7Days: 1,
        firstWeek: { sessionsPerUser: 3, activeDaysPerUser: 3, activeSecondsPerUser: 90, shared: 1, features: { projects: 1, notes: 1 } },
      },
    ]);
  });

  it("groups the same numbers by the week and the month people arrived", async () => {
    const { byWeek, byMonth } = await cohortStats(sql, "cohorttest", "test", { features, activation }, "UTC");
    for (const rows of [byWeek, byMonth]) {
      // Everyone arrived within the last 40 days, so every user is in exactly one row
      expect(rows.reduce((n, c) => n + c.users, 0)).toBe(7);
      expect(rows.reduce((n, c) => n + c.usersWithFullWeek, 0)).toBe(4);
      expect(rows.reduce((n, c) => n + c.usersWithFullMonth, 0)).toBe(1);
      expect(rows.map((c) => c.cohort)).toEqual(rows.map((c) => c.cohort).sort());
    }
    expect(byWeek.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.cohort) && new Date(c.cohort + "T00:00:00Z").getUTCDay() === 1)).toBe(true);
    expect(byMonth.every((c) => /^\d{4}-\d{2}$/.test(c.cohort))).toBe(true);
    // The week E arrived in holds only E, who never came back and made nothing
    const oldest = byWeek[0];
    expect(oldest).toMatchObject({ users: 1, returnedWithin7Days: 0, returnedWithin30Days: 0, activatedWithin7Days: 0 });
    expect(oldest.firstWeek).toMatchObject({ sessionsPerUser: 1, features: { projects: 0, notes: 0 } });
  });

  it("follows shared links by kind, from sent to came back", async () => {
    const { shareFunnel } = await cohortStats(sql, "cohorttest", "test", { features, activation }, "UTC");
    expect(shareFunnel).toEqual([
      // One project link sent. B, D and G opened one; B and D arrived that way and were new. D activated, B came back.
      { kind: "project", created: 1, sharers: 1, opens: 3, openers: 3, newUsers: 2, activated: 1, returned: 1, opensPerShare: 3, newUserRate: 0.667, activationRate: 0.5, returnRate: 0.5 },
      // F's note link was sent before the 30 days (or elsewhere): opened, never sent in the window
      { kind: "note", created: 0, sharers: 0, opens: 1, openers: 1, newUsers: 1, activated: 0, returned: 1, opensPerShare: null, newUserRate: 1, activationRate: 0, returnRate: 1 },
      { kind: "all", created: 1, sharers: 1, opens: 4, openers: 4, newUsers: 3, activated: 1, returned: 2, opensPerShare: 4, newUserRate: 0.75, activationRate: 0.333, returnRate: 0.667 },
    ]);
  });

  it("leaves activation out when the app hasn't named an event, and copes with no users", async () => {
    const none = await cohortStats(sql, "cohorttest", "test", { features: [] }, "UTC");
    expect(none.bySource[0]).toMatchObject({ cohort: "share", activatedFirstDay: null, activatedWithin7Days: null, firstWeek: { features: {} } });
    expect(none.shareFunnel.at(-1)).toMatchObject({ kind: "all", newUsers: 3, activationRate: null });
    const empty = await cohortStats(sql, "nobody-here", "test", { features, activation }, "UTC");
    expect(empty).toMatchObject({ bySource: [], byWeek: [], byMonth: [] });
    expect(empty.shareFunnel).toEqual([
      { kind: "all", created: 0, sharers: 0, opens: 0, openers: 0, newUsers: 0, activated: 0, returned: 0, opensPerShare: null, newUserRate: null, activationRate: null, returnRate: null },
    ]);
  });
});
