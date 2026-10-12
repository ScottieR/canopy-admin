// app-analytics kit v8: this file is this app's own.
// events.ts exists twice: here, where the collector checks event names, and in the desktop app
// (canopy/src/lib/analytics/events.ts), where the tracker sends them. An event listed in only one is
// dropped without a word, so wherever the two repos sit side by side (local checkouts, the deploy
// workflow) they must be the same file.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL("./events.ts", import.meta.url));
const desktop = [process.env.CANOPY_REPO, "../../canopy", "../../canopy-worktrees/feature/app-analytics"]
  .filter((dir): dir is string => !!dir)
  .map((dir) => fileURLToPath(new URL(`${dir.replace(/\/$/, "")}/src/lib/analytics/events.ts`, import.meta.url)))
  .find((file) => existsSync(file));

describe.skipIf(!desktop)("events.ts", () => {
  it("is the same file in canopy-admin and in the desktop app", () => {
    expect(readFileSync(here, "utf8")).toBe(readFileSync(desktop!, "utf8"));
  });
});
