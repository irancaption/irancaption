CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  aaguid TEXT,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user_id ON passkey_credentials(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  challenge_hash TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON webauthn_challenges(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  video_id TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  upload_type TEXT NOT NULL CHECK (upload_type IN ('single_put', 'multipart')),
  r2_upload_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'uploading', 'completed', 'aborted', 'expired', 'failed')),
  total_bytes INTEGER NOT NULL,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  part_size INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  aborted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);

CREATE TABLE IF NOT EXISTS transcription_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  provider_job_id TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  idempotency_key TEXT NOT NULL UNIQUE,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_id ON transcription_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_video_id ON transcription_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON transcription_jobs(status);

CREATE TABLE IF NOT EXISTS transcription_segments (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  speaker TEXT,
  original_text TEXT NOT NULL,
  translated_text TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES transcription_jobs(id) ON DELETE CASCADE,
  UNIQUE(job_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_transcription_segments_job_id ON transcription_segments(job_id);

CREATE TABLE IF NOT EXISTS subtitles (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  language TEXT NOT NULL,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subtitles_user_id ON subtitles(user_id);
CREATE INDEX IF NOT EXISTS idx_subtitles_video_id ON subtitles(video_id);

CREATE TABLE IF NOT EXISTS subtitle_versions (
  id TEXT PRIMARY KEY NOT NULL,
  subtitle_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'user', 'import')),
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (subtitle_id) REFERENCES subtitles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(subtitle_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_subtitle_versions_subtitle_id ON subtitle_versions(subtitle_id);

CREATE TABLE IF NOT EXISTS subtitle_cues (
  id TEXT PRIMARY KEY NOT NULL,
  version_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  speaker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (version_id) REFERENCES subtitle_versions(id) ON DELETE CASCADE,
  UNIQUE(version_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_subtitle_cues_version_id ON subtitle_cues(version_id);

CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0,
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  processed_seconds INTEGER NOT NULL DEFAULT 0,
  ai_neurons INTEGER NOT NULL DEFAULT 0,
  job_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage(user_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
