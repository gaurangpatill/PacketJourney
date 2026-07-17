PRAGMA foreign_keys = ON;

CREATE TABLE investigations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_investigation_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  requested_url TEXT NOT NULL,
  final_url TEXT,
  hostname TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  source_type TEXT NOT NULL CHECK (source_type IN ('live', 'recorded')),
  schema_version INTEGER NOT NULL,
  investigation_json TEXT NOT NULL,
  investigation_hash TEXT NOT NULL,
  high_findings INTEGER NOT NULL DEFAULT 0,
  medium_findings INTEGER NOT NULL DEFAULT 0,
  low_findings INTEGER NOT NULL DEFAULT 0,
  info_findings INTEGER NOT NULL DEFAULT 0,
  has_ai_diagnosis INTEGER NOT NULL DEFAULT 0 CHECK (has_ai_diagnosis IN (0, 1)),
  has_counterfactual INTEGER NOT NULL DEFAULT 0 CHECK (has_counterfactual IN (0, 1)),
  has_screenshot INTEGER NOT NULL DEFAULT 0 CHECK (has_screenshot IN (0, 1)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  saved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX idx_investigations_owner_updated
  ON investigations(owner_id, updated_at DESC, id DESC);
CREATE INDEX idx_investigations_owner_hostname_updated
  ON investigations(owner_id, hostname, updated_at DESC, id DESC);
CREATE INDEX idx_investigations_owner_hash
  ON investigations(owner_id, investigation_hash);

CREATE TABLE ai_diagnoses (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  expertise_mode TEXT NOT NULL CHECK (expertise_mode IN ('beginner', 'developer', 'network-engineer')),
  diagnosis_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE TABLE counterfactual_results (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL UNIQUE,
  source_investigation_hash TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  include_ai_diagnosis INTEGER NOT NULL CHECK (include_ai_diagnosis IN (0, 1)),
  include_counterfactual INTEGER NOT NULL CHECK (include_counterfactual IN (0, 1)),
  include_screenshot INTEGER NOT NULL CHECK (include_screenshot IN (0, 1)),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_accessed_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE INDEX idx_share_links_investigation_created
  ON share_links(investigation_id, created_at DESC, id DESC);
CREATE INDEX idx_share_links_token_active
  ON share_links(token_hash, revoked_at, expires_at);

CREATE TABLE investigation_artifacts (
  investigation_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  artifact_type TEXT NOT NULL CHECK (artifact_type = 'screenshot'),
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (investigation_id, artifact_id),
  FOREIGN KEY (investigation_id) REFERENCES investigations(id) ON DELETE CASCADE
);

CREATE INDEX idx_investigation_artifacts_expiry
  ON investigation_artifacts(expires_at, investigation_id);

CREATE TABLE artifact_cleanup_failures (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error_code TEXT NOT NULL
);
