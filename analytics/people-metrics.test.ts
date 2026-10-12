// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import { peopleStats } from "./server/people-metrics";

/**
 * Runs the people SQL against a real Postgres. Skipped unless
 * ANALYTICS_TEST_DATABASE_URL points at a scratch database (its
 * analytics_events rows for app "peopletest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("peopleStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const at = (daysAgo: number, minute: number) => new Date(today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const who = (c: string) => `${c.repeat(8)}-0000-4000-8000-000000000001`;
  const [P, Q, R0, R, T, U, V0, V, W] = ["a", "b", "c", "d", "e", "f", "1", "2", "3"].map(who);
  const home = true;

  type Ev = [device: string, daysAgo: number, name: string, props?: object, standalone?: boolean];
  // Each event is a minute after the one before it on its day
  const events: Ev[] = [
    // P only ever uses the browser, and comes back
    [P, 40, "pageview"],
    [P, 39, "pageview"],
    // Q adds the app to their Home Screen the day after arriving, and the install keeps Q's id
    [Q, 30, "pageview"],
    [Q, 29, "app_installed", { carried: true }, home],
    [Q, 29, "pageview", {}, home],
    [P, 20, "pageview"],
    // A merge that names an id nobody has ever seen changes nothing
    [P, 20, "device_merged", { from: who("9") }],
    // U browses once. Their Home Screen app, T, is from before installs kept their id...
    [U, 15, "pageview"],
    // ...and so is R, whose browser visits were under R0
    [R0, 13, "pageview"],
    [R, 12, "pageview", {}, home],
    [R, 10, "pageview", {}, home],
    [T, 9, "pageview", {}, home],
    // U's browser opens a backup link made in T and carries on as T: U is the id left behind
    [T, 8, "device_merged", { from: U.toUpperCase() }],
    [T, 8, "pageview"],
    // V0 installs after this kit, but the id didn't make it across: V is a second id again
    [V0, 4, "pageview"],
    [V, 3, "app_installed", { carried: false }, home],
    [V, 3, "pageview", {}, home],
    // W installs within minutes of arriving
    [W, 2, "pageview"],
    [W, 2, "app_installed", { carried: true }, home],
    [W, 2, "pageview", {}, home],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'peopletest'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, name, props = {}, standalone = false], i) => ({
        app: "peopletest",
        env: "test",
        ts: at(daysAgo, i),
        device_id: device,
        session_id: `${device.slice(0, 24)}${String(100000000000 + daysAgo * 2 + Number(standalone))}`,
        name,
        path: "/",
        props: sql.json(props as postgres.JSONValue),
        mode: "app",
        standalone,
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app = 'peopletest'`;
    await sql.end();
  });

  it("leaves out the ids that are someone's second", async () => {
    const people = await peopleStats(sql, "peopletest", "test", "UTC");
    expect(people.users).toBe(9);
    // R and V were born on the Home Screen. T was too, but T took U over, so U is the copy and T is the person.
    expect(people.duplicates).toEqual({ homeScreen: 2, merged: 1 });
    // P, Q, R0 (with R), T (with U), V0 (with V) and W
    expect(people.estimatedPeople).toBe(6);
  });

  it("counts installs, how many kept their id, and whether installing early goes with coming back", async () => {
    const { installs } = await peopleStats(sql, "peopletest", "test", "UTC");
    expect(installs).toEqual({
      // Q, R, T, V and W have opened the app from the Home Screen: 5 of 6 people
      installers: 5,
      installRate: 0.833,
      recorded30d: 3,
      recordedAllTime: 3,
      carried: 2,
      carriedRate: 0.667,
      // Q a day and a minute after arriving, W a minute after: the median of the two
      medianSecondsToInstall: 43260,
      retention: {
        // R and T, both back within a week. V and W are too new to judge.
        installedFirstDay: { users: 2, returnedWithin7Days: 1, returnedWithin30Days: null },
        // P and Q came back; R0 and U never did. Only P and Q have been around 30 days.
        others: { users: 4, returnedWithin7Days: 0.5, returnedWithin30Days: 1 },
      },
    });
  });

  it("shows, week by week, how many new ids were someone's second", async () => {
    const { byWeek } = await peopleStats(sql, "peopletest", "test", "UTC");
    expect(byWeek).toHaveLength(8);
    const sum = (k: "newUsers" | "homeScreenCopies" | "merged" | "estimatedNewPeople") => byWeek.reduce((n, w) => n + w[k], 0);
    // Everyone arrived within these weeks, so the weeks add up to the totals
    expect([sum("newUsers"), sum("homeScreenCopies"), sum("merged"), sum("estimatedNewPeople")]).toEqual([9, 2, 1, 6]);
    for (const w of byWeek) expect(w.estimatedNewPeople).toBe(w.newUsers - w.homeScreenCopies - w.merged);
    expect(byWeek.map((w) => w.week)).toEqual([...byWeek.map((w) => w.week)].sort());
  });

  it("copes with an app nobody has used", async () => {
    const empty = await peopleStats(sql, "nobody-here", "test", "UTC");
    expect(empty.users).toBe(0);
    expect(empty.estimatedPeople).toBe(0);
    expect(empty.installs).toMatchObject({ installers: 0, installRate: null, recordedAllTime: 0, carriedRate: null, medianSecondsToInstall: null });
    expect(empty.installs.retention.others).toEqual({ users: 0, returnedWithin7Days: null, returnedWithin30Days: null });
  });
});
