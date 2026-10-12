// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
// The tracker's half of this file (routePattern, trackedLink, carried ids) is in the desktop app's repo,
// where client.ts lives: canopy/src/lib/analytics/client.test.ts.
import { describe, expect, it } from "vitest";
import { ownerMark, parseBatch } from "./server/collect";

const device = "0f8c2a51-7d3e-4b6a-9c1f-2e5d8a7b6c40";
const session = "a1b2c3d4-e5f6-4789-8abc-def012345678";
const now = Date.UTC(2026, 9, 5, 12);

describe("ownerMark", () => {
  it("reads whether a batch marks or unmarks the owner's device, and nothing else", () => {
    expect(ownerMark({ me: true })).toBe(true);
    expect(ownerMark({ me: false })).toBe(false);
    expect(ownerMark({ me: "yes" })).toBeNull();
    expect(ownerMark({})).toBeNull();
    expect(ownerMark(null)).toBeNull();
  });
});

describe("parseBatch", () => {
  const batch = (events: unknown[], extra: object = {}) => ({ device, session, mode: "guest", standalone: true, events, ...extra });

  it("keeps known events with their props", () => {
    const rows = parseBatch(
      batch([{ name: "share_created", t: now - 1000, path: "/readings", props: { kind: "backup", method: "copy" } }], {
        referrer: "instagram.com",
        utm: { source: "ig" },
      }),
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "share_created",
      device_id: device,
      session_id: session,
      mode: "guest",
      standalone: true,
      path: "/readings",
      props: { kind: "backup", method: "copy" },
      referrer: "instagram.com",
      utm_source: "ig",
      utm_medium: null,
    });
    expect(rows[0].ts.getTime()).toBe(now - 1000);
  });

  it("drops malformed batches and events", () => {
    expect(parseBatch(null)).toEqual([]);
    expect(parseBatch({ ...batch([]), device: "nope" })).toEqual([]);
    expect(parseBatch({ ...batch([{ name: "pageview", t: now, path: "/" }]), session: "x" })).toEqual([]);
    const rows = parseBatch(
      batch([
        { name: "made_up", t: now, path: "/" },
        { name: "pageview", t: now, path: "no-slash" },
        { name: "engage", t: now, path: "/", props: {} },
        { name: "pageview", t: now, path: "/ok" },
      ]),
      now,
    );
    expect(rows.map((r) => r.path)).toEqual(["/ok"]);
  });

  it("cleans props and caps engagement", () => {
    const [row] = parseBatch(
      batch([{ name: "engage", t: now, path: "/", props: { ms: 99 * 60 * 1000, "bad key": 1, nested: { a: 1 }, long: "x".repeat(200) } }]),
      now,
    );
    expect(row.props).toEqual({ ms: 30 * 60 * 1000, long: "x".repeat(60) });
  });

  it("falls back to server time for a wildly wrong clock, and to app mode", () => {
    const [row] = parseBatch({ ...batch([{ name: "pageview", t: 0, path: "/" }]), mode: "admin" }, now);
    expect(row.ts.getTime()).toBe(now);
    expect(row.mode).toBe("app");
  });
});
