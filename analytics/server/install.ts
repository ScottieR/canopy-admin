// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import { DEVICE_PARAM } from "../events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An address with one more query parameter, ahead of any #fragment */
function withParam(address: string, key: string, value: string): string {
  const hash = address.indexOf("#");
  const [path, fragment] = hash < 0 ? [address, ""] : [address.slice(0, hash), address.slice(hash)];
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}${fragment}`;
}

/**
 * The app's web manifest, for one visitor.
 *
 * A Home Screen app gets storage of its own, apart from the browser it was added from, so without help
 * the same person shows up as a second, brand-new user. The tracker points the page's manifest link at
 * this route with the browser's id (?aid=<id>), and this puts the id into start_url. The installed app
 * then opens at that address, takes the id on, and carries on as the same user with the same history.
 * A browser that has opted out (?track=off) passes its opt-out on the same way.
 *
 * `id` is pinned to the plain start_url, so the app is the same app whoever installs it.
 *
 *   // app/manifest.webmanifest/route.ts, with `manifest: "/manifest.webmanifest"` in the root metadata
 *   export const GET = (request: Request) => installManifest(request, { name: "…", start_url: "/", display: "standalone", … });
 */
export function installManifest<M extends { start_url?: string; id?: string }>(request: Request, manifest: M): Response {
  const asked = new URL(request.url).searchParams;
  const device = asked.get(DEVICE_PARAM);
  const start = manifest.start_url ?? "/";
  const carry: [string, string] | null = device && UUID.test(device) ? [DEVICE_PARAM, device.toLowerCase()] : asked.get("track") === "off" ? ["track", "off"] : null;
  return new Response(JSON.stringify({ ...manifest, id: manifest.id ?? start, start_url: carry ? withParam(start, ...carry) : start }), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      // One visitor's copy is theirs alone; the plain one is the same for everybody
      "cache-control": carry ? "private, no-store" : "public, max-age=3600",
    },
  });
}
