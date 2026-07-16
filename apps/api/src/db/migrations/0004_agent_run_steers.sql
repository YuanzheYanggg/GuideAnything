CREATE TABLE agent_run_steers (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  client_steer_id TEXT NOT NULL CHECK (length(client_steer_id) > 0),
  plan_version INTEGER NOT NULL CHECK (plan_version > 1),
  instruction TEXT NOT NULL CHECK (length(instruction) > 0 AND length(instruction) <= 20000),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, client_steer_id),
  UNIQUE (run_id, plan_version)
) STRICT;

CREATE INDEX agent_run_steers_run_idx
  ON agent_run_steers(run_id, plan_version DESC);
