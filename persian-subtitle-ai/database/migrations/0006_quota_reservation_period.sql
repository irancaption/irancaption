ALTER TABLE uploads ADD COLUMN quota_period_start TEXT;
ALTER TABLE uploads ADD COLUMN quota_period_end TEXT;
CREATE INDEX IF NOT EXISTS idx_uploads_quota_period ON uploads(user_id, quota_period_start, quota_period_end);
