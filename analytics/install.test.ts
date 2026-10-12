// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import { describe, expect, it } from "vitest";
import { installManifest } from "./server/install";

const device = "0f8c2a51-7d3e-4b6a-9c1f-2e5d8a7b6c40";
const manifest = { name: "Example", start_url: "/", display: "standalone" };
const ask = (query: string, m: { start_url?: string; id?: string; name: string } = manifest) => installManifest(new Request(`https://app.example.com/manifest.webmanifest${query}`), m);

describe("installManifest", () => {
  it("puts the visitor's id into start_url, and keeps the app's identity the same for everyone", async () => {
    const res = ask(`?aid=${device.toUpperCase()}`);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ name: "Example", display: "standalone", id: "/", start_url: `/?aid=${device}` });
  });

  it("serves the plain manifest when no id is asked for, or the id isn't one", async () => {
    const plain = ask("");
    expect(plain.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await plain.json()).toEqual({ name: "Example", display: "standalone", id: "/", start_url: "/" });
    expect((await ask("?aid=%22%3E%3Cscript%3E").json()).start_url).toBe("/");
    expect((await ask("?aid=1234").json()).start_url).toBe("/");
  });

  it("passes an opt-out on, so a Home Screen app added from an excluded browser is excluded too", async () => {
    expect((await ask("?track=off").json()).start_url).toBe("/?track=off");
    expect((await ask("?track=on").json()).start_url).toBe("/");
  });

  it("keeps a start_url's own query and fragment, an id the app chose, and a missing start_url", async () => {
    expect(await ask(`?aid=${device}`, { name: "x", start_url: "/home?from=icon#top", id: "example" }).json()).toEqual({
      name: "x",
      id: "example",
      start_url: `/home?from=icon&aid=${device}#top`,
    });
    expect(await ask(`?aid=${device}`, { name: "x" }).json()).toEqual({ name: "x", id: "/", start_url: `/?aid=${device}` });
  });
});
