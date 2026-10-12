// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { statsScope } from "./db";
import type { Activation, Feature, Match } from "./flow-metrics";

/**
 * The same behaviour, compared across groups of users:
 *
 * - by where they came from. Every user is tagged with the source of their very
 *   first session: "share" (it opened a shared link), a utm_source, a referrer
 *   host, or "direct". The tag is worked out from the events when the stats are
 *   read, so it covers every user there has ever been.
 * - by when they arrived: the week and the month of their first visit. Reading
 *   down the weeks shows whether newer users behave differently from older ones.
 *
 * To keep groups of different ages comparable, behaviour is measured over each
 * user's own first 7 days, and only among users whose first 7 days are over.
 * A group that is too young for a number shows null, never a low number.
 *
 * shareFunnel follows shared links by kind: sent, opened, became a new user,
 * activated, came back.
 */
export interface Cohort {
  /** The source, the Monday of the week (YYYY-MM-DD), or the month (YYYY-MM) */
  cohort: string;
  users: number;
  /** Users first seen 7+ and 30+ days ago: the base for the first-week numbers and for 30-day return */
  usersWithFullWeek: number;
  usersWithFullMonth: number;
  /** Active again the next day / within 7 / within 30 days, among users old enough to judge (as in `retention`) */
  returnedWithin1Day: number | null;
  returnedWithin7Days: number | null;
  returnedWithin30Days: number | null;
  /** Reached the activation event on their first day (among users first seen 1+ days ago) / within their first 7 days */
  activatedFirstDay: number | null;
  activatedWithin7Days: number | null;
  /** Each user's own first 7 days, averaged over users whose first 7 days are over */
  firstWeek: {
    sessionsPerUser: number | null;
    activeDaysPerUser: number | null;
    activeSecondsPerUser: number | null;
    /** Share of users who shared something */
    shared: number | null;
    /** Share of users who used each key feature, by its key */
    features: Record<string, number | null>;
  };
}

export interface CohortStats {
  /** All users ever, by the source of their first session; the ten largest */
  bySource: Cohort[];
  /** The last 8 weeks (Monday) and the last 6 months that anyone arrived in, oldest first */
  byWeek: Cohort[];
  byMonth: Cohort[];
  /**
   * Shared links over the last 30 days, by kind, with "all" last. opens are page loads and openers are
   * people. newUsers are people whose very first session opened a link of that kind; activated and returned
   * are how many of those have reached the activation event and come back on a later day, so far.
   */
  shareFunnel: {
    kind: string;
    created: number;
    sharers: number;
    opens: number;
    openers: number;
    newUsers: number;
    activated: number;
    returned: number;
    /** opens ÷ created; newUsers ÷ openers; activated ÷ newUsers; returned ÷ newUsers */
    opensPerShare: number | null;
    newUserRate: number | null;
    activationRate: number | null;
    returnRate: number | null;
  }[];
}

/**
 * Each user's first session, as a CTE named `fs` over a CTE named `ev` (device_id, session_id, ts, name, d):
 * when it began, and when its landing page ended (its second pageview, if it had one).
 */
export const firstSessions = (sql: postgres.Sql) => sql`
  fs as (
    select f.device_id, f.session_id, f.ts, f.d,
      (select p.ts from ev p where p.device_id = f.device_id and p.session_id = f.session_id and p.name = 'pageview'
       order by p.ts offset 1 limit 1) next_page
    from (select distinct on (device_id) device_id, session_id, ts, d from ev order by device_id, ts) f)`;

/** An event of a first session (`ev` joined to `fs`) is a shared link being opened on the page the user landed on */
export const landedOnShare = (sql: postgres.Sql) => sql`ev.name = 'share_opened' and (fs.next_page is null or ev.ts < fs.next_page)`;

/**
 * A user's source, from the events of their first session (`ev` joined to `fs`, grouped by user): "share"
 * if they landed on a shared link, else the session's utm_source, else its referrer host, else "direct".
 * A link opened later in the visit doesn't count: the source is how the user arrived. The one definition
 * behind `cohorts.bySource`, `shareFunnel`, `acquisition`, `shares.newUsersFromShares30d` and `recentEvents`.
 */
export const sourceOf = (sql: postgres.Sql) => sql`
  case when bool_or(${landedOnShare(sql)}) then 'share'
       when max(ev.utm_source) is not null then max(ev.utm_source)
       when max(ev.referrer) is not null then max(ev.referrer)
       else 'direct' end`;

const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 1000 : null);
const num = (v: unknown): number => Number(v ?? 0);
const per = (total: unknown, n: number): number | null => (n ? Math.round((num(total) / n) * 10) / 10 : null);

export async function cohortStats(
  sql: postgres.Sql,
  app: string,
  env: string,
  flows: { features: readonly Feature[]; activation?: Activation | null },
  tz = process.env.STATS_TZ ?? "America/Los_Angeles",
  /** Leave out the owner's own devices (?track=me) */
  withoutMe = false,
): Promise<CohortStats> {
  const scope = statsScope(sql, app, env, withoutMe);
  const day = sql`(ts at time zone ${tz})::date`;
  const today = sql`(now() at time zone ${tz})::date`;
  const match = (m: Match) =>
    Object.entries(m.where ?? {}).reduce(
      (q, [k, v]) => sql`${q} and props->>${k} = ${String(v)}`,
      m.path ? sql`name = ${m.event} and path = ${m.path}` : sql`name = ${m.event}`,
    );
  const a = flows.activation;
  const hit = !a ? sql`false` : "anyOf" in a ? a.anyOf.map(match).reduce((q, m) => sql`${q} or (${m})`, sql`false`) : match(a);
  const col = (i: number) => sql(`f${i}`);
  // One extra column per key feature: whether an event is a use of it, whether a user used it in their first week, how many did
  const isFeature = flows.features.reduce((q, f, i) => sql`${q}, (${match(f)}) ${col(i)}`, sql``);
  const usedFeature = flows.features.reduce((q, _, i) => sql`${q}, coalesce(bool_or(ev.${col(i)} and ev.d <= u.first_day + 6), false) ${col(i)}`, sql``);
  const countFeature = flows.features.reduce((q, _, i) => sql`${q}, count(*) filter (where e7 and ${col(i)}) ${col(i)}`, sql``);

  // Every user's source: what their first session carried
  const sources = sql`
    ${firstSessions(sql)},
    src as (
      select fs.device_id, ${sourceOf(sql)} source,
        min(ev.kind) filter (where ${landedOnShare(sql)}) share_kind
      from fs join ev on ev.session_id = fs.session_id and ev.device_id = fs.device_id group by fs.device_id)`;

  const [groups, shareKinds, shareArrivals] = await Promise.all([
    sql`with ev as (
          select device_id, session_id, ts, name, referrer, utm_source, coalesce(props->>'kind', 'unknown') kind, ${day} d,
            case when name = 'engage' then (props->>'ms')::numeric / 1000 else 0 end secs, (${hit}) hit ${isFeature}
          from analytics_events where ${scope}),
        u as (select device_id, min(d) first_day from ev group by device_id),
        ${sources},
        -- What each user did in their own first 7 days, and whether they came back after their first day
        b as (
          select u.device_id, u.first_day,
            count(distinct ev.session_id) filter (where ev.d <= u.first_day + 6) sessions7,
            count(distinct ev.d) filter (where ev.d <= u.first_day + 6) days7,
            coalesce(sum(ev.secs) filter (where ev.d <= u.first_day + 6), 0) secs7,
            coalesce(bool_or(ev.d = u.first_day + 1), false) back1,
            coalesce(bool_or(ev.d between u.first_day + 1 and u.first_day + 7), false) back7,
            coalesce(bool_or(ev.d between u.first_day + 1 and u.first_day + 30), false) back30,
            coalesce(bool_or(ev.name = 'share_created' and ev.d <= u.first_day + 6), false) shared7,
            min(ev.d) filter (where ev.hit) act_day ${usedFeature}
          from u join ev using (device_id) group by u.device_id, u.first_day),
        x as (
          select b.*, src.source, date_trunc('week', b.first_day)::date wk, to_char(b.first_day, 'YYYY-MM') mo,
            b.first_day <= ${today} - 1 e1, b.first_day <= ${today} - 7 e7, b.first_day <= ${today} - 30 e30
          from b join src using (device_id))
        select grouping(source, wk, mo) g, source, wk::text wk, mo, count(*) users,
          count(*) filter (where e1) users1, count(*) filter (where e7) users7, count(*) filter (where e30) users30,
          count(*) filter (where e1 and back1) back1, count(*) filter (where e7 and back7) back7, count(*) filter (where e30 and back30) back30,
          count(*) filter (where e1 and act_day = first_day) act0, count(*) filter (where e7 and act_day <= first_day + 6) act7,
          sum(sessions7) filter (where e7) sessions7, sum(days7) filter (where e7) days7, sum(secs7) filter (where e7) secs7,
          count(*) filter (where e7 and shared7) shared7 ${countFeature}
        from x group by grouping sets ((source), (wk), (mo))`,

    sql`select grouping(kind) total, kind,
          count(*) filter (where name = 'share_created') created, count(distinct device_id) filter (where name = 'share_created') sharers,
          count(*) filter (where name = 'share_opened') opens, count(distinct device_id) filter (where name = 'share_opened') openers
        from (select device_id, name, coalesce(props->>'kind', 'unknown') kind from analytics_events
              where ${scope} and name in ('share_created', 'share_opened') and ts > now() - interval '30 days') s
        group by rollup (kind)`,

    sql`with ev as (
          select device_id, session_id, ts, name, referrer, utm_source, coalesce(props->>'kind', 'unknown') kind, ${day} d, (${hit}) hit
          from analytics_events where ${scope}),
        u as (select device_id, min(ts) first_ts, min(d) first_day, max(d) last_day, bool_or(hit) activated from ev group by device_id),
        ${sources}
        select grouping(src.share_kind) total, src.share_kind kind, count(*) new_users,
          count(*) filter (where u.activated) activated, count(*) filter (where u.last_day > u.first_day) returned
        from src join u using (device_id)
        where src.share_kind is not null and u.first_ts > now() - interval '30 days'
        group by rollup (src.share_kind)`,
  ]);

  const cohort = (name: string, r: postgres.Row): Cohort => {
    const [users1, users7, users30] = [num(r.users1), num(r.users7), num(r.users30)];
    return {
      cohort: name,
      users: num(r.users),
      usersWithFullWeek: users7,
      usersWithFullMonth: users30,
      returnedWithin1Day: ratio(num(r.back1), users1),
      returnedWithin7Days: ratio(num(r.back7), users7),
      returnedWithin30Days: ratio(num(r.back30), users30),
      activatedFirstDay: a ? ratio(num(r.act0), users1) : null,
      activatedWithin7Days: a ? ratio(num(r.act7), users7) : null,
      firstWeek: {
        sessionsPerUser: per(r.sessions7, users7),
        activeDaysPerUser: per(r.days7, users7),
        activeSecondsPerUser: per(r.secs7, users7),
        shared: ratio(num(r.shared7), users7),
        features: Object.fromEntries(flows.features.map((f, i) => [f.key, ratio(num(r[`f${i}`]), users7)])),
      },
    };
  };
  // grouping(source, wk, mo) sets a bit for each column a row is NOT grouped by: 3 = by source, 5 = by week, 6 = by month
  const by = (g: number, key: "source" | "wk" | "mo") => groups.filter((r) => num(r.g) === g).map((r) => cohort(r[key], r));

  const arrivals = (r: postgres.Row) => (num(r.total) ? "all" : (r.kind as string));
  const arrived = new Map(shareArrivals.map((r) => [arrivals(r), r]));
  const kinds = new Map(shareKinds.map((r) => [arrivals(r), r]));
  const names = [...new Set([...kinds.keys(), ...arrived.keys()])].filter((k) => k !== "all");
  const funnel = (kind: string) => {
    const [k, n] = [kinds.get(kind), arrived.get(kind)];
    const [created, openers, newUsers] = [num(k?.created), num(k?.openers), num(n?.new_users)];
    return {
      kind,
      created,
      sharers: num(k?.sharers),
      opens: num(k?.opens),
      openers,
      newUsers,
      activated: num(n?.activated),
      returned: num(n?.returned),
      opensPerShare: ratio(num(k?.opens), created),
      newUserRate: ratio(newUsers, openers),
      activationRate: a ? ratio(num(n?.activated), newUsers) : null,
      returnRate: ratio(num(n?.returned), newUsers),
    };
  };

  return {
    bySource: by(3, "source").sort((p, q) => q.users - p.users || p.cohort.localeCompare(q.cohort)).slice(0, 10),
    byWeek: by(5, "wk").sort((p, q) => p.cohort.localeCompare(q.cohort)).slice(-8),
    byMonth: by(6, "mo").sort((p, q) => p.cohort.localeCompare(q.cohort)).slice(-6),
    shareFunnel: [...names.map(funnel).sort((p, q) => q.opens + q.created - (p.opens + p.created) || p.kind.localeCompare(q.kind)), funnel("all")],
  };
}
