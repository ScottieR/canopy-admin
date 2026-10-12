// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema } from "./server/db";
import type { Activation } from "./server/flow-metrics";
import { sharingStats } from "./server/sharing-metrics";

/**
 * Runs the sharing SQL against a real Postgres, with a made-up activation
 * event. Skipped unless ANALYTICS_TEST_DATABASE_URL points at a scratch
 * database (its analytics_events rows for app "sharetest" are replaced).
 */
const url = process.env.ANALYTICS_TEST_DATABASE_URL;

describe.skipIf(!url)("sharingStats", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  const DAY = 86400000;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  const date = (daysAgo: number) => new Date(today - daysAgo * DAY).toISOString().slice(0, 10);
  const at = (daysAgo: number, minute: number) => new Date(today - daysAgo * DAY + 12 * 3600000 + minute * 60000);
  const who = (c: string) => `${c.repeat(8)}-0000-4000-8000-000000000001`;
  const [A, B, C, D, E, F, G, K, H] = ["a", "b", "c", "d", "e", "f", "1", "2", "3"].map(who);
  const activation = { label: "Created a project", event: "project_created" } as unknown as Activation;

  type Ev = [device: string, daysAgo: number, name: string, props?: object];
  // Each event is a minute after the one before it on its day
  const events: Ev[] = [
    [E, 30, "pageview"],
    [A, 20, "pageview"],
    // A sends three links: a reading (1), today's card (2), and a reading nobody will open (5)
    [A, 10, "share_created", { kind: "reading", method: "share_sheet", share: "link000001" }],
    [A, 10, "share_created", { kind: "daily", method: "copy", share: "link000002" }],
    [A, 10, "share_created", { kind: "reading", method: "share_sheet", share: "link000005" }],
    // A taps their own link: not an open
    [A, 9, "share_opened", { kind: "reading", share: "link000001" }],
    // B arrives through link 1, makes a project, and comes back
    [B, 9, "share_opened", { kind: "reading", share: "link000001" }],
    [B, 9, "pageview"],
    [B, 9, "project_created"],
    // E, who has been around for weeks, opens link 1 too: a connection, not a recruit
    [E, 9, "pageview"],
    [E, 9, "pageview"],
    [E, 9, "share_opened", { kind: "reading", share: "link000001" }],
    [B, 8, "pageview"],
    [B, 8, "share_created", { kind: "app", method: "share_sheet", share: "link000003" }],
    // C arrives through link 2 and never does anything else
    [C, 8, "share_opened", { kind: "daily", share: "link000002" }],
    [C, 8, "pageview"],
    // D arrives through B's link 3: A's recruit's recruit
    [D, 7, "share_opened", { kind: "app", share: "link000003" }],
    [D, 7, "project_created"],
    // B sends a reading back to A, who opens it: the two now share both ways
    [B, 6, "share_created", { kind: "reading", method: "copy", share: "link000006" }],
    [A, 5, "pageview"],
    [A, 5, "share_opened", { kind: "reading", share: "link000006" }],
    // F opens a link nobody is known to have sent
    [F, 4, "share_opened", { kind: "reading", share: "linkzzzzzz" }],
    [F, 4, "pageview"],
    // K, a shared tablet, shows a QR code that G scans a minute later
    [K, 3, "pageview"],
    [K, 3, "share_offered", { kind: "takeaway", method: "qr", share: "link000004" }],
    [G, 3, "share_opened", { kind: "takeaway", share: "link000004" }],
    [G, 3, "pageview"],
    // A saves a backup link, which is a link to yourself, and it's opened in another browser: nobody brought anybody
    [A, 2, "share_created", { kind: "backup", method: "copy", share: "link000007", self: true }],
    [H, 2, "share_opened", { kind: "backup", share: "link000007" }],
    [H, 2, "pageview"],
  ];

  beforeAll(async () => {
    await ensureSchema(sql);
    await sql`delete from analytics_events where app = 'sharetest'`;
    await sql`insert into analytics_events ${sql(
      events.map(([device, daysAgo, name, props = {}], i) => ({
        app: "sharetest",
        env: "test",
        ts: at(daysAgo, i),
        device_id: device,
        // One session per device per day
        session_id: `${device.slice(0, 24)}${String(100000000000 + daysAgo)}`,
        name,
        path: "/",
        props: sql.json(props as postgres.JSONValue),
        mode: "app",
      })),
    )}`;
  });

  afterAll(async () => {
    await sql`delete from analytics_events where app = 'sharetest'`;
    await sql`delete from analytics_owner_devices where app = 'sharetest'`;
    await sql.end();
  });

  it("marks the owner's own shares, and leaves them out on request", async () => {
    await sql`insert into analytics_owner_devices (app, device_id) values ('sharetest', ${A}) on conflict do nothing`;
    const mine = await sharingStats(sql, "sharetest", "test", { activation }, "UTC");
    expect(mine.ambassadors.find((a) => a.user === "aaaaaaaa")?.me).toBe(true);
    expect(mine.ambassadors.filter((a) => a.me)).toHaveLength(1);
    const others = await sharingStats(sql, "sharetest", "test", { activation }, "UTC", true);
    expect(others.ambassadors.some((a) => a.user === "aaaaaaaa")).toBe(false);
    await sql`delete from analytics_owner_devices where app = 'sharetest'`;
  });

  it("shows how links of each kind and method do", async () => {
    const { links } = await sharingStats(sql, "sharetest", "test", { activation }, "UTC");
    expect(links).toEqual([
      // Links 1 and 5. Link 1 was opened by B and E a day and four minutes after it was made; B was new.
      { kind: "reading", method: "share_sheet", links: 2, opened: 1, openRate: 0.5, openers: 2, recruits: 1, recruitsPerLink: 0.5, medianSecondsToOpen: 86640 },
      { kind: "app", method: "share_sheet", links: 1, opened: 1, openRate: 1, openers: 1, recruits: 1, recruitsPerLink: 1, medianSecondsToOpen: 86580 },
      { kind: "daily", method: "copy", links: 1, opened: 1, openRate: 1, openers: 1, recruits: 1, recruitsPerLink: 1, medianSecondsToOpen: 173460 },
      // B's link back to A: opened, but A was already a user
      { kind: "reading", method: "copy", links: 1, opened: 1, openRate: 1, openers: 1, recruits: 0, recruitsPerLink: 0, medianSecondsToOpen: 86520 },
      // The QR code was only ever shown, never sent
      { kind: "takeaway", method: "qr_shown", links: 1, opened: 1, openRate: 1, openers: 1, recruits: 1, recruitsPerLink: 1, medianSecondsToOpen: 60 },
      { kind: "all", method: "all", links: 6, opened: 5, openRate: 0.833, openers: 6, recruits: 4, recruitsPerLink: 0.667, medianSecondsToOpen: 86580 },
    ]);
  });

  it("ranks the people whose links bring others in, with their best kind of link and everyone downstream", async () => {
    const { ambassadors } = await sharingStats(sql, "sharetest", "test", { activation }, "UTC");
    expect(ambassadors).toEqual([
      {
        // B and C came through A, and D through B. Today's card brought one person per link; readings one per two.
        user: "aaaaaaaa", me: false, source: "direct", firstSeen: date(20), generation: 0, invitedBy: null,
        links: 3, opened: 2, openRate: 0.667, openers: 3, recruits: 2, activated: 1, returned: 1, descendants: 3,
        byKind: [
          { kind: "reading", links: 2, opened: 1, recruits: 1 },
          { kind: "daily", links: 1, opened: 1, recruits: 1 },
        ],
        bestKind: "daily",
      },
      {
        user: "bbbbbbbb", me: false, source: "share", firstSeen: date(9), generation: 1, invitedBy: "aaaaaaaa",
        links: 2, opened: 2, openRate: 1, openers: 2, recruits: 1, activated: 1, returned: 0, descendants: 1,
        byKind: [
          { kind: "app", links: 1, opened: 1, recruits: 1 },
          { kind: "reading", links: 1, opened: 1, recruits: 0 },
        ],
        bestKind: "app",
      },
      {
        user: "22222222", me: false, source: "direct", firstSeen: date(3), generation: 0, invitedBy: null,
        links: 1, opened: 1, openRate: 1, openers: 1, recruits: 1, activated: 0, returned: 0, descendants: 1,
        byKind: [{ kind: "takeaway", links: 1, opened: 1, recruits: 1 }],
        bestKind: "takeaway",
      },
    ]);
  });

  it("counts generations and finds the groups people form", async () => {
    const { generations, groups } = await sharingStats(sql, "sharetest", "test", { activation }, "UTC");
    expect(generations).toEqual([
      // A, E and the tablet came on their own; B, C and G were brought by them; D by B
      { generation: 0, users: 3, sharers: 2, activated: 0 },
      { generation: 1, users: 3, sharers: 1, activated: 0.333 },
      { generation: 2, users: 1, sharers: 0, activated: 1 },
    ]);
    expect(groups).toEqual([
      // A and B have shared with each other both ways
      { members: 5, users: ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd", "eeeeeeee"], links: 5, recruits: 3, reciprocalPairs: 1 },
      { members: 2, users: ["11111111", "22222222"], links: 1, recruits: 1, reciprocalPairs: 0 },
    ]);
  });

  it("lists the graph itself: who opened whose link, and everyone in it", async () => {
    const { edges, nodes } = await sharingStats(sql, "sharetest", "test", { activation }, "UTC");
    expect(edges.map((e) => [e.from, e.to, e.kind, e.method, e.opens, e.recruited, e.toActivated, e.toReturned, e.toShared])).toEqual([
      ["22222222", "11111111", "takeaway", "qr_shown", 1, true, false, false, false],
      ["bbbbbbbb", "aaaaaaaa", "reading", "copy", 1, false, false, true, true],
      ["bbbbbbbb", "dddddddd", "app", "share_sheet", 1, true, true, false, false],
      ["aaaaaaaa", "cccccccc", "daily", "copy", 1, true, false, false, false],
      ["aaaaaaaa", "eeeeeeee", "reading", "share_sheet", 1, false, false, true, false],
      ["aaaaaaaa", "bbbbbbbb", "reading", "share_sheet", 1, true, true, true, true],
    ]);
    expect(Number.isFinite(Date.parse(edges[0].firstOpenedAt))).toBe(true);
    // F opened a link nobody is known to have sent, and H a link A sent to themselves, so neither is in the graph
    expect(nodes.map((n) => [n.user, n.source, n.generation, n.invitedBy, n.activated, n.links, n.recruits])).toEqual([
      ["aaaaaaaa", "direct", 0, null, false, 3, 2],
      ["bbbbbbbb", "share", 1, "aaaaaaaa", true, 2, 1],
      ["22222222", "direct", 0, null, false, 1, 1],
      ["11111111", "share", 1, "22222222", false, 0, 0],
      ["cccccccc", "share", 1, "aaaaaaaa", false, 0, 0],
      ["dddddddd", "share", 2, "bbbbbbbb", true, 0, 0],
      ["eeeeeeee", "direct", 0, null, false, 0, 0],
    ]);
  });

  it("copes with no links, and leaves activation out when the app hasn't named an event", async () => {
    const empty = await sharingStats(sql, "nobody-here", "test", { activation }, "UTC");
    expect(empty).toEqual({
      links: [{ kind: "all", method: "all", links: 0, opened: 0, openRate: null, openers: 0, recruits: 0, recruitsPerLink: null, medianSecondsToOpen: null }],
      ambassadors: [], generations: [], groups: [], edges: [], nodes: [],
    });
    const { generations } = await sharingStats(sql, "sharetest", "test", {}, "UTC");
    expect(generations.map((g) => g.activated)).toEqual([null, null, null]);
  });
});
