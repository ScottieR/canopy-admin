// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { APP, DEVICE_HEADER } from "../events";
import { costOf, type Tokens } from "./ai-prices";
import { ANALYTICS_ENV, db, ensureSchema } from "./db";

/**
 * What the app spends on model APIs. Call recordAiUsage on the server after
 * every paid model call, with what the provider reported:
 *
 *   const message = await anthropic.messages.create({ model: MODEL, … });
 *   await recordAiUsage({ feature: "reading", ...anthropicUsage(message, MODEL), device: deviceFrom(request) });
 *
 * Rows go to their own table, ai_usage, in the same database as the usage
 * events, so a server-side call never counts as a user or a session. Nothing
 * personal is stored: the feature, model, token counts, cost and outcome, and
 * the random analytics device id when the browser sent one. /api/stats reports
 * them under `ai`.
 *
 * Each time a calendar month's spend passes another SPEND_ALERT_USD (default
 * $10: at $10, $20, $30…), one notification goes out, from production only:
 * to an ntfy topic (SPEND_ALERT_NTFY_TOPIC, a phone push) and/or a Slack- or
 * Discord-style webhook (SPEND_ALERT_WEBHOOK_URL).
 */

/** One model attempt: a request that fell back to another model has one line per attempt, each at its own model's price */
export interface UsageLine extends Partial<Tokens> {
  model: string;
}

export interface AiUsage extends Partial<Tokens> {
  /** What the call was for, as a short permanent slug: "reading", "portrait" */
  feature: string;
  /** The model that answered, as the provider reports it, not the one asked for */
  model: string;
  /** Every attempt, when there was more than one (anthropicUsage fills this in). Otherwise the token counts above are the single attempt. */
  lines?: UsageLine[];
  /** A model other than the one asked for finished the request */
  fallback?: boolean;
  /** How the call ended: the provider's stop reason ("end_turn", "max_tokens", "refusal") */
  outcome?: string;
  /** "anthropic" unless it's another provider */
  provider?: string;
  /** The exact cost in dollars, for calls the price table can't cost from tokens: the Batch API (half price), fast mode, a per-image or per-search charge */
  costUsd?: number;
  /** The caller's device id, from deviceFrom(request), so cost can be counted per user. Optional. */
  device?: string | null;
  /** Only for tests: rows are filed under this app's own slug otherwise */
  app?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Records one finished call, then checks the spend alert. Never throws and never rejects: cost tracking must not break the feature it measures. */
export async function recordAiUsage(u: AiUsage): Promise<void> {
  try {
    const sql = db();
    if (!sql) return;
    const app = u.app ?? APP;
    const lines: UsageLine[] = u.lines?.length ? u.lines : [{ ...u, model: u.model }];
    const sum = (k: keyof Tokens) => lines.reduce((n, l) => n + count(l[k]), 0);
    const costs = lines.map((l) => costOf(l.model, l));
    const exact = typeof u.costUsd === "number" && Number.isFinite(u.costUsd) && u.costUsd >= 0;
    await ensureSchema(sql);
    await sql`insert into ai_usage ${sql({
      app,
      env: ANALYTICS_ENV,
      route: u.feature.slice(0, 60),
      provider: (u.provider ?? "anthropic").slice(0, 30),
      model: u.model.slice(0, 80),
      fallback: u.fallback ?? lines.some((l) => l.model !== u.model),
      input_tokens: sum("inputTokens"),
      output_tokens: sum("outputTokens"),
      cache_read_tokens: sum("cacheReadTokens"),
      cache_write_tokens: sum("cacheWriteTokens"),
      cache_write_1h_tokens: sum("cacheWrite1hTokens"),
      cost_usd: (exact ? u.costUsd! : costs.reduce((n, c) => n + c.usd, 0)).toFixed(6),
      estimated: !exact && costs.some((c) => c.estimated),
      outcome: (u.outcome ?? "unknown").slice(0, 40),
      device_id: u.device && UUID.test(u.device) ? u.device.toLowerCase() : null,
    })}`;
    await checkSpendAlert(sql, ANALYTICS_ENV, app);
  } catch (error) {
    console.error("analytics: recording AI usage failed", error);
  }
}

interface AnthropicCounts {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

function anthropicTokens(u: AnthropicCounts): Tokens {
  const oneHour = count(u.cache_creation?.ephemeral_1h_input_tokens);
  return {
    // input_tokens already leaves out cached tokens, which are reported (and priced) separately
    inputTokens: count(u.input_tokens),
    outputTokens: count(u.output_tokens),
    cacheReadTokens: count(u.cache_read_input_tokens),
    // cache_creation_input_tokens is every cache write; the 1-hour part is priced higher
    cacheWriteTokens: Math.max(0, count(u.cache_creation_input_tokens) - oneHour),
    cacheWrite1hTokens: oneHour,
  };
}

/**
 * A finished Anthropic message as what recordAiUsage needs. With server-side
 * fallbacks or tool loops, `usage.iterations` lists every attempt (a declined
 * one, and the fallback model that finished), each with its own model; the
 * top-level usage covers only the last, so iterations are the source of truth.
 */
export function anthropicUsage(
  message: {
    model?: string | null;
    stop_reason?: string | null;
    usage: AnthropicCounts & { iterations?: (AnthropicCounts & { model?: string | null })[] | null };
  },
  requestedModel?: string,
): Pick<AiUsage, "model" | "lines" | "fallback" | "outcome"> {
  const model = message.model ?? requestedModel ?? "unknown";
  const attempts = message.usage.iterations?.length ? message.usage.iterations : [message.usage as AnthropicCounts & { model?: string | null }];
  const lines = attempts.map((u) => ({ model: u.model ?? model, ...anthropicTokens(u) }));
  return {
    model,
    lines,
    fallback: lines.length > 1 || (requestedModel != null && model !== requestedModel),
    outcome: message.stop_reason ?? "unknown",
  };
}

/** The device id the browser sent with the request (deviceHeader() in lib/analytics/client.ts), or null. */
export function deviceFrom(request: { headers: { get(name: string): string | null } }): string | null {
  const id = request.headers.get(DEVICE_HEADER);
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

const dollars = (n: number) => `$${n.toFixed(2)}`;

/**
 * Sends one alert each time month-to-date spend crosses another multiple of
 * the threshold ($10, $20, …). The primary key on ai_spend_alerts makes each
 * level fire once even when several calls finish at the same moment.
 */
export async function checkSpendAlert(sql: postgres.Sql, env = ANALYTICS_ENV, app = APP): Promise<boolean> {
  const threshold = Number(process.env.SPEND_ALERT_USD ?? 10);
  const ntfy = process.env.SPEND_ALERT_NTFY_TOPIC;
  const webhook = process.env.SPEND_ALERT_WEBHOOK_URL;
  if (env !== "production" || !(threshold > 0) || (!ntfy && !webhook)) return false;

  const tz = process.env.STATS_TZ ?? "America/Los_Angeles";
  const [row] = await sql`
    select to_char(now() at time zone ${tz}, 'YYYY-MM') period,
      to_char(now() at time zone ${tz}, 'FMMonth') as month_name,
      coalesce(sum(cost_usd) filter (where date_trunc('month', ts at time zone ${tz}) = date_trunc('month', now() at time zone ${tz})), 0)::float8 mtd,
      coalesce(sum(cost_usd) filter (where (ts at time zone ${tz})::date = (now() at time zone ${tz})::date), 0)::float8 today,
      count(*) filter (where (ts at time zone ${tz})::date = (now() at time zone ${tz})::date)::int today_calls
    from ai_usage where app = ${app} and env = ${env} and ts > now() - interval '32 days'`;
  const level = Math.floor(row.mtd / threshold);
  if (level < 1) return false;

  const claimed = await sql`
    insert into ai_spend_alerts (app, env, period, level, usd) values (${app}, ${env}, ${row.period}, ${level}, ${row.mtd})
    on conflict do nothing returning level`;
  if (!claimed.length) return false;

  const features = await sql`
    select route, count(*)::int n from ai_usage
    where app = ${app} and env = ${env} and ts > now() - interval '7 days' group by route order by n desc`;
  const title = `${app.charAt(0).toUpperCase()}${app.slice(1)} AI spend passed ${dollars(level * threshold)} this month`;
  const body = [
    `${dollars(row.mtd)} so far in ${row.month_name}. Today: ${dollars(row.today)} across ${row.today_calls} ${row.today_calls === 1 ? "call" : "calls"}.`,
    `Last 7 days: ${features.map((r) => `${r.route} ${r.n}`).join(" · ") || "none"}.`,
    "Run npm run spend for the breakdown.",
  ].join("\n");

  const sends: Promise<Response>[] = [];
  // A bare topic goes to the public ntfy.sh server; a full URL to your own
  if (ntfy) sends.push(fetch(/^https?:\/\//.test(ntfy) ? ntfy : `https://ntfy.sh/${ntfy}`, { method: "POST", body, headers: { Title: title, Tags: "moneybag", Priority: "high" } }));
  // Slack reads `text`, Discord reads `content`
  if (webhook) sends.push(fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `${title}\n${body}`, content: `${title}\n${body}` }) }));
  for (const r of await Promise.allSettled(sends)) {
    if (r.status === "rejected") console.error("analytics: spend alert failed", r.reason);
    else if (!r.value.ok) console.error("analytics: spend alert answered", r.value.status);
  }
  return true;
}
