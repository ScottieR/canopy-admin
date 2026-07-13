-- Anonymized cross-user usage telemetry.
-- See spec-global-usage-telemetry.md for the full design.
--
-- This is also created automatically at server startup (see the
-- "CREATE TABLE IF NOT EXISTS" block in server.js, next to `pgPool`) so a
-- fresh DATABASE_URL bootstraps itself on first boot. This file exists as
-- the readable source of truth / for running by hand against a specific
-- environment.
--
-- Columns intentionally excluded, by design: no agent id, no agent name, no
-- user id, no email, no IP address, no message content. anon_id is a random
-- UUID generated once per Canopy install (canopy/src/store/worldStore.ts,
-- telemetryAnonId) and is never derived from anything identifying.

CREATE TABLE IF NOT EXISTS usage_events (
  id            BIGSERIAL PRIMARY KEY,
  anon_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,       -- e.g. 'usage_report', 'activation_a0_deployed', 'onboarding_step_reached_agent_name', 'companion_paired'
  provider      TEXT,                -- 'google' | 'openai' | 'anthropic' | 'xai' | 'other'
  model_version TEXT,                -- e.g. 'anthropic/claude-sonnet-4-6'
  persona_role  TEXT,                -- normalized suggested-persona key, or 'custom'
  tokens_in     BIGINT NOT NULL DEFAULT 0,
  tokens_out    BIGINT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC NOT NULL DEFAULT 0,
  properties    JSONB,               -- small, non-identifying event metadata (step number/name, companion profileType/experience/deviceName, etc)
  event_ts      TIMESTAMPTZ NOT NULL,       -- client-reported event time
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()  -- server receipt time
);

-- Idempotent for tables created before `properties` existed.
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS properties JSONB;

CREATE INDEX IF NOT EXISTS usage_events_event_ts_idx ON usage_events (event_ts);
CREATE INDEX IF NOT EXISTS usage_events_provider_idx ON usage_events (provider);
CREATE INDEX IF NOT EXISTS usage_events_persona_role_idx ON usage_events (persona_role);
CREATE INDEX IF NOT EXISTS usage_events_event_type_idx ON usage_events (event_type);
CREATE INDEX IF NOT EXISTS usage_events_anon_id_idx ON usage_events (anon_id);

-- Funnel/activation events (A0-A3 + step-level), fired fire-once per install
-- by canopy/src/store/worldStore.ts's fireActivationEvent():
--   activation_a0_deployed            — agent successfully deployed
--   activation_a1_first_reply         — first agent reply seen
--   activation_a2_first_deliverable   — starter-task reply seen (the "aha" moment)
--   activation_a3_first_forum         — first forum space created
--   onboarding_step_reached_<name>    — each wizard step reached (properties: {step, step_name})
-- companion_paired (non-deduped, via reportTelemetryEvent) fires per mobile/iPad pairing.

-- Retention: keep forever, by decision (see spec-global-usage-telemetry.md).
-- No scheduled deletion job, no partition-drop cleanup — rows are never
-- automatically removed. Revisit if table size/cost ever becomes a problem.
