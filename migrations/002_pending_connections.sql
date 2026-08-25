-- Web-hosted connection token capture (Slack -> /connect/:token -> Canopy vault).
-- See WEB_CONNECTIONS.md (canopy repo) for the full protocol this table backs.
--
-- This is also created automatically at server startup (see the
-- "CREATE TABLE IF NOT EXISTS" block in server.js, next to `pgPool`) so a
-- fresh DATABASE_URL bootstraps itself on first boot. This file exists as
-- the readable source of truth / for running by hand against a specific
-- environment. Same pattern as 001_usage_events.sql.
--
-- Postgres (not per-instance local files, unlike share-routes.js's sharesDir)
-- because a single capture round-trips through at least three requests — the
-- desktop's register POST, the browser's complete POST, and the desktop's poll
-- GET — that can each land on a different Cloud Run instance. Only a shared
-- store makes that correct.
--
-- `ciphertext`/`nonce`/`ephemeral_public_key` are opaque to canopy-admin: the
-- plaintext key is encrypted client-side (in the user's browser) to the
-- requesting Canopy install's X25519 public key before it's ever sent here, and
-- only that install holds the matching private key. This table is never able
-- to reveal a plaintext credential even if it leaked in full.
CREATE TABLE IF NOT EXISTS pending_connections (
  token                 TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL,
  provider_name         TEXT NOT NULL,
  secret_name           TEXT NOT NULL,
  token_url             TEXT,
  instructions          TEXT,
  placeholder           TEXT NOT NULL,
  public_key            TEXT NOT NULL,               -- base64, this Canopy install's X25519 public key
  status                TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'completed'
  ciphertext            TEXT,                          -- set on completion
  nonce                 TEXT,                          -- set on completion
  ephemeral_public_key  TEXT,                          -- set on completion
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  completed_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pending_connections_agent_status_idx ON pending_connections (agent_id, status);
CREATE INDEX IF NOT EXISTS pending_connections_expires_idx ON pending_connections (expires_at);

-- Retention: rows are deleted, not archived. Completed rows are deleted the
-- moment the owning Canopy install's poll picks them up (GET /api/connections/pending
-- is destructive by design — see connections-routes.js). Pending rows that
-- never complete are swept once past expires_at. Nothing here is meant to
-- outlive the ~15 minute capture window by more than a few seconds.
