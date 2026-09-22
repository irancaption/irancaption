CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_user_period ON usage(user_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON transcription_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_uploads_user_created ON uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, revoked_at, expires_at);
