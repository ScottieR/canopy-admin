// app-analytics kit v8: shared by every app. Change it through the app-analytics skill, not by hand.
import postgres from "postgres";

/**
 * One Postgres database can hold every app's events (the `app` column tells
 * them apart), so scottieryan.com's apps can share a single free Neon or
 * Supabase database. Use the pooled connection string as DATABASE_URL.
 *
 * Without DATABASE_URL, events are dropped and /api/stats answers 503, so the
 * app runs the same with analytics switched off.
 */

let sql: postgres.Sql | null = null;
let ready: Promise<void> | null = null;

export function db(): postgres.Sql | null {
  const url = process.env.ANALYTICS_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return null;
  // prepare: false works through transaction-mode poolers (Neon, Supabase)
  sql ??= postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
  return sql;
}

/** The environment events are filed under, so previews and local dev never mix into production numbers. */
export const ANALYTICS_ENV = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";

/**
 * Which rows a report reads. With `withoutMe`, the owner's own devices (marked
 * with ?track=me, see client.ts) are left out, so the numbers show everyone
 * else. Their events are still recorded: the full report includes them.
 */
export function statsScope(sql: postgres.Sql, app: string, env: string, withoutMe = false) {
  return withoutMe
    ? sql`app = ${app} and env = ${env} and (device_id is null or device_id not in (select device_id from analytics_owner_devices where app = ${app}))`
    : sql`app = ${app} and env = ${env}`;
}

/** Creates the table on first use; safe to run on every cold start. */
export function ensureSchema(sql: postgres.Sql): Promise<void> {
  ready ??= sql
    .unsafe(SCHEMA)
    .then(() => {})
    .catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}

export const SCHEMA = `
create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  app         text        not null,
  env         text        not null,
  ts          timestamptz not null,
  received_at timestamptz not null default now(),
  device_id   uuid        not null,
  session_id  uuid        not null,
  name        text        not null,
  path        text        not null,
  props       jsonb       not null default '{}',
  mode        text        not null,
  standalone  boolean     not null default false,
  referrer    text,
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  country     text,
  device_type text,
  browser     text,
  os          text
);
create index if not exists analytics_events_app_ts on analytics_events (app, env, ts);
create index if not exists analytics_events_device on analytics_events (app, env, device_id, ts);
create index if not exists analytics_events_session on analytics_events (app, env, session_id);

-- Added in kit v3. The table is shared, so an app on an older kit may have created it without these.
-- Checked first, so the usual cold start takes no lock on the table.
do $$ begin
  if (select count(*) from information_schema.columns
      where table_schema = current_schema() and table_name = 'analytics_events' and column_name in ('browser', 'os')) < 2 then
    alter table analytics_events add column if not exists browser text, add column if not exists os text;
  end if;
end $$;

-- What the app spends on model APIs: one row per call, written by server/ai-usage.ts.
-- "route" holds the feature the call was for (the column's name from before this was part of the kit).
create table if not exists ai_usage (
  id                    bigint generated always as identity primary key,
  app                   text          not null,
  env                   text          not null,
  ts                    timestamptz   not null default now(),
  route                 text          not null,
  model                 text          not null,
  fallback              boolean       not null default false,
  input_tokens          integer       not null,
  output_tokens         integer       not null,
  cache_read_tokens     integer       not null,
  cache_write_tokens    integer       not null,
  cost_usd              numeric(12,6) not null,
  outcome               text          not null,
  device_id             uuid,
  provider              text          not null default 'anthropic',
  estimated             boolean       not null default false,
  cache_write_1h_tokens integer       not null default 0
);
create index if not exists ai_usage_app_ts on ai_usage (app, env, ts);
do $$ begin
  if (select count(*) from information_schema.columns
      where table_schema = current_schema() and table_name = 'ai_usage' and column_name in ('provider', 'estimated', 'cache_write_1h_tokens')) < 3 then
    alter table ai_usage
      add column if not exists provider text not null default 'anthropic',
      add column if not exists estimated boolean not null default false,
      add column if not exists cache_write_1h_tokens integer not null default 0;
  end if;
end $$;

-- Added in kit v7: the owner's own devices (?track=me), still tracked, left out of "without me" reports
create table if not exists analytics_owner_devices (
  app        text        not null,
  device_id  uuid        not null,
  marked_at  timestamptz not null default now(),
  primary key (app, device_id)
);

-- One row per spend alert sent, so each level of each month goes out once
create table if not exists ai_spend_alerts (
  app     text          not null,
  env     text          not null,
  period  text          not null,
  level   integer       not null,
  usd     numeric(12,2) not null,
  sent_at timestamptz   not null default now(),
  primary key (app, env, period, level)
);
`;
