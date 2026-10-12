// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import { EVENT_NAMES, type Batch, type Mode } from "../events";

/** A row ready for analytics_events, minus the server-side fields. */
export interface EventRow {
  ts: Date;
  device_id: string;
  session_id: string;
  name: string;
  path: string;
  props: Record<string, string | number | boolean>;
  mode: Mode;
  standalone: boolean;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = new Set<Mode>(["app", "guest", "kiosk"]);
const MAX_EVENTS = 50;
/** Device clocks drift; anything further off than this is clamped to the server's clock. */
const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v ? v.slice(0, max) : null);

function cleanProps(raw: unknown): EventRow["props"] {
  const out: EventRow["props"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw).slice(0, 10)) {
    if (!/^[a-zA-Z_]{1,30}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 60);
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/**
 * Whether a batch says its device is the owner's (true), was but isn't any more
 * (false), or says nothing (null). See ?track=me in client.ts.
 */
export function ownerMark(body: unknown): boolean | null {
  if (!body || typeof body !== "object") return null;
  const me = (body as Partial<Batch>).me;
  return typeof me === "boolean" ? me : null;
}

/**
 * Validates a batch from the browser. Anything malformed is dropped, not
 * repaired: unknown event names, bad ids, oversized fields.
 */
export function parseBatch(body: unknown, serverNow = Date.now()): EventRow[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Partial<Batch>;
  if (typeof b.device !== "string" || !UUID.test(b.device)) return [];
  if (typeof b.session !== "string" || !UUID.test(b.session)) return [];
  if (!Array.isArray(b.events)) return [];
  const mode = MODES.has(b.mode as Mode) ? (b.mode as Mode) : "app";

  return b.events.slice(0, MAX_EVENTS).flatMap((e): EventRow[] => {
    if (!e || typeof e !== "object" || !EVENT_NAMES.has(e.name)) return [];
    const path = str(e.path, 120);
    if (!path?.startsWith("/")) return [];
    const t = typeof e.t === "number" && Math.abs(e.t - serverNow) < MAX_SKEW_MS ? e.t : serverNow;
    const props = cleanProps(e.props);
    // Engagement past 30 minutes on one page is a tab left open, not reading
    if (e.name === "engage") {
      if (typeof props.ms !== "number" || props.ms <= 0) return [];
      props.ms = Math.min(Math.round(props.ms), 30 * 60 * 1000);
    }
    return [
      {
        ts: new Date(t),
        device_id: b.device!.toLowerCase(),
        session_id: b.session!.toLowerCase(),
        name: e.name,
        path,
        props,
        mode,
        standalone: b.standalone === true,
        referrer: str(b.referrer, 100),
        utm_source: str(b.utm?.source, 60),
        utm_medium: str(b.utm?.medium, 60),
        utm_campaign: str(b.utm?.campaign, 60),
      },
    ];
  });
}
