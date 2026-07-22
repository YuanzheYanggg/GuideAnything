CREATE TABLE workspace_flow_regression_cases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  source_reference_id TEXT NOT NULL UNIQUE REFERENCES answer_citations(reference_id) ON DELETE RESTRICT,
  resource_node_id TEXT NOT NULL CHECK (length(resource_node_id) BETWEEN 1 AND 200),
  annotation_id TEXT NOT NULL CHECK (length(annotation_id) BETWEEN 1 AND 200),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 20000),
  expected_agent_status TEXT NOT NULL CHECK (expected_agent_status IN ('SUPPORTED', 'PARTIAL')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'NEEDS_REVIEW', 'ARCHIVED')),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_verified_snapshot_id TEXT REFERENCES flow_knowledge_snapshots(id) ON DELETE SET NULL,
  last_retrieval_verification TEXT CHECK (last_retrieval_verification IN ('PASS', 'FAIL', 'NEEDS_REVIEW')),
  last_agent_verification TEXT CHECK (last_agent_verification IN ('PASS', 'FAIL', 'NEEDS_REVIEW'))
) STRICT;

CREATE INDEX workspace_flow_regression_cases_guide_status_idx
  ON workspace_flow_regression_cases(guide_id, status, updated_at DESC);

CREATE TRIGGER workspace_flow_regression_cases_target_immutable
BEFORE UPDATE OF workspace_id, guide_id, source_reference_id, resource_node_id, annotation_id,
  question, expected_agent_status, created_by, created_at
ON workspace_flow_regression_cases
BEGIN
  SELECT RAISE(ABORT, 'workspace flow regression target is immutable');
END;

CREATE TABLE workspace_flow_regression_runs (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  case_id TEXT NOT NULL REFERENCES workspace_flow_regression_cases(id) ON DELETE RESTRICT,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX workspace_flow_regression_runs_case_idx
  ON workspace_flow_regression_runs(case_id, created_at DESC);

CREATE TABLE flow_annotation_health_issues (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES flow_knowledge_snapshots(id) ON DELETE CASCADE,
  guide_id TEXT NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  resource_node_id TEXT NOT NULL CHECK (length(resource_node_id) BETWEEN 1 AND 200),
  annotation_id TEXT NOT NULL CHECK (length(annotation_id) BETWEEN 1 AND 200),
  code TEXT NOT NULL CHECK (code IN (
    'ANNOTATION_LEAF_MISSING',
    'ANNOTATION_TARGET_MISMATCH',
    'ANNOTATION_NOT_RANKED',
    'ANNOTATION_CONTEXT_MISSING',
    'ANNOTATION_REFERENCE_INVALID'
  )),
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id, resource_node_id, annotation_id, code)
) STRICT;

CREATE INDEX flow_annotation_health_issues_guide_snapshot_idx
  ON flow_annotation_health_issues(guide_id, snapshot_id, created_at DESC);

CREATE TRIGGER flow_annotation_health_issues_immutable
BEFORE UPDATE ON flow_annotation_health_issues
BEGIN
  SELECT RAISE(ABORT, 'flow annotation health issue is immutable');
END;

CREATE TABLE agent_retrieval_diagnostics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  guide_id TEXT REFERENCES guides(id) ON DELETE SET NULL,
  target_resource_node_id TEXT CHECK (target_resource_node_id IS NULL OR length(target_resource_node_id) BETWEEN 1 AND 200),
  target_annotation_id TEXT CHECK (target_annotation_id IS NULL OR length(target_annotation_id) BETWEEN 1 AND 200),
  query_fingerprint TEXT NOT NULL CHECK (length(query_fingerprint) = 64 AND query_fingerprint NOT GLOB '*[^a-f0-9]*'),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'NO_TARGET_LEAF',
    'TARGET_NOT_RANKED',
    'CONTEXT_NOT_CLOSED',
    'BUDGET_EXHAUSTED',
    'REFERENCE_NOT_RESOLVABLE',
    'MODEL_STATUS_MISMATCH',
    'TARGET_REMOVED'
  )),
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json) AND json_type(candidates_json) = 'array'),
  closure_json TEXT NOT NULL CHECK (json_valid(closure_json) AND json_type(closure_json) = 'array'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX agent_retrieval_diagnostics_expires_idx
  ON agent_retrieval_diagnostics(expires_at);

CREATE TRIGGER agent_retrieval_diagnostics_immutable
BEFORE UPDATE ON agent_retrieval_diagnostics
BEGIN
  SELECT RAISE(ABORT, 'agent retrieval diagnostic is immutable');
END;
