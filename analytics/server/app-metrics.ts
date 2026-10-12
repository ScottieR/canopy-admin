// app-analytics kit v8: this file is this app's own. Its result is `appMetrics` in /api/stats.
import { num, ratio, type MetricsContext } from "./metrics";

/**
 * What only Canopy measures, beyond the standard stats: which personas people deploy, which
 * integrations they connect, how forums go, and how the first reply comes about. Windows are the
 * last 30 days.
 *
 * The first-agent funnel, each feature's adoption and use, and activation are declared in
 * analytics/flows.ts and reported under `flows`; what the server spends on model APIs is under `ai`.
 * Neither is recomputed here.
 */
export async function appMetrics({ sql, scope }: MetricsContext): Promise<Record<string, unknown>> {
  const recent = sql`${scope} and ts > now() - interval '30 days'`;

  const [[agents], roles, connections, [forums], [replies]] = await Promise.all([
    sql`select count(*) created, count(distinct device_id) users,
          count(*) filter (where props->>'imported' = 'true') imported
        from analytics_events where ${recent} and name = 'agent_created'`,

    sql`select coalesce(props->>'role', 'unknown') role, count(*) agents, count(distinct device_id) users
        from analytics_events where ${recent} and name = 'agent_created' group by 1 order by 2 desc, 1`,

    sql`select coalesce(props->>'type', 'unknown') type, count(*) connections, count(distinct device_id) users
        from analytics_events where ${recent} and name = 'connection_added' group by 1 order by 2 desc, 1`,

    sql`select count(*) filter (where name = 'forum_created') created,
          count(*) filter (where name = 'forum_completed') completed,
          count(distinct device_id) filter (where name = 'forum_created') users,
          avg((props->>'agents')::numeric) filter (where name = 'forum_created' and props->>'agents' ~ '^\\d+$') agents_per_forum
        from analytics_events where ${recent} and name in ('forum_created', 'forum_completed')`,

    sql`select count(*) total, count(distinct device_id) users,
          count(*) filter (where props->>'starter' = 'true') from_starter_task
        from analytics_events where ${recent} and name = 'reply_received'`,
  ]);

  return {
    agents: {
      created30d: num(agents.created),
      imported30d: num(agents.imported),
      // Per user who created one
      perCreator30d: ratio(num(agents.created), num(agents.users)),
      byRole30d: roles.map((r) => ({ role: r.role, agents: num(r.agents), users: num(r.users) })),
    },
    connections: {
      byType30d: connections.map((r) => ({ type: r.type, connections: num(r.connections), users: num(r.users) })),
    },
    forums: {
      created30d: num(forums.created),
      // Runs that finished with a deliverable; a follow-up run finishes the same forum again
      completedRuns30d: num(forums.completed),
      completedPerCreated30d: ratio(num(forums.completed), num(forums.created)),
      perCreator30d: ratio(num(forums.created), num(forums.users)),
      agentsPerForum30d: forums.agents_per_forum == null ? null : Math.round(Number(forums.agents_per_forum) * 10) / 10,
    },
    replies: {
      total30d: num(replies.total),
      perUser30d: ratio(num(replies.total), num(replies.users)),
      // The share that answered the onboarding starter task, as against a message the person wrote
      fromStarterTask30d: ratio(num(replies.from_starter_task), num(replies.total)),
    },
  };
}
