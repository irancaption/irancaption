ALTER TABLE transcription_jobs ADD COLUMN usage_recorded_at TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_usage_recorded ON transcription_jobs(usage_recorded_at);
