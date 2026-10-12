// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { statsScope } from "./db";
import type { EventName, Props } from "../events";

/**
 * The app-specific half of /api/stats: this app's key flows (lib/analytics/flows.ts),
 * measured the same way in every app.
 *
 * - Funnels: how many users got through each step of a journey such as
 *   onboarding, where they dropped off, and how many made it end to end.
 * - Features: adoption (used it once), ongoing engagement (how often, and
 *   week by week) and streaks (days in a row).
 *
 * A "user" and a "day" mean what they mean in metrics.ts.
 */

/** One kind of event: its name, optionally narrowed to a route pattern or to exact prop values */
export interface Match {
  event: EventName;
  path?: string;
  where?: Props;
}
export type Step = Match & { key: string; label: string };
export interface Funnel {
  key: string;
  label: string;
  /** In order, from the entry point to the moment of value */
  steps: [Step, Step, ...Step[]];
}
export type Feature = Match & {
  key: string;
  label: string;
  /**
   * A prop holding the device's own calendar date ("YYYY-MM-DD") for daily habits, so a
   * late-evening use far from STATS_TZ still counts for the day the person lived it.
   * Ignored when it's more than a day away from the server's date for the event.
   */
  dayProp?: string;
};

/** The event that means a new user got the app's value, or several when any one of them counts */
export type Activation = { label: string } & (Match | { anyOf: [Match, Match, ...Match[]] });

/** Runs of calendar days in a row (STATS_TZ) with at least one use */
export interface Streaks {
  /** Users whose run is still alive (it includes today or yesterday) and is 2+ / 7+ days long */
  onStreak: number;
  onStreak7: number;
  /** Median length of the runs that are still alive */
  medianCurrent: number | null;
  /** The longest run anyone has had, and the median of each user's longest */
  longest: number;
  medianLongest: number | null;
  /** Users by their longest run: 1, 2, 3-6, 7-13, 14-29, 30+ days */
  byLongest: { days: string; users: number }[];
}

export interface FlowStats {
  funnels: {
    key: string;
    label: string;
    /** Users who first reached step 1 in the last 30 days, and how many of them reached the last step */
    entered: number;
    completed: number;
    completionRate: number | null;
    medianSecondsToComplete: number | null;
    /** users: reached this step in order. fromPrevious + dropoff = 1. fromStart: share of entered. */
    steps: { key: string; label: string; users: number; fromPrevious: number | null; dropoff: number | null; fromStart: number | null }[];
    allTime: { entered: number; completed: number; completionRate: number | null };
  }[];
  features: {
    key: string;
    label: string;
    adoption: {
      /** Used it at least once, ever; rate is ÷ all users */
      users: number;
      rate: number | null;
      /** Used it in the last 30 days; rate30d is ÷ users active in the last 30 days */
      users30d: number;
      rate30d: number | null;
      /** First use was in the last 30 days */
      newUsers30d: number;
    };
    engagement: {
      uses30d: number;
      usesPerUser30d: number | null;
      /** Average number of different days a user of the feature used it, last 30 days */
      daysPerUser30d: number | null;
      /** Share of adopters who used it on 2+ different days, ever */
      repeatRate: number | null;
      /** Of adopters whose first use was 7+ days ago, the share who used it again within 7 days */
      repeatedWithin7Days: number | null;
      /** The last 8 weeks (Monday), oldest first */
      weekly: { week: string; users: number; uses: number }[];
    };
    streaks: Streaks;
  }[];
  /** Streaks of using the app at all (any event) */
  appStreaks: Streaks;
  /** Null until the app names its activation event */
  activation: {
    label: string;
    /** Users first seen in the last 30 days, and how many of them have activated so far */
    newUsers30d: number;
    activated30d: number;
    rate30d: number | null;
    /** Of users first seen 1+ / 7+ days ago, the share who activated within a day / a week of arriving */
    rateWithin1Day: number | null;
    rateWithin7Days: number | null;
    /** From a user's first event to their activation */
    medianSecondsToActivate: number | null;
    allTime: { users: number; activated: number; rate: number | null };
    /**
     * Does activating early go with coming back? Users first seen 7+ days ago, split by whether they
     * activated on their first day. returnedWithin7Days / 30Days mean what they mean in retention:
     * active again on a later day (30 days: among users first seen 30+ days ago).
     */
    retention: Record<"activated" | "notActivated", { users: number; returnedWithin7Days: number | null; returnedWithin30Days: number | null }>;
  } | null;
}

const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 1000 : null);
const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 10) / 10);

export async function flowStats(
  sql: postgres.Sql,
  app: string,
  env: string,
  flows: { funnels: readonly Funnel[]; features: readonly Feature[]; activation?: Activation | null },
  tz = process.env.STATS_TZ ?? "America/Los_Angeles",
  /** Leave out the owner's own devices (?track=me) */
  withoutMe = false,
): Promise<FlowStats> {
  const scope = statsScope(sql, app, env, withoutMe);
  const day = sql`(ts at time zone ${tz})::date`;
  const today = sql`(now() at time zone ${tz})::date`;
  const match = (m: Match) =>
    Object.entries(m.where ?? {}).reduce(
      (q, [k, v]) => sql`${q} and props->>${k} = ${String(v)}`,
      m.path ? sql`name = ${m.event} and path = ${m.path}` : sql`name = ${m.event}`,
    );

  async function funnel(f: Funnel): Promise<FlowStats["funnels"][number]> {
    // Per step: every user's matching event times, oldest first
    const rows = await Promise.all(
      f.steps.map(
        (s) => sql`select device_id, array_agg(ts order by ts) times, min(ts) > now() - interval '30 days' recent
                   from analytics_events where ${scope} and ${match(s)} group by device_id`,
      ),
    );
    const times = rows.map((r) => new Map(r.map((x) => [x.device_id as string, (x.times as Date[]).map((t) => new Date(t).getTime())])));
    const last = f.steps.length - 1;
    const reached = f.steps.map(() => 0);
    const seconds: number[] = [];
    let enteredAll = 0;
    let completedAll = 0;
    for (const r of rows[0]) {
      // A step counts only if it happened at or after the step before it
      const start = times[0].get(r.device_id)![0];
      let t = start;
      let furthest = 0;
      for (let i = 1; i <= last; i++) {
        const next = times[i].get(r.device_id)?.find((x) => x >= t);
        if (next == null) break;
        t = next;
        furthest = i;
      }
      enteredAll++;
      if (furthest === last) completedAll++;
      if (!r.recent) continue;
      for (let i = 0; i <= furthest; i++) reached[i]++;
      if (furthest === last) seconds.push((t - start) / 1000);
    }
    seconds.sort((a, b) => a - b);
    const mid = seconds.length >> 1;
    return {
      key: f.key,
      label: f.label,
      entered: reached[0],
      completed: reached[last],
      completionRate: ratio(reached[last], reached[0]),
      medianSecondsToComplete: seconds.length ? numOrNull(seconds.length % 2 ? seconds[mid] : (seconds[mid - 1] + seconds[mid]) / 2) : null,
      steps: f.steps.map((s, i) => {
        const fromPrevious = i ? ratio(reached[i], reached[i - 1]) : null;
        return {
          key: s.key,
          label: s.label,
          users: reached[i],
          fromPrevious,
          dropoff: fromPrevious == null ? null : Math.round((1 - fromPrevious) * 1000) / 1000,
          fromStart: ratio(reached[i], reached[0]),
        };
      }),
      allTime: { entered: enteredAll, completed: completedAll, completionRate: ratio(completedAll, enteredAll) },
    };
  }

  async function streaks(what: postgres.PendingQuery<postgres.Row[]>, d = day): Promise<Streaks> {
    const [s] = await sql`
      with dd as (select distinct device_id, ${d} d from analytics_events where ${scope} and ${what}),
      runs as (select device_id, max(d) ends, count(*) len
               from (select device_id, d, d - (row_number() over (partition by device_id order by d))::int run from dd) x
               group by device_id, run),
      u as (select device_id, max(len) longest, max(len) filter (where ends >= ${today} - 1) current from runs group by device_id)
      select count(*) filter (where current >= 2) on2, count(*) filter (where current >= 7) on7,
        percentile_cont(0.5) within group (order by current) filter (where current is not null) median_current,
        max(longest) longest, percentile_cont(0.5) within group (order by longest) median_longest,
        count(*) filter (where longest = 1) b1, count(*) filter (where longest = 2) b2,
        count(*) filter (where longest between 3 and 6) b3, count(*) filter (where longest between 7 and 13) b7,
        count(*) filter (where longest between 14 and 29) b14, count(*) filter (where longest >= 30) b30
      from u`;
    return {
      onStreak: num(s.on2),
      onStreak7: num(s.on7),
      medianCurrent: numOrNull(s.median_current),
      longest: num(s.longest),
      medianLongest: numOrNull(s.median_longest),
      byLongest: [
        { days: "1", users: num(s.b1) },
        { days: "2", users: num(s.b2) },
        { days: "3-6", users: num(s.b3) },
        { days: "7-13", users: num(s.b7) },
        { days: "14-29", users: num(s.b14) },
        { days: "30+", users: num(s.b30) },
      ],
    };
  }

  async function feature(f: Feature, all: { users: number; users30: number }): Promise<FlowStats["features"][number]> {
    const p = f.dayProp;
    const d = p
      ? sql`case when props->>${p} in (to_char(${day} - 1, 'YYYY-MM-DD'), to_char(${day}, 'YYYY-MM-DD'), to_char(${day} + 1, 'YYYY-MM-DD'))
                 then (props->>${p})::date else ${day} end`
      : day;
    const ev = sql`ev as (select device_id, ts, ${d} d from analytics_events where ${scope} and ${match(f)})`;
    const [[a], weekly, runs] = await Promise.all([
      sql`with ${ev}, f as (select device_id, min(ts) first_ts, min(d) first_day, count(distinct d) days from ev group by device_id)
          select count(*) users,
            count(*) filter (where first_ts > now() - interval '30 days') new30,
            count(*) filter (where days >= 2) repeaters,
            count(*) filter (where first_day <= ${today} - 7) eligible7,
            count(*) filter (where first_day <= ${today} - 7 and exists (
              select 1 from ev where ev.device_id = f.device_id and ev.d between first_day + 1 and first_day + 7)) repeated7,
            (select count(distinct device_id) from ev where ts > now() - interval '30 days') users30,
            (select count(*) from ev where ts > now() - interval '30 days') uses30,
            (select count(*) from (select distinct device_id, d from ev where ts > now() - interval '30 days') x) days30
          from f`,
      sql`with ${ev}, w as (select generate_series(date_trunc('week', ${today})::date - 49, date_trunc('week', ${today})::date, interval '7 days')::date w)
          select w.w::text week, count(distinct ev.device_id) users, count(ev.device_id) uses
          from w left join ev on date_trunc('week', ev.d)::date = w.w group by w.w order by w.w`,
      streaks(match(f), d),
    ]);
    return {
      key: f.key,
      label: f.label,
      adoption: {
        users: num(a.users),
        rate: ratio(num(a.users), all.users),
        users30d: num(a.users30),
        rate30d: ratio(num(a.users30), all.users30),
        newUsers30d: num(a.new30),
      },
      engagement: {
        uses30d: num(a.uses30),
        usesPerUser30d: ratio(num(a.uses30), num(a.users30)),
        daysPerUser30d: ratio(num(a.days30), num(a.users30)),
        repeatRate: ratio(num(a.repeaters), num(a.users)),
        repeatedWithin7Days: ratio(num(a.repeated7), num(a.eligible7)),
        weekly: weekly.map((r) => ({ week: r.week, users: num(r.users), uses: num(r.uses) })),
      },
      streaks: runs,
    };
  }

  async function activation(a: Activation): Promise<NonNullable<FlowStats["activation"]>> {
    const hit = "anyOf" in a ? a.anyOf.map(match).reduce((q, m) => sql`${q} or (${m})`, sql`false`) : match(a);
    const [r] = await sql`
      with ev as (select device_id, ts, ${day} d, (${hit}) hit from analytics_events where ${scope}),
      dd as (select distinct device_id, d from ev),
      u as (select device_id, min(ts) first_ts, min(d) first_day, min(ts) filter (where hit) act_ts, min(d) filter (where hit) act_day
            from ev group by device_id),
      r as (select u.*, act_day is not distinct from first_day day0,
              exists (select 1 from dd where dd.device_id = u.device_id and dd.d between first_day + 1 and first_day + 7) back7,
              exists (select 1 from dd where dd.device_id = u.device_id and dd.d between first_day + 1 and first_day + 30) back30
            from u)
      select count(*) users, count(act_ts) activated,
        count(*) filter (where first_ts > now() - interval '30 days') new30,
        count(act_ts) filter (where first_ts > now() - interval '30 days') act30,
        count(*) filter (where first_ts <= now() - interval '1 day') elig1,
        count(*) filter (where first_ts <= now() - interval '1 day' and act_ts < first_ts + interval '1 day') in1,
        count(*) filter (where first_ts <= now() - interval '7 days') elig7,
        count(*) filter (where first_ts <= now() - interval '7 days' and act_ts < first_ts + interval '7 days') in7,
        percentile_cont(0.5) within group (order by extract(epoch from act_ts - first_ts)) filter (where act_ts is not null) median_secs,
        count(*) filter (where first_day <= ${today} - 7 and day0) a7, count(*) filter (where first_day <= ${today} - 7 and day0 and back7) a7back,
        count(*) filter (where first_day <= ${today} - 30 and day0) a30, count(*) filter (where first_day <= ${today} - 30 and day0 and back30) a30back,
        count(*) filter (where first_day <= ${today} - 7 and not day0) n7, count(*) filter (where first_day <= ${today} - 7 and not day0 and back7) n7back,
        count(*) filter (where first_day <= ${today} - 30 and not day0) n30, count(*) filter (where first_day <= ${today} - 30 and not day0 and back30) n30back
      from r`;
    return {
      label: a.label,
      newUsers30d: num(r.new30),
      activated30d: num(r.act30),
      rate30d: ratio(num(r.act30), num(r.new30)),
      rateWithin1Day: ratio(num(r.in1), num(r.elig1)),
      rateWithin7Days: ratio(num(r.in7), num(r.elig7)),
      medianSecondsToActivate: numOrNull(r.median_secs),
      allTime: { users: num(r.users), activated: num(r.activated), rate: ratio(num(r.activated), num(r.users)) },
      retention: {
        activated: { users: num(r.a7), returnedWithin7Days: ratio(num(r.a7back), num(r.a7)), returnedWithin30Days: ratio(num(r.a30back), num(r.a30)) },
        notActivated: { users: num(r.n7), returnedWithin7Days: ratio(num(r.n7back), num(r.n7)), returnedWithin30Days: ratio(num(r.n30back), num(r.n30)) },
      },
    };
  }

  const [all] = await sql`select count(distinct device_id) users, count(distinct device_id) filter (where ts > now() - interval '30 days') users30
                          from analytics_events where ${scope}`;
  const totals = { users: num(all.users), users30: num(all.users30) };
  const [funnels, features, appStreaks, activated] = await Promise.all([
    Promise.all(flows.funnels.map(funnel)),
    Promise.all(flows.features.map((f) => feature(f, totals))),
    streaks(sql`true`),
    flows.activation ? activation(flows.activation) : null,
  ]);
  return { funnels, features, appStreaks, activation: activated };
}
