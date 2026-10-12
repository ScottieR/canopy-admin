// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { statsScope } from "./db";
import { firstSessions, sourceOf } from "./cohort-metrics";

/**
 * Every event over time. Each row in analytics_events carries the moment it
 * happened (`ts`, from the device's clock, held to within a day of the
 * server's), so any event can be placed on a timeline and grouped by day,
 * week or month.
 *
 * - timeline: for every event name, how many times it happened and how many
 *   users did it, per day (90 days), per week (26 weeks, by their Monday) and
 *   per month (12 months). The counts line up with the shared date axes, so a
 *   chart needs no further work, and the daily series can be regrouped any
 *   other way.
 * - recentEvents: the latest events one by one, newest first, each with its
 *   timestamp and the source and arrival date of the user who did it.
 *
 * `engage` is left out of both: it measures time on a page, not something a
 * person did. Time spent is in `daily`, `engagement` and `topPages`.
 */
export interface Series {
  count: number[];
  /** Different users in each period: a user active on three days of a week is one user that week */
  users: number[];
}

export interface TimelineStats {
  timeline: {
    /** The axes, oldest first: dates (YYYY-MM-DD), Mondays (YYYY-MM-DD) and months (YYYY-MM), in the stats time zone */
    days: string[];
    weeks: string[];
    months: string[];
    /** Most frequent first; total is over the 12 months */
    events: { name: string; total: number; daily: Series; weekly: Series; monthly: Series }[];
  };
  /** The last 100 events, newest first. user is the first 8 characters of the random device id. */
  recentEvents: {
    at: string;
    name: string;
    path: string;
    mode: string;
    props: Record<string, string | number | boolean>;
    user: string;
    /** Where this user's first visit came from, and the day it was (as in `cohorts`) */
    source: string;
    firstSeen: string;
  }[];
}

const num = (v: unknown): number => Number(v ?? 0);

export async function timelineStats(sql: postgres.Sql, app: string, env: string, tz = process.env.STATS_TZ ?? "America/Los_Angeles", withoutMe = false): Promise<TimelineStats> {
  // withoutMe leaves out the owner's own devices (?track=me)
  const scope = statsScope(sql, app, env, withoutMe);
  const day = sql`(ts at time zone ${tz})::date`;
  const today = sql`(now() at time zone ${tz})::date`;
  const thisWeek = sql`date_trunc('week', ${today}::timestamp)::date`;
  const thisMonth = sql`date_trunc('month', ${today}::timestamp)`;
  const counted = sql`count(*) n, count(distinct device_id) u from analytics_events where ${scope} and name <> 'engage'`;

  const [[axes], daily, weekly, monthly, recent] = await Promise.all([
    sql`select
          array(select generate_series(${today} - 89, ${today}, interval '1 day')::date::text) days,
          array(select generate_series(${thisWeek} - 175, ${thisWeek}, interval '7 days')::date::text) weeks,
          array(select to_char(generate_series(${thisMonth} - interval '11 months', ${thisMonth}, interval '1 month'), 'YYYY-MM')) months`,

    sql`select name, ${day}::text k, ${counted} and ${day} > ${today} - 90 group by 1, 2`,

    sql`select name, date_trunc('week', ${day}::timestamp)::date::text k, ${counted} and ${day} >= ${thisWeek} - 175 group by 1, 2`,

    sql`select name, to_char(${day}, 'YYYY-MM') k, ${counted} and ${day} >= (${thisMonth} - interval '11 months')::date group by 1, 2`,

    sql`with recent as (
          select id, ts, name, path, mode, props, device_id from analytics_events
          where ${scope} and name <> 'engage' order by ts desc, id desc limit 100),
        ev as (
          select device_id, session_id, ts, name, referrer, utm_source, ${day} d from analytics_events
          where ${scope} and device_id in (select device_id from recent)),
        u as (select device_id, min(d) first_seen from ev group by device_id),
        ${firstSessions(sql)},
        src as (select fs.device_id, ${sourceOf(sql)} source
                from fs join ev on ev.session_id = fs.session_id and ev.device_id = fs.device_id group by fs.device_id)
        select r.ts, r.name, r.path, r.mode, r.props, left(r.device_id::text, 8) usr, src.source, u.first_seen::text first_seen
        from recent r join src using (device_id) join u using (device_id) order by r.ts desc, r.id desc`,
  ]);

  const [days, weeks, months] = [axes.days as string[], axes.weeks as string[], axes.months as string[]];
  const series = (rows: postgres.Row[], axis: string[], name: string): Series => {
    const at = new Map(rows.filter((r) => r.name === name).map((r) => [r.k as string, r]));
    return { count: axis.map((k) => num(at.get(k)?.n)), users: axis.map((k) => num(at.get(k)?.u)) };
  };
  const names = [...new Set([...daily, ...weekly, ...monthly].map((r) => r.name as string))];

  return {
    timeline: {
      days,
      weeks,
      months,
      events: names
        .map((name) => {
          const byMonth = series(monthly, months, name);
          return { name, total: byMonth.count.reduce((n, c) => n + c, 0), daily: series(daily, days, name), weekly: series(weekly, weeks, name), monthly: byMonth };
        })
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    },
    recentEvents: recent.map((r) => ({
      at: new Date(r.ts).toISOString(),
      name: r.name,
      path: r.path,
      mode: r.mode,
      props: r.props ?? {},
      user: r.usr,
      source: r.source,
      firstSeen: r.first_seen,
    })),
  };
}
