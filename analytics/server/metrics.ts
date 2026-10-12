// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { ROUTE_PATTERNS, routeSource } from "../events";
import { ACTIVATION, FEATURES, FUNNELS } from "../flows";
import { appMetrics } from "./app-metrics";
import { statsScope } from "./db";
import { cohortStats, firstSessions, landedOnShare, sourceOf, type CohortStats } from "./cohort-metrics";
import { flowStats, type FlowStats } from "./flow-metrics";
import { peopleStats, type PeopleStats } from "./people-metrics";
import { sharingStats, type SharingStats } from "./sharing-metrics";
import { timelineStats, type TimelineStats } from "./timeline-metrics";

/**
 * Every number scottieryan.com shows for an app, computed from its raw events.
 * The shape is the contract between the apps and the portfolio's nightly
 * stats job, so keep it identical across apps (add fields; don't rename).
 *
 * Days are calendar days in STATS_TZ (default America/Los_Angeles). A "user"
 * is a device's browser storage: the same person on their phone and laptop
 * counts twice, a shared kiosk counts once (see `modes` for its sessions).
 */
/** The kit version these files came from. Bumped together with the marker line at the top of every kit file. */
export const KIT = 8;

export interface AppStats {
  /** Bumped only for a breaking change to this shape */
  contract: 1;
  /** Which version of the kit this app runs */
  kit: number;
  app: string;
  env: string;
  generatedAt: string;
  timezone: string;
  firstEventAt: string | null;
  /**
   * The owner's own devices, marked with ?track=me (kit v7). With excluded, every number in this report
   * leaves them out (GET /api/stats?without=me); otherwise they're counted like anyone else.
   */
  owner: { devices: number; excluded: boolean };
  totals: { users: number; sessions: number; pageviews: number };
  active: {
    /** Today so far */
    dau: number;
    /** Yesterday, a complete day */
    dauYesterday: number;
    /** The last 7 / 30 days including today */
    wau: number;
    mau: number;
    /** Average DAU over the last 30 days ÷ MAU: how many days a month a typical user comes back (×30) */
    stickiness: number | null;
  };
  /** This period against the one before it. A change is (now − before) ÷ before: 0.25 is 25% up; null when before is 0. */
  growth: {
    /** The 7 days before the current 7, and the 30 days before the current 30 */
    wauPrevious: number;
    wauChange: number | null;
    mauPrevious: number;
    mauChange: number | null;
    newUsers7d: number;
    newUsersPrevious7d: number;
    newUsers7dChange: number | null;
    newUsers30d: number;
    newUsersPrevious30d: number;
    newUsers30dChange: number | null;
  };
  /** The last 90 days, oldest first */
  daily: { date: string; users: number; newUsers: number; returningUsers: number; sessions: number; pageviews: number; mau: number; stickiness: number | null }[];
  /** The last 30 days */
  engagement: {
    sessions: number;
    sessionsPerUser: number | null;
    avgSessionSeconds: number | null;
    medianSessionSeconds: number | null;
    pagesPerSession: number | null;
    /**
     * Sessions that weren't engaged, as Google Analytics 4 counts them: one page, under 10 seconds of
     * active time and no key event. A key event is anything but the tracker's own pageview, engage,
     * share_opened and share_offered, so drawing a reading in 8 seconds isn't a bounce. (Kit v8; before
     * it, a key event didn't save a short one-page session.)
     */
    bounceRate: number | null;
    avgDailySecondsPerUser: number | null;
    /** All active time, every user and page together */
    totalSeconds: number;
  };
  retention: {
    /** Of users first seen 1+ / 7+ / 30+ days ago, the share who came back within that many days */
    returnedWithin1Day: number | null;
    returnedWithin7Days: number | null;
    returnedWithin30Days: number | null;
    /** Classic D7 / D30: of users first seen 7+ / 30+ days ago, the share active on exactly that day (D1 is returnedWithin1Day) */
    day7: number | null;
    day30: number | null;
    /**
     * Of users first seen 7+ days ago, the share whose first session bounced and who didn't come back
     * within 7 days: the people the first impression lost outright. (Kit v8)
     */
    oneAndDone: number | null;
    /** Weekly cohorts by first-seen week (Monday), the last 8: share active in each following week */
    cohorts: { week: string; users: number; weeks: (number | null)[] }[];
  };
  /**
   * Growth accounting for the last 8 weeks (Monday), oldest first. Each week's active users are new,
   * retained (also active the week before) or resurrected (back after a gap); churned were active the
   * week before and not this one. quickRatio is (new + resurrected) ÷ churned: above 1 means growing.
   * The current week is still in progress, so its churned count will fall as the week fills in.
   */
  lifecycle: { week: string; active: number; new: number; retained: number; resurrected: number; churned: number; quickRatio: number | null }[];
  /** Users by how many different days they were active in the last 30: 1, 2-3, 4-7, 8-14, 15-30 */
  activeDays30d: { days: string; users: number }[];
  shares: {
    created30d: number;
    opened30d: number;
    createdAllTime: number;
    openedAllTime: number;
    /** Users whose very first visit landed on a shared link (last 30 days) */
    newUsersFromShares30d: number;
    /** Users who shared, and that as a share of users active in the last 30 days */
    sharers30d: number;
    shareRate30d: number | null;
    opensPerShare30d: number | null;
    /** New users from shares ÷ users active in the last 30 days: the new users each active user brings in */
    kFactor30d: number | null;
    byKind30d: { kind: string; method: string; created: number }[];
  };
  /**
   * The last 30 days by page, most viewed first. Routes with an id in them (ROUTE_PATTERNS, then UUIDs,
   * numbers and long tokens) are folded into one row per route, e.g. every /readings/[id] together; dynamic
   * marks those. Times are active seconds: avgSeconds per view, medianSeconds per session that saw the page,
   * secondsPerUser per user who saw it, timeShare the page's share of all active time. entries and exits count
   * the sessions that started and ended on the page; exitRate is exits ÷ sessions.
   */
  topPages: {
    path: string;
    views: number;
    users: number;
    avgSeconds: number | null;
    dynamic: boolean;
    sessions: number;
    totalSeconds: number;
    medianSeconds: number | null;
    secondsPerUser: number | null;
    timeShare: number | null;
    entries: number;
    exits: number;
    exitRate: number | null;
  }[];
  /** Where the last 30 days' new users came from, by their first session: share, a utm_source, a referrer host or direct. returnRate: came back on a later day, so far. */
  acquisition: { source: string; newUsers: number; returned: number; returnRate: number | null }[];
  /** Sessions that landed with utm_* tags, last 30 days */
  campaigns: { source: string; medium: string; campaign: string; sessions: number; users: number }[];
  events: { name: string; count: number; users: number }[];
  modes: { mode: string; sessions: number; users: number }[];
  devices: { type: string; users: number }[];
  /** Names only, no versions. "unknown" covers rows recorded before kit v3. */
  browsers: { browser: string; users: number }[];
  operatingSystems: { os: string; users: number }[];
  /**
   * When sessions start, over the last 30 days, in the stats time zone (not each user's own):
   * all 24 hours, then Monday to Sunday.
   */
  usageByHour: { hour: number; sessions: number; users: number }[];
  usageByWeekday: { weekday: string; sessions: number; users: number }[];
  /**
   * What the app spent on model APIs (server/ai-usage.ts), in US dollars at list price
   * (server/ai-prices.ts). Windows are the last 30 days unless a name says otherwise.
   */
  ai: {
    /** This calendar month, today and yesterday, in the stats time zone */
    monthToDate: { usd: number; calls: number };
    today: { usd: number; calls: number };
    yesterday: { usd: number };
    calls30d: number;
    costUsd30d: number;
    /** The 30 days before those */
    costUsdPrevious30d: number;
    costChange: number | null;
    costUsdAllTime: number;
    callsAllTime: number;
    /** Input that wasn't cached, output, and cache reads and writes */
    inputTokens30d: number;
    outputTokens30d: number;
    cacheReadTokens30d: number;
    cacheWriteTokens30d: number;
    costPerCall30d: number | null;
    /** ÷ every user active in the last 30 days, whether or not they used an AI feature */
    costPerActiveUser30d: number | null;
    /** Users whose calls carried a device id, and the cost of those calls ÷ those users */
    users30d: number;
    costPerAiUser30d: number | null;
    /** avgInputTokens counts the whole prompt, cached or not; cacheHitShare is the part of it read from the cache */
    byFeature30d: { feature: string; calls: number; users: number; costUsd: number; costPerCall: number | null; avgInputTokens: number; avgOutputTokens: number; cacheHitShare: number | null }[];
    /** priced is false when the model has no price in ai-prices.ts and its cost is an estimate at the highest listed rate */
    byModel30d: { model: string; calls: number; fallbackCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; priced: boolean }[];
    /** How calls ended: the provider's stop reasons */
    outcomes30d: { outcome: string; calls: number }[];
    /** Hour of day in the stats time zone */
    byHour30d: { hour: number; calls: number; costUsd: number }[];
    /** The heaviest users, by the first 8 characters of their random device id */
    topUsers30d: { device: string; calls: number; costUsd: number }[];
    /** The last 30 days, oldest first */
    daily: { date: string; calls: number; costUsd: number; users: number }[];
    /** The monthly spend alert: its step, where it goes, and the last ones sent */
    alert: { thresholdUsd: number; channels: { ntfy: boolean; webhook: boolean }; sent: { period: string; level: number; usd: number; sentAt: string }[] };
    /** Models with no price in ai-prices.ts. Their cost is an estimate at the highest listed rate, so totals that include them err high. */
    unpricedModels: string[];
  };
  countries: { country: string; users: number }[];
  referrers: { referrer: string; sessions: number }[];
  /** Share of sessions launched from the Home Screen */
  standaloneShare: number | null;
  /**
   * The same behaviour compared across groups of users (server/cohort-metrics.ts): by the source every user
   * is tagged with, and by the week and month they arrived, measured over each user's own first 7 days
   */
  cohorts: Pick<CohortStats, "bySource" | "byWeek" | "byMonth">;
  /** Shared links by kind over the last 30 days: sent, opened, became a new user, activated, came back */
  shareFunnel: CohortStats["shareFunnel"];
  /**
   * Who shares, whose links land, and who brought whom (server/sharing-metrics.ts): links by kind and method,
   * the senders who bring in the most people, generations, groups, and the sender-to-opener graph
   */
  sharing: SharingStats;
  /**
   * How many people are behind the user ids, and who has the app on their Home Screen (server/people-metrics.ts):
   * ids that are someone's second, an estimate of people without them, installs, and whether installers come back more.
   */
  people: PeopleStats;
  /** Every event over time (server/timeline-metrics.ts): counts and users per day, week and month, on shared date axes */
  timeline: TimelineStats["timeline"];
  /** The latest events one by one, newest first, each with its timestamp and its user's source */
  recentEvents: TimelineStats["recentEvents"];
  /** This app's key flows (lib/analytics/flows.ts), in a shape every app shares: funnels, feature adoption, engagement and streaks */
  flows: FlowStats;
  /** Anything else this app measures (server/app-metrics.ts); the shape is up to each app */
  appMetrics: Record<string, unknown>;
}

/** What app-metrics.ts gets to build its queries: SQL fragments scoped exactly as the standard stats are. */
export interface MetricsContext {
  sql: postgres.Sql;
  /** `app = … and env = …` for a where clause on analytics_events */
  scope: postgres.PendingQuery<postgres.Row[]>;
  /** A row's calendar day in the stats time zone */
  day: postgres.PendingQuery<postgres.Row[]>;
  /** Today in the stats time zone */
  today: postgres.PendingQuery<postgres.Row[]>;
  tz: string;
}

export const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 1000 : null);
/** Events the tracker sends by itself. Every other event is a key event: something a person chose to do. (Kit v8) */
export const TRACKER_EVENTS = ["pageview", "engage", "share_opened", "share_offered"];

export const num = (v: unknown): number => Number(v ?? 0);
export const numOrNull = (v: unknown): number | null => (v == null ? null : Math.round(Number(v) * 10) / 10);

export async function appStats(
  sql: postgres.Sql,
  app: string,
  env: string,
  tz = process.env.STATS_TZ ?? "America/Los_Angeles",
  /** Leave out the owner's own devices (?track=me) */
  withoutMe = false,
): Promise<AppStats> {
  // The whole report reads one consistent snapshot of this app's events
  const scope = statsScope(sql, app, env, withoutMe);
  // A key event is anything a person did beyond what the tracker records on its own; one saves a short session from being a bounce
  const KEY_EVENT = sql`name not in ${sql(TRACKER_EVENTS)}`;
  const day = sql`(ts at time zone ${tz})::date`;
  const today = sql`(now() at time zone ${tz})::date`;
  // Pages group by route: declared patterns first, then anything that looks like an id. The tracker
  // already does this; repeating it here folds in rows recorded before a pattern was declared.
  const page = ROUTE_PATTERNS.reduceRight(
    (rest, pattern) => sql`case when path ~ ${routeSource(pattern)} then ${pattern} else ${rest} end`,
    sql`regexp_replace(path, '/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9]+|[^/]{41,})(?=/|$)', '/[id]', 'g')`,
  );
  const thisMonth = sql`date_trunc('month', ts at time zone ${tz}) = date_trunc('month', now() at time zone ${tz})`;
  const flows = flowStats(sql, app, env, { funnels: FUNNELS, features: FEATURES, activation: ACTIVATION }, tz, withoutMe);
  const groups = cohortStats(sql, app, env, { features: FEATURES, activation: ACTIVATION }, tz, withoutMe);
  const overTime = timelineStats(sql, app, env, tz, withoutMe);
  const sharing = sharingStats(sql, app, env, { activation: ACTIVATION }, tz, withoutMe);
  const people = peopleStats(sql, app, env, tz, withoutMe);
  const owners = sql`select count(*)::int n from analytics_owner_devices where app = ${app}`;
  const custom = appMetrics({ sql, scope, day, today, tz });

  const [
    [totals], [active], daily, [engagement], [retention], cohorts, [shares], shareKinds, topPages, events, modes, devices, countries, referrers, [standalone],
    lifecycle, [activeDays], acquisition, campaigns, browsers, systems, hours, weekdays,
    [aiTotals], aiDaily, aiFeatures, aiModels, aiOutcomes, aiHours, aiTop, aiAlerts,
  ] = await Promise.all([
      sql`select count(distinct device_id) users, count(distinct session_id) sessions,
            count(*) filter (where name = 'pageview') pageviews, min(ts) first
          from analytics_events where ${scope}`,

      sql`with d as (select device_id, ${day} d from analytics_events where ${scope} and ts > now() - interval '32 days')
          select count(distinct device_id) filter (where d = ${today}) dau,
                 count(distinct device_id) filter (where d = ${today} - 1) dau_yesterday,
                 count(distinct device_id) filter (where d > ${today} - 7) wau,
                 count(distinct device_id) filter (where d > ${today} - 14 and d <= ${today} - 7) wau_prev,
                 count(distinct device_id) filter (where d > ${today} - 30) mau,
                 -- Device-days ÷ days, counting quiet days as 0 (and only the days since launch for a new app)
                 (select count(*) from (select distinct device_id, d from d where d > ${today} - 30) x)::numeric
                   / least(30, ${today} - (select min(${day}) from analytics_events where ${scope}) + 1) avg_dau
          from d`,

      sql`with ev as (select device_id, session_id, name, ${day} d from analytics_events where ${scope}),
          firsts as (select device_id, min(d) first_day from ev group by device_id),
          dd as (select distinct device_id, d from ev),
          days as (select generate_series(${today} - 89, ${today}, interval '1 day')::date d)
          select days.d::text date,
            (select count(*) from dd where dd.d = days.d) users,
            (select count(*) from firsts where first_day = days.d) new_users,
            (select count(distinct session_id) from ev where ev.d = days.d) sessions,
            (select count(*) from ev where ev.d = days.d and name = 'pageview') pageviews,
            (select count(distinct device_id) from dd where dd.d > days.d - 30 and dd.d <= days.d) mau
          from days order by days.d`,

      sql`with s as (
            select session_id, device_id, count(*) filter (where name = 'pageview') pages,
              coalesce(sum((props->>'ms')::numeric) filter (where name = 'engage'), 0) / 1000 secs,
              count(*) filter (where ${KEY_EVENT}) keys
            from analytics_events where ${scope} and ts > now() - interval '30 days' group by session_id, device_id),
          ud as (select device_id, ${day} d, sum((props->>'ms')::numeric) / 1000 secs
            from analytics_events where ${scope} and name = 'engage' and ts > now() - interval '30 days' group by 1, 2)
          select count(*) sessions, count(distinct device_id) users, avg(secs) avg_secs,
            percentile_cont(0.5) within group (order by secs) median_secs,
            avg(pages) pages, count(*) filter (where pages <= 1 and secs < 10 and keys = 0) bounces, coalesce(sum(secs), 0) total_secs,
            (select avg(secs) from ud) daily_secs
          from s`,

      sql`with dd as (select distinct device_id, ${day} d from analytics_events where ${scope}),
          f as (select device_id, min(d) first_day from dd group by device_id),
          -- Each device's first session, and whether it bounced (the same rule as engagement.bounceRate)
          fs as (select distinct on (device_id) device_id, session_id, ts from analytics_events where ${scope} order by device_id, ts),
          fb as (select fs.device_id, fs.session_id, fs.ts, (
              select count(*) filter (where name = 'pageview') <= 1
                and coalesce(sum((props->>'ms')::numeric) filter (where name = 'engage'), 0) < 10000
                and count(*) filter (where ${KEY_EVENT}) = 0
              from analytics_events x where ${scope} and x.session_id = fs.session_id) bounced
            from fs)
          select
            count(*) filter (where first_day <= ${today} - 1) eligible1,
            count(*) filter (where first_day <= ${today} - 1 and exists (select 1 from dd where dd.device_id = f.device_id and dd.d between first_day + 1 and first_day + 1)) returned1,
            count(*) filter (where first_day <= ${today} - 7) eligible7,
            count(*) filter (where first_day <= ${today} - 7 and exists (select 1 from dd where dd.device_id = f.device_id and dd.d between first_day + 1 and first_day + 7)) returned7,
            count(*) filter (where first_day <= ${today} - 30) eligible30,
            count(*) filter (where first_day <= ${today} - 30 and exists (select 1 from dd where dd.device_id = f.device_id and dd.d between first_day + 1 and first_day + 30)) returned30,
            count(*) filter (where first_day <= ${today} - 7 and exists (select 1 from dd where dd.device_id = f.device_id and dd.d = first_day + 7)) on7,
            count(*) filter (where first_day <= ${today} - 30 and exists (select 1 from dd where dd.device_id = f.device_id and dd.d = first_day + 30)) on30,
            count(*) filter (where first_day <= ${today} - 7 and fb.bounced and not exists (
              select 1 from analytics_events y where ${scope} and y.device_id = f.device_id
                and y.session_id <> fb.session_id and y.ts < fb.ts + interval '7 days')) one_and_done
          from f join fb on fb.device_id = f.device_id`,

      sql`with dd as (select distinct device_id, date_trunc('week', ${day})::date w from analytics_events where ${scope}),
          f as (select device_id, min(w) cohort from dd group by device_id)
          select f.cohort::text week, (dd.w - f.cohort) / 7 n, count(*) users
          from f join dd using (device_id)
          where f.cohort > date_trunc('week', ${today})::date - 8 * 7 and dd.w - f.cohort <= 8 * 7
          group by 1, 2 order by 1, 2`,

      sql`with ev as (select device_id, session_id, ts, name, ${day} d from analytics_events where ${scope}),
          ${firstSessions(sql)}
          select
            count(*) filter (where name = 'share_created' and ts > now() - interval '30 days') created30,
            count(*) filter (where name = 'share_opened' and ts > now() - interval '30 days') opened30,
            count(*) filter (where name = 'share_created') created_all,
            count(*) filter (where name = 'share_opened') opened_all,
            count(distinct device_id) filter (where name = 'share_created' and ts > now() - interval '30 days') sharers30,
            (select count(*) from fs where fs.ts > now() - interval '30 days' and exists (
              select 1 from ev where ev.device_id = fs.device_id and ev.session_id = fs.session_id and ${landedOnShare(sql)})) new_from_shares
          from ev where name in ('share_created', 'share_opened')`,

      sql`select coalesce(props->>'kind', '') kind, coalesce(props->>'method', '') method, count(*) created
          from analytics_events where ${scope} and name = 'share_created' and ts > now() - interval '30 days'
          group by 1, 2 order by created desc`,

      sql`with ev as (
            select device_id, session_id, ts, name, ${page} page, (props->>'ms')::numeric / 1000 secs
            from analytics_events where ${scope} and name in ('pageview', 'engage') and ts > now() - interval '30 days'),
          p as (
            select page, count(*) filter (where name = 'pageview') views,
              count(distinct device_id) filter (where name = 'pageview') users,
              count(distinct session_id) filter (where name = 'pageview') sessions,
              sum(secs) filter (where name = 'engage') secs
            from ev group by page),
          -- Active time per session on each page it saw, for the median
          sp as (select session_id, page, coalesce(sum(secs) filter (where name = 'engage'), 0) secs
                 from ev group by session_id, page having count(*) filter (where name = 'pageview') > 0),
          -- The first and last page of every session
          edges as (select (array_agg(page order by ts))[1] entry, (array_agg(page order by ts desc))[1] exit
                    from ev where name = 'pageview' group by session_id)
          select p.page path, p.views, p.users, p.sessions, coalesce(p.secs, 0) total_secs,
            p.secs / nullif(p.views, 0) avg_secs,
            (select percentile_cont(0.5) within group (order by sp.secs) from sp where sp.page = p.page) median_secs,
            p.secs / nullif(p.users, 0) secs_per_user,
            coalesce(p.secs, 0) / nullif(sum(p.secs) over (), 0) time_share,
            (select count(*) from edges where entry = p.page) entries,
            (select count(*) from edges where exit = p.page) exits
          from p where p.views > 0 order by p.views desc, p.page limit 30`,

      sql`select name, count(*) count, count(distinct device_id) users
          from analytics_events where ${scope} and name not in ('pageview', 'engage') and ts > now() - interval '30 days'
          group by name order by count desc`,

      sql`select mode, count(distinct session_id) sessions, count(distinct device_id) users
          from analytics_events where ${scope} and ts > now() - interval '30 days' group by mode order by sessions desc`,

      sql`select coalesce(device_type, 'unknown') type, count(distinct device_id) users
          from analytics_events where ${scope} and ts > now() - interval '30 days' group by 1 order by users desc`,

      sql`select coalesce(country, '??') country, count(distinct device_id) users
          from analytics_events where ${scope} and ts > now() - interval '30 days' group by 1 order by users desc limit 15`,

      sql`select referrer, count(distinct session_id) sessions
          from analytics_events where ${scope} and referrer is not null and ts > now() - interval '30 days'
          group by referrer order by sessions desc limit 15`,

      sql`select count(distinct session_id) filter (where standalone) standalone, count(distinct session_id) sessions
          from analytics_events where ${scope} and ts > now() - interval '30 days'`,

      sql`with dw as (select distinct device_id, date_trunc('week', ${day})::date w from analytics_events where ${scope}),
          f as (select device_id, min(w) first from dw group by device_id),
          weeks as (select generate_series(date_trunc('week', ${today})::date - 49, date_trunc('week', ${today})::date, interval '7 days')::date w)
          select weeks.w::text week,
            (select count(*) from f where f.first = weeks.w) new,
            (select count(*) from dw a where a.w = weeks.w and exists (select 1 from dw b where b.device_id = a.device_id and b.w = weeks.w - 7)) retained,
            (select count(*) from dw a join f using (device_id) where a.w = weeks.w and f.first < weeks.w
               and not exists (select 1 from dw b where b.device_id = a.device_id and b.w = weeks.w - 7)) resurrected,
            (select count(*) from dw a where a.w = weeks.w - 7 and not exists (select 1 from dw b where b.device_id = a.device_id and b.w = weeks.w)) churned
          from weeks order by weeks.w`,

      sql`select count(*) filter (where n = 1) b1, count(*) filter (where n between 2 and 3) b2, count(*) filter (where n between 4 and 7) b4,
            count(*) filter (where n between 8 and 14) b8, count(*) filter (where n >= 15) b15
          from (select device_id, count(distinct d) n
                from (select device_id, ${day} d from analytics_events where ${scope} and ts > now() - interval '32 days') x
                where d > ${today} - 30 group by device_id) y`,

      sql`with ev as (select device_id, session_id, ts, name, referrer, utm_source, ${day} d from analytics_events where ${scope}),
          ${firstSessions(sql)},
          src as (
            select fs.device_id, fs.d, ${sourceOf(sql)} source
            from fs join ev on ev.session_id = fs.session_id
            where fs.ts > now() - interval '30 days' group by fs.device_id, fs.d)
          select source, count(*) new_users,
            count(*) filter (where exists (select 1 from ev where ev.device_id = src.device_id and ev.d > src.d)) returned
          from src group by source order by new_users desc, source limit 15`,

      sql`select coalesce(utm_source, '') source, coalesce(utm_medium, '') medium, coalesce(utm_campaign, '') campaign,
            count(distinct session_id) sessions, count(distinct device_id) users
          from analytics_events
          where ${scope} and ts > now() - interval '30 days' and (utm_source is not null or utm_medium is not null or utm_campaign is not null)
          group by 1, 2, 3 order by sessions desc limit 15`,

      sql`select coalesce(browser, 'unknown') browser, count(distinct device_id) users
          from analytics_events where ${scope} and ts > now() - interval '30 days' group by 1 order by users desc, 1 limit 15`,

      sql`select coalesce(os, 'unknown') os, count(distinct device_id) users
          from analytics_events where ${scope} and ts > now() - interval '30 days' group by 1 order by users desc, 1 limit 15`,

      sql`with s as (select session_id, device_id, extract(hour from min(ts) at time zone ${tz})::int h
                     from analytics_events where ${scope} and ts > now() - interval '30 days' group by session_id, device_id)
          select g.h as hour, count(s.session_id) sessions, count(distinct s.device_id) users
          from generate_series(0, 23) g(h) left join s on s.h = g.h group by g.h order by g.h`,

      sql`with s as (select session_id, device_id, extract(isodow from min(ts) at time zone ${tz})::int n
                     from analytics_events where ${scope} and ts > now() - interval '30 days' group by session_id, device_id)
          select g.n, count(s.session_id) sessions, count(distinct s.device_id) users
          from generate_series(1, 7) g(n) left join s on s.n = g.n group by g.n order by g.n`,

      // Model API spend (server/ai-usage.ts). cost_usd was worked out when each call was recorded.
      sql`select
            coalesce(sum(cost_usd) filter (where ${thisMonth}), 0) mtd, count(*) filter (where ${thisMonth}) mtd_calls,
            coalesce(sum(cost_usd) filter (where ${day} = ${today}), 0) today, count(*) filter (where ${day} = ${today}) today_calls,
            coalesce(sum(cost_usd) filter (where ${day} = ${today} - 1), 0) yesterday,
            coalesce(sum(cost_usd) filter (where ${day} > ${today} - 30), 0) usd30, count(*) filter (where ${day} > ${today} - 30) calls30,
            coalesce(sum(cost_usd) filter (where ${day} > ${today} - 60 and ${day} <= ${today} - 30), 0) usd_prev,
            coalesce(sum(cost_usd), 0) usd_all, count(*) calls_all,
            coalesce(sum(input_tokens) filter (where ${day} > ${today} - 30), 0) input30,
            coalesce(sum(output_tokens) filter (where ${day} > ${today} - 30), 0) output30,
            coalesce(sum(cache_read_tokens) filter (where ${day} > ${today} - 30), 0) cache_read30,
            coalesce(sum(cache_write_tokens + cache_write_1h_tokens) filter (where ${day} > ${today} - 30), 0) cache_write30,
            count(distinct device_id) filter (where ${day} > ${today} - 30) users30,
            coalesce(sum(cost_usd) filter (where ${day} > ${today} - 30 and device_id is not null), 0) attributed30
          from ai_usage where ${scope}`,

      sql`with days as (select generate_series(${today} - 29, ${today}, interval '1 day')::date d),
          u as (select ${day} d, cost_usd, device_id from ai_usage where ${scope} and ts > now() - interval '32 days')
          select days.d::text date, count(u.d) calls, coalesce(sum(u.cost_usd), 0) usd, count(distinct u.device_id) users
          from days left join u on u.d = days.d group by days.d order by days.d`,

      sql`select route feature, count(*) calls, count(distinct device_id) users, sum(cost_usd) usd,
            avg(input_tokens + cache_read_tokens + cache_write_tokens + cache_write_1h_tokens) avg_input, avg(output_tokens) avg_output,
            sum(cache_read_tokens)::float8 / nullif(sum(input_tokens + cache_read_tokens + cache_write_tokens + cache_write_1h_tokens), 0) cache_hit
          from ai_usage where ${scope} and ${day} > ${today} - 30 group by route order by usd desc, calls desc`,

      sql`select model, count(*) calls, count(*) filter (where fallback) fallback_calls, sum(input_tokens) input, sum(output_tokens) output,
            sum(cache_read_tokens) cache_read, sum(cache_write_tokens + cache_write_1h_tokens) cache_write, sum(cost_usd) usd, bool_or(estimated) estimated
          from ai_usage where ${scope} and ${day} > ${today} - 30 group by model order by usd desc, calls desc`,

      sql`select outcome, count(*) calls from ai_usage where ${scope} and ${day} > ${today} - 30 group by outcome order by calls desc, outcome`,

      sql`select extract(hour from ts at time zone ${tz})::int as hour, count(*) calls, sum(cost_usd) usd
          from ai_usage where ${scope} and ${day} > ${today} - 30 group by 1 order by 1`,

      sql`select left(device_id::text, 8) device, count(*) calls, sum(cost_usd) usd
          from ai_usage where ${scope} and ${day} > ${today} - 30 and device_id is not null group by 1 order by usd desc, calls desc limit 10`,

      sql`select period, level, usd, sent_at from ai_spend_alerts where app = ${app} and env = ${env} order by sent_at desc limit 12`,
    ]);

  const mau = num(active.mau);
  const sessions = num(engagement.sessions);
  const users30 = num(engagement.users);
  const change = (now: number, before: number): number | null => (before ? Math.round(((now - before) / before) * 1000) / 1000 : null);
  // daily holds 90 days, oldest first: the last 7 / 30 entries are the current periods
  const newIn = (from: number, to: number) => daily.slice(daily.length - from, daily.length - to).reduce((n, r) => n + num(r.new_users), 0);
  const mauPrevious = num(daily[daily.length - 31]?.mau);

  const usd = (v: unknown) => Math.round(num(v) * 1e4) / 1e4;
  const perUsd = (cost: unknown, n: number) => (n ? usd(num(cost) / n) : null);

  return {
    contract: 1,
    kit: KIT,
    app,
    env,
    generatedAt: new Date().toISOString(),
    timezone: tz,
    firstEventAt: totals.first ? new Date(totals.first).toISOString() : null,
    owner: { devices: num((await owners)[0]?.n), excluded: withoutMe },
    totals: { users: num(totals.users), sessions: num(totals.sessions), pageviews: num(totals.pageviews) },
    active: {
      dau: num(active.dau),
      dauYesterday: num(active.dau_yesterday),
      wau: num(active.wau),
      mau,
      stickiness: active.avg_dau == null ? null : ratio(Number(active.avg_dau), mau),
    },
    growth: {
      wauPrevious: num(active.wau_prev),
      wauChange: change(num(active.wau), num(active.wau_prev)),
      mauPrevious,
      mauChange: change(mau, mauPrevious),
      newUsers7d: newIn(7, 0),
      newUsersPrevious7d: newIn(14, 7),
      newUsers7dChange: change(newIn(7, 0), newIn(14, 7)),
      newUsers30d: newIn(30, 0),
      newUsersPrevious30d: newIn(60, 30),
      newUsers30dChange: change(newIn(30, 0), newIn(60, 30)),
    },
    daily: daily.map((r) => {
      const users = num(r.users);
      const newUsers = num(r.new_users);
      return {
        date: r.date,
        users,
        newUsers,
        returningUsers: users - newUsers,
        sessions: num(r.sessions),
        pageviews: num(r.pageviews),
        mau: num(r.mau),
        stickiness: ratio(users, num(r.mau)),
      };
    }),
    engagement: {
      sessions,
      sessionsPerUser: ratio(sessions, num(engagement.users)),
      avgSessionSeconds: numOrNull(engagement.avg_secs),
      medianSessionSeconds: numOrNull(engagement.median_secs),
      pagesPerSession: numOrNull(engagement.pages),
      bounceRate: ratio(num(engagement.bounces), sessions),
      avgDailySecondsPerUser: numOrNull(engagement.daily_secs),
      totalSeconds: Math.round(num(engagement.total_secs)),
    },
    retention: {
      returnedWithin1Day: ratio(num(retention.returned1), num(retention.eligible1)),
      returnedWithin7Days: ratio(num(retention.returned7), num(retention.eligible7)),
      returnedWithin30Days: ratio(num(retention.returned30), num(retention.eligible30)),
      day7: ratio(num(retention.on7), num(retention.eligible7)),
      day30: ratio(num(retention.on30), num(retention.eligible30)),
      oneAndDone: ratio(num(retention.one_and_done), num(retention.eligible7)),
      cohorts: pivotCohorts(cohorts as unknown as { week: string; n: number; users: string }[]),
    },
    lifecycle: lifecycle.map((r) => {
      const [fresh, retained, resurrected, churned] = [num(r.new), num(r.retained), num(r.resurrected), num(r.churned)];
      return { week: r.week, active: fresh + retained + resurrected, new: fresh, retained, resurrected, churned, quickRatio: ratio(fresh + resurrected, churned) };
    }),
    activeDays30d: [
      { days: "1", users: num(activeDays.b1) },
      { days: "2-3", users: num(activeDays.b2) },
      { days: "4-7", users: num(activeDays.b4) },
      { days: "8-14", users: num(activeDays.b8) },
      { days: "15-30", users: num(activeDays.b15) },
    ],
    shares: {
      created30d: num(shares?.created30),
      opened30d: num(shares?.opened30),
      createdAllTime: num(shares?.created_all),
      openedAllTime: num(shares?.opened_all),
      newUsersFromShares30d: num(shares?.new_from_shares),
      sharers30d: num(shares?.sharers30),
      shareRate30d: ratio(num(shares?.sharers30), users30),
      opensPerShare30d: ratio(num(shares?.opened30), num(shares?.created30)),
      kFactor30d: ratio(num(shares?.new_from_shares), users30),
      byKind30d: shareKinds.map((r) => ({ kind: r.kind, method: r.method, created: num(r.created) })),
    },
    topPages: topPages.map((r) => ({
      path: r.path,
      views: num(r.views),
      users: num(r.users),
      avgSeconds: numOrNull(r.avg_secs),
      dynamic: r.path.includes("["),
      sessions: num(r.sessions),
      totalSeconds: Math.round(num(r.total_secs)),
      medianSeconds: numOrNull(r.median_secs),
      secondsPerUser: numOrNull(r.secs_per_user),
      timeShare: r.time_share == null ? null : Math.round(Number(r.time_share) * 1000) / 1000,
      entries: num(r.entries),
      exits: num(r.exits),
      exitRate: ratio(num(r.exits), num(r.sessions)),
    })),
    acquisition: acquisition.map((r) => ({ source: r.source, newUsers: num(r.new_users), returned: num(r.returned), returnRate: ratio(num(r.returned), num(r.new_users)) })),
    campaigns: campaigns.map((r) => ({ source: r.source, medium: r.medium, campaign: r.campaign, sessions: num(r.sessions), users: num(r.users) })),
    events: events.map((r) => ({ name: r.name, count: num(r.count), users: num(r.users) })),
    modes: modes.map((r) => ({ mode: r.mode, sessions: num(r.sessions), users: num(r.users) })),
    devices: devices.map((r) => ({ type: r.type, users: num(r.users) })),
    browsers: browsers.map((r) => ({ browser: r.browser, users: num(r.users) })),
    operatingSystems: systems.map((r) => ({ os: r.os, users: num(r.users) })),
    usageByHour: hours.map((r) => ({ hour: num(r.hour), sessions: num(r.sessions), users: num(r.users) })),
    usageByWeekday: weekdays.map((r) => ({ weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][num(r.n) - 1], sessions: num(r.sessions), users: num(r.users) })),
    ai: {
      monthToDate: { usd: usd(aiTotals.mtd), calls: num(aiTotals.mtd_calls) },
      today: { usd: usd(aiTotals.today), calls: num(aiTotals.today_calls) },
      yesterday: { usd: usd(aiTotals.yesterday) },
      calls30d: num(aiTotals.calls30),
      costUsd30d: usd(aiTotals.usd30),
      costUsdPrevious30d: usd(aiTotals.usd_prev),
      costChange: change(num(aiTotals.usd30), num(aiTotals.usd_prev)),
      costUsdAllTime: usd(aiTotals.usd_all),
      callsAllTime: num(aiTotals.calls_all),
      inputTokens30d: num(aiTotals.input30),
      outputTokens30d: num(aiTotals.output30),
      cacheReadTokens30d: num(aiTotals.cache_read30),
      cacheWriteTokens30d: num(aiTotals.cache_write30),
      costPerCall30d: perUsd(aiTotals.usd30, num(aiTotals.calls30)),
      costPerActiveUser30d: perUsd(aiTotals.usd30, users30),
      users30d: num(aiTotals.users30),
      costPerAiUser30d: perUsd(aiTotals.attributed30, num(aiTotals.users30)),
      byFeature30d: aiFeatures.map((r) => ({
        feature: r.feature,
        calls: num(r.calls),
        users: num(r.users),
        costUsd: usd(r.usd),
        costPerCall: perUsd(r.usd, num(r.calls)),
        avgInputTokens: Math.round(num(r.avg_input)),
        avgOutputTokens: Math.round(num(r.avg_output)),
        cacheHitShare: r.cache_hit == null ? null : Math.round(Number(r.cache_hit) * 1000) / 1000,
      })),
      byModel30d: aiModels.map((r) => ({
        model: r.model,
        calls: num(r.calls),
        fallbackCalls: num(r.fallback_calls),
        inputTokens: num(r.input),
        outputTokens: num(r.output),
        cacheReadTokens: num(r.cache_read),
        cacheWriteTokens: num(r.cache_write),
        costUsd: usd(r.usd),
        priced: !r.estimated,
      })),
      outcomes30d: aiOutcomes.map((r) => ({ outcome: r.outcome, calls: num(r.calls) })),
      byHour30d: aiHours.map((r) => ({ hour: num(r.hour), calls: num(r.calls), costUsd: usd(r.usd) })),
      topUsers30d: aiTop.map((r) => ({ device: r.device, calls: num(r.calls), costUsd: usd(r.usd) })),
      daily: aiDaily.map((r) => ({ date: r.date, calls: num(r.calls), costUsd: usd(r.usd), users: num(r.users) })),
      alert: {
        thresholdUsd: Number(process.env.SPEND_ALERT_USD ?? 10),
        channels: { ntfy: !!process.env.SPEND_ALERT_NTFY_TOPIC, webhook: !!process.env.SPEND_ALERT_WEBHOOK_URL },
        sent: aiAlerts.map((a) => ({ period: a.period, level: num(a.level), usd: num(a.usd), sentAt: new Date(a.sent_at).toISOString() })),
      },
      unpricedModels: aiModels.filter((r) => r.estimated).map((r) => r.model as string).sort(),
    },
    countries: countries.map((r) => ({ country: r.country, users: num(r.users) })),
    referrers: referrers.map((r) => ({ referrer: r.referrer, sessions: num(r.sessions) })),
    standaloneShare: ratio(num(standalone.standalone), num(standalone.sessions)),
    cohorts: await groups.then(({ bySource, byWeek, byMonth }) => ({ bySource, byWeek, byMonth })),
    shareFunnel: (await groups).shareFunnel,
    sharing: await sharing,
    people: await people,
    timeline: (await overTime).timeline,
    recentEvents: (await overTime).recentEvents,
    flows: await flows,
    appMetrics: await custom,
  };
}

/** Rows of (cohort week, weeks later, active users) → one row per cohort with weeks 1–8 as shares of week 0. */
function pivotCohorts(rows: { week: string; n: number; users: string }[]): AppStats["retention"]["cohorts"] {
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const counts = byWeek.get(r.week) ?? Array<number>(9).fill(0);
    counts[Number(r.n)] = Number(r.users);
    byWeek.set(r.week, counts);
  }
  const now = Date.now();
  return [...byWeek].map(([week, counts]) => {
    const start = new Date(`${week}T00:00:00Z`).getTime();
    return {
      week,
      users: counts[0],
      // Weeks that haven't started yet are null, not 0%
      weeks: counts.slice(1).map((n, i) => (start + (i + 1) * 7 * 86400000 > now ? null : ratio(n, counts[0]))),
    };
  });
}
