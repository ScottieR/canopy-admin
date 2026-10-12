// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import type postgres from "postgres";
import { statsScope } from "./db";
import { firstSessions, sourceOf } from "./cohort-metrics";
import type { Activation, Match } from "./flow-metrics";

/**
 * Who shares, whose links land, and who brought whom.
 *
 * Every link made with trackedLink() carries its own id, recorded when the link
 * is sent (share_created), when it's put on screen (share_offered), and when
 * someone opens it (share_opened). That ties each open to the person who sent
 * the link, which gives:
 *
 * - links: how links of each kind and method do. Was it opened, by how many
 *   people, how many of them were new.
 * - ambassadors: the same per sender, with their best kind of link and
 *   everyone who arrived downstream of them.
 * - generations: how far from an original user each user is.
 * - groups: sets of users connected to each other through shares.
 * - edges and nodes: the raw graph, sender to opener, for cluster analysis.
 *
 * A user is someone's recruit when their very first visit landed on that
 * person's link. Opening your own link doesn't count as an open. Links from
 * before ids existed, opens of links nobody is known to have sent, and links
 * people send to themselves (trackedLink with self, such as a backup) are
 * left out. Users appear by the first 8 characters of their random device id.
 */
export interface SharingStats {
  /** By kind and method, most opened first, with "all" last. A link that was only ever shown has its method marked `_shown`. */
  links: {
    kind: string;
    method: string;
    links: number;
    /** Links opened by at least one other person, and that as a share of links */
    opened: number;
    openRate: number | null;
    /** People who opened them, counted once per link */
    openers: number;
    recruits: number;
    recruitsPerLink: number | null;
    /** From the link being made to its first open */
    medianSecondsToOpen: number | null;
  }[];
  /** The 25 senders who brought in the most people */
  ambassadors: {
    user: string;
    /** The owner's own device (?track=me): how your own shares do */
    me: boolean;
    source: string;
    firstSeen: string;
    /** 0 arrived on their own; 1 was brought by a 0; and so on */
    generation: number;
    invitedBy: string | null;
    links: number;
    opened: number;
    openRate: number | null;
    /** Different people who opened any of their links */
    openers: number;
    /** New users whose first visit landed on one of their links, and how many of those activated and came back */
    recruits: number;
    activated: number;
    returned: number;
    /** Everyone downstream: their recruits, their recruits' recruits, and so on */
    descendants: number;
    byKind: { kind: string; links: number; opened: number; recruits: number }[];
    /** The kind with the most recruits per link (then opens per link); null if nothing of theirs was opened */
    bestKind: string | null;
  }[];
  generations: { generation: number; users: number; sharers: number; activated: number | null }[];
  /** Users joined to each other by shares, two or more, largest first (up to 20). reciprocalPairs shared with each other both ways. */
  groups: { members: number; users: string[]; links: number; recruits: number; reciprocalPairs: number }[];
  /** One row per sender and opener, newest first (up to 1,000). kind and method are those of the first link opened. */
  edges: {
    from: string;
    to: string;
    kind: string;
    method: string;
    firstOpenedAt: string;
    opens: number;
    /** `to` is a new user who arrived through `from` */
    recruited: boolean;
    toActivated: boolean;
    toReturned: boolean;
    toShared: boolean;
  }[];
  /** Everyone who sent a link with an id or opened one (up to 1,000) */
  nodes: { user: string; source: string; firstSeen: string; generation: number; invitedBy: string | null; activated: boolean; links: number; recruits: number }[];
}

const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 1000 : null);
const num = (v: unknown): number => Number(v ?? 0);

export async function sharingStats(
  sql: postgres.Sql,
  app: string,
  env: string,
  flows: { activation?: Activation | null },
  tz = process.env.STATS_TZ ?? "America/Los_Angeles",
  /** Leave out the owner's own devices (?track=me) */
  withoutMe = false,
): Promise<SharingStats> {
  const scope = statsScope(sql, app, env, withoutMe);
  const day = sql`(ts at time zone ${tz})::date`;
  const match = (m: Match) =>
    Object.entries(m.where ?? {}).reduce(
      (q, [k, v]) => sql`${q} and props->>${k} = ${String(v)}`,
      m.path ? sql`name = ${m.event} and path = ${m.path}` : sql`name = ${m.event}`,
    );
  const a = flows.activation;
  const hit = !a ? sql`false` : "anyOf" in a ? a.anyOf.map(match).reduce((q, m) => sql`${q} or (${m})`, sql`false`) : match(a);

  // The links that carry an id, who made each, every open by someone else, and who arrived through whom
  const graph = sql`
    ev as (select device_id, session_id, ts, name, referrer, utm_source, props, ${day} d, (${hit}) hit from analytics_events where ${scope}),
    ${firstSessions(sql)},
    made as (
      select distinct on (share) share, device_id sharer, kind, method, ts made_at
      from (select props->>'share' share, device_id, ts, name = 'share_created' sent, coalesce(props->>'kind', 'unknown') kind,
              coalesce(props->>'method', 'unknown') || case when name = 'share_created' then '' else '_shown' end method
            from ev where name in ('share_created', 'share_offered') and props ? 'share' and coalesce(props->>'self', '') <> 'true') x
      -- A link that was sent counts as sent, even if it was shown first
      order by share, sent desc, ts),
    opens as (
      select m.share, m.sharer, m.kind, m.method, m.made_at, e.device_id opener, e.session_id, e.ts
      from ev e join made m on m.share = e.props->>'share'
      where e.name = 'share_opened' and e.device_id <> m.sharer),
    u as (select device_id, min(d) first_day, max(d) last_day, bool_or(hit) activated, bool_or(name = 'share_created') shared from ev group by device_id),
    recruits as (
      select distinct on (fs.device_id) fs.device_id recruit, o.sharer, o.share, o.kind, o.method
      from fs join opens o on o.opener = fs.device_id and o.session_id = fs.session_id and (fs.next_page is null or o.ts < fs.next_page)
      order by fs.device_id, o.ts)`;

  const [byLink, bySharer, edgeRows, nodeRows, ownerRows] = await Promise.all([
    sql`with ${graph},
        o as (select share, count(distinct opener) openers, min(ts) first_open from opens group by share),
        r as (select share, count(*) n from recruits group by share)
        select grouping(m.kind, m.method) total, m.kind, m.method, count(*) links, count(o.share) opened,
          coalesce(sum(o.openers), 0) openers, coalesce(sum(r.n), 0) recruits,
          percentile_cont(0.5) within group (order by extract(epoch from o.first_open - m.made_at)) filter (where o.share is not null) median_secs
        from made m left join o using (share) left join r using (share)
        group by grouping sets ((m.kind, m.method), ())`,

    sql`with ${graph},
        o as (select distinct share from opens),
        r as (select share, count(*) n from recruits group by share)
        select m.sharer, m.kind, count(*) links, count(o.share) opened, coalesce(sum(r.n), 0) recruits
        from made m left join o using (share) left join r using (share) group by m.sharer, m.kind`,

    sql`with ${graph}
        select o.sharer, o.opener, count(*) opens, min(o.ts) first_at,
          (array_agg(o.kind order by o.ts))[1] kind, (array_agg(o.method order by o.ts))[1] method,
          exists (select 1 from recruits r where r.recruit = o.opener and r.sharer = o.sharer) recruited
        from opens o group by o.sharer, o.opener order by first_at desc`,

    sql`with ${graph},
        src as (select fs.device_id, ${sourceOf(sql)} source
                from fs join ev on ev.session_id = fs.session_id and ev.device_id = fs.device_id group by fs.device_id)
        select u.device_id, u.first_day::text first_day, u.activated, u.last_day > u.first_day returned, u.shared, src.source,
          (select r.sharer from recruits r where r.recruit = u.device_id) invited_by
        from u join src using (device_id)
        where u.device_id in (select sharer from made union select opener from opens)`,
    sql`select device_id::text id from analytics_owner_devices where app = ${app}`,
  ]);
  const owners = new Set(ownerRows.map((r) => r.id as string));

  const short = (id: string) => id.slice(0, 8);
  const people = new Map(nodeRows.map((r) => [r.device_id as string, r]));
  const invitedBy = (id: string): string | null => (people.get(id)?.invited_by as string | null) ?? null;
  const generation = (id: string): number => {
    let [n, at] = [0, invitedBy(id)];
    // Capped, in case device clocks ever make a loop of who came first
    while (at && n < 50) [n, at] = [n + 1, invitedBy(at)];
    return n;
  };
  const recruitsOf = new Map<string, string[]>();
  for (const [id, r] of people) if (r.invited_by) recruitsOf.set(r.invited_by, [...(recruitsOf.get(r.invited_by) ?? []), id]);
  const descendants = (id: string, seen = new Set<string>()): number => {
    for (const child of recruitsOf.get(id) ?? []) {
      if (seen.has(child) || seen.size > 5000) continue;
      seen.add(child);
      descendants(child, seen);
    }
    return seen.size;
  };

  const sharers = new Map<string, { kind: string; links: number; opened: number; recruits: number }[]>();
  for (const r of bySharer) sharers.set(r.sharer, [...(sharers.get(r.sharer) ?? []), { kind: r.kind, links: num(r.links), opened: num(r.opened), recruits: num(r.recruits) }]);
  const openersOf = new Map<string, Set<string>>();
  for (const e of edgeRows) openersOf.set(e.sharer, (openersOf.get(e.sharer) ?? new Set()).add(e.opener));
  const total = (rows: { links: number; opened: number; recruits: number }[], k: "links" | "opened" | "recruits") => rows.reduce((n, r) => n + r[k], 0);

  const ambassadors = [...sharers].map(([id, kinds]) => {
    const mine = (recruitsOf.get(id) ?? []).map((r) => people.get(r)!);
    const byKind = [...kinds].sort((p, q) => q.links - p.links || p.kind.localeCompare(q.kind));
    const best = [...kinds]
      .filter((k) => k.opened)
      .sort((p, q) => q.recruits / q.links - p.recruits / p.links || q.opened / q.links - p.opened / p.links || p.kind.localeCompare(q.kind))[0];
    const [links, opened] = [total(kinds, "links"), total(kinds, "opened")];
    return {
      user: short(id),
      me: owners.has(id),
      source: (people.get(id)?.source as string) ?? "direct",
      firstSeen: (people.get(id)?.first_day as string) ?? "",
      generation: generation(id),
      invitedBy: invitedBy(id) ? short(invitedBy(id)!) : null,
      links,
      opened,
      openRate: ratio(opened, links),
      openers: openersOf.get(id)?.size ?? 0,
      recruits: mine.length,
      activated: mine.filter((r) => r.activated).length,
      returned: mine.filter((r) => r.returned).length,
      descendants: descendants(id),
      byKind,
      bestKind: best?.kind ?? null,
    };
  });
  ambassadors.sort((p, q) => q.recruits - p.recruits || q.openers - p.openers || q.links - p.links || p.user.localeCompare(q.user));

  const byGeneration = new Map<number, postgres.Row[]>();
  for (const [id, r] of people) byGeneration.set(generation(id), [...(byGeneration.get(generation(id)) ?? []), { ...r, id }]);

  // Groups: users joined by any share, whichever way it went
  const root = new Map<string, string>([...people.keys()].map((id) => [id, id]));
  const find = (id: string): string => {
    let at = id;
    while (root.get(at) !== at) at = root.get(at)!;
    root.set(id, at);
    return at;
  };
  for (const e of edgeRows) if (root.has(e.sharer) && root.has(e.opener)) root.set(find(e.sharer), find(e.opener));
  const members = new Map<string, string[]>();
  for (const id of people.keys()) members.set(find(id), [...(members.get(find(id)) ?? []), id]);
  const pairs = new Set(edgeRows.map((e) => `${e.sharer}>${e.opener}`));
  const groups = [...members.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({
      members: ids.length,
      users: ids.map(short).sort().slice(0, 20),
      links: ids.reduce((n, id) => n + total(sharers.get(id) ?? [], "links"), 0),
      recruits: ids.filter((id) => invitedBy(id)).length,
      reciprocalPairs: edgeRows.filter((e) => ids.includes(e.sharer) && e.sharer < e.opener && pairs.has(`${e.opener}>${e.sharer}`)).length,
    }))
    .sort((p, q) => q.members - p.members || q.links - p.links || p.users[0].localeCompare(q.users[0]))
    .slice(0, 20);

  const link = (r: postgres.Row) => ({
    kind: num(r.total) ? "all" : (r.kind as string),
    method: num(r.total) ? "all" : (r.method as string),
    links: num(r.links),
    opened: num(r.opened),
    openRate: ratio(num(r.opened), num(r.links)),
    openers: num(r.openers),
    recruits: num(r.recruits),
    recruitsPerLink: ratio(num(r.recruits), num(r.links)),
    medianSecondsToOpen: r.median_secs == null ? null : Math.round(Number(r.median_secs)),
  });
  const kinds = byLink.filter((r) => !num(r.total)).map(link);
  kinds.sort((p, q) => q.opened - p.opened || q.links - p.links || p.kind.localeCompare(q.kind) || p.method.localeCompare(q.method));

  return {
    links: [...kinds, ...byLink.filter((r) => num(r.total)).map(link)],
    ambassadors: ambassadors.slice(0, 25),
    generations: [...byGeneration]
      .sort(([p], [q]) => p - q)
      .map(([g, rows]) => ({
        generation: g,
        users: rows.length,
        sharers: rows.filter((r) => sharers.has(r.id)).length,
        activated: a ? ratio(rows.filter((r) => r.activated).length, rows.length) : null,
      })),
    groups,
    edges: edgeRows.slice(0, 1000).map((e) => {
      const to = people.get(e.opener);
      return {
        from: short(e.sharer),
        to: short(e.opener),
        kind: e.kind,
        method: e.method,
        firstOpenedAt: new Date(e.first_at).toISOString(),
        opens: num(e.opens),
        recruited: e.recruited === true,
        toActivated: to?.activated === true,
        toReturned: to?.returned === true,
        toShared: to?.shared === true,
      };
    }),
    nodes: [...people]
      .map(([id, r]) => ({
        user: short(id),
        source: r.source as string,
        firstSeen: r.first_day as string,
        generation: generation(id),
        invitedBy: invitedBy(id) ? short(invitedBy(id)!) : null,
        activated: r.activated === true,
        links: total(sharers.get(id) ?? [], "links"),
        recruits: recruitsOf.get(id)?.length ?? 0,
      }))
      .sort((p, q) => q.recruits - p.recruits || q.links - p.links || p.user.localeCompare(q.user))
      .slice(0, 1000),
  };
}
