// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { statsScope } from "./db";

/**
 * How many people are behind the user ids, and who has the app on their Home Screen.
 *
 * A "user" is a random id kept in one browser's storage, and one person can have several. Two kinds of
 * second id can be told from the events:
 *
 * - A Home Screen copy: an id whose very first event came from a Home Screen launch. A Home Screen app can
 *   only be added from a browser, so its owner had been here before under the browser's id. Installs made
 *   since kit v6 bring the browser's id with them and don't make one of these.
 * - A merged id: the id a browser had before it took on the one a link to yourself carried (device_merged).
 *
 * estimatedPeople leaves both out. It's still an upper bound: two browsers on one phone, or a phone and a
 * laptop, can't be told apart from two people.
 */
export interface PeopleStats {
  /** Every id ever seen: the same number as totals.users */
  users: number;
  duplicates: {
    /** Ids born in a Home Screen app that didn't bring its browser's id along */
    homeScreen: number;
    /** Ids left behind when their browser took on a carried id */
    merged: number;
  };
  /** users − duplicates */
  estimatedPeople: number;
  installs: {
    /** Users who have ever opened the app from the Home Screen, and that as a share of estimatedPeople */
    installers: number;
    installRate: number | null;
    /** First launches recorded as app_installed (since kit v6): the last 30 days, all time, and how many kept their browser's id */
    recorded30d: number;
    recordedAllTime: number;
    carried: number;
    carriedRate: number | null;
    /** From a user's first visit to their first Home Screen launch, where both are under one id */
    medianSecondsToInstall: number | null;
    /**
     * Users first seen 7+ days ago, split by whether they opened the app from the Home Screen on their first
     * day: the share active again within 7 and 30 days of arriving (30 days: of those first seen 30+ days ago).
     * First day only, as with activation: counting anyone who ever installed would count coming back as a cause of itself.
     */
    retention: Record<"installedFirstDay" | "others", { users: number; returnedWithin7Days: number | null; returnedWithin30Days: number | null }>;
  };
  /** The last 8 weeks (Monday), oldest first: new ids, how many of them were a second id of someone already counted (of either kind), and the rest */
  byWeek: { week: string; newUsers: number; homeScreenCopies: number; merged: number; estimatedNewPeople: number }[];
}

const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 1000 : null);
const num = (v: unknown): number => Number(v ?? 0);

export async function peopleStats(sql: postgres.Sql, app: string, env: string, tz = process.env.STATS_TZ ?? "America/Los_Angeles", withoutMe = false): Promise<PeopleStats> {
  // withoutMe leaves out the owner's own devices (?track=me)
  const scope = statsScope(sql, app, env, withoutMe);
  const day = sql`(ts at time zone ${tz})::date`;
  const today = sql`(now() at time zone ${tz})::date`;
  // One row per id: when it arrived, whether it was born on the Home Screen, and whether it's someone's second id
  const users = sql`
    ev as (select device_id, ts, name, standalone, props, ${day} d from analytics_events where ${scope}),
    gone as (select distinct lower(props->>'from') id from ev where name = 'device_merged'),
    u as (
      select x.*,
        -- An id that took another one over is the person; the one it took over is the copy
        (born_standalone and not absorbed) as home_copy,
        (not (born_standalone and not absorbed) and exists (select 1 from gone where gone.id = x.device_id::text)) as merged_away
      from (
        select device_id, min(ts) first_ts, min(d) first_day,
          (array_agg(standalone order by ts))[1] born_standalone,
          bool_or(standalone) installed,
          coalesce(min(d) filter (where standalone) = min(d), false) installed_day1,
          min(ts) filter (where standalone) first_standalone,
          bool_or(name = 'device_merged') absorbed
        from ev group by device_id) x)`;

  const [[t], [e], kept, weeks] = await Promise.all([
    sql`with ${users}
        select count(*) users, count(*) filter (where home_copy) home_copies, count(*) filter (where merged_away) merged,
          count(*) filter (where installed) installers,
          percentile_cont(0.5) within group (order by extract(epoch from first_standalone - first_ts))
            filter (where installed and not born_standalone) median_secs
        from u`,

    sql`select count(*) filter (where ts > now() - interval '30 days') recent, count(*) total,
          count(*) filter (where props->>'carried' = 'true') carried
        from analytics_events where ${scope} and name = 'app_installed'`,

    sql`with ${users}, dd as (select distinct device_id, d from ev)
        select u.installed_day1,
          count(*) filter (where first_day <= ${today} - 7) eligible7,
          count(*) filter (where first_day <= ${today} - 7 and exists (
            select 1 from dd where dd.device_id = u.device_id and dd.d between first_day + 1 and first_day + 7)) back7,
          count(*) filter (where first_day <= ${today} - 30) eligible30,
          count(*) filter (where first_day <= ${today} - 30 and exists (
            select 1 from dd where dd.device_id = u.device_id and dd.d between first_day + 1 and first_day + 30)) back30
        from u group by u.installed_day1`,

    sql`with ${users}, w as (select generate_series(date_trunc('week', ${today})::date - 49, date_trunc('week', ${today})::date, interval '7 days')::date w)
        select w.w::text week, count(u.device_id) new_users, count(u.device_id) filter (where u.home_copy) home_copies,
          count(u.device_id) filter (where u.merged_away) merged
        from w left join u on date_trunc('week', u.first_day)::date = w.w group by w.w order by w.w`,
  ]);

  const split = (installed: boolean) => {
    const r = kept.find((k) => k.installed_day1 === installed);
    return { users: num(r?.eligible7), returnedWithin7Days: ratio(num(r?.back7), num(r?.eligible7)), returnedWithin30Days: ratio(num(r?.back30), num(r?.eligible30)) };
  };
  const estimatedPeople = num(t.users) - num(t.home_copies) - num(t.merged);
  return {
    users: num(t.users),
    duplicates: { homeScreen: num(t.home_copies), merged: num(t.merged) },
    estimatedPeople,
    installs: {
      installers: num(t.installers),
      installRate: ratio(num(t.installers), estimatedPeople),
      recorded30d: num(e.recent),
      recordedAllTime: num(e.total),
      carried: num(e.carried),
      carriedRate: ratio(num(e.carried), num(e.total)),
      medianSecondsToInstall: t.median_secs == null ? null : Math.round(Number(t.median_secs)),
      retention: { installedFirstDay: split(true), others: split(false) },
    },
    byWeek: weeks.map((r) => ({
      week: r.week,
      newUsers: num(r.new_users),
      homeScreenCopies: num(r.home_copies),
      merged: num(r.merged),
      estimatedNewPeople: num(r.new_users) - num(r.home_copies) - num(r.merged),
    })),
  };
}
