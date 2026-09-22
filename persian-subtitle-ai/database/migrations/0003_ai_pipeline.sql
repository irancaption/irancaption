ALTER TABLE videos ADD COLUMN audio_storage_key TEXT;
ALTER TABLE videos ADD COLUMN audio_mime_type TEXT;
ALTER TABLE videos ADD COLUMN audio_size INTEGER;
CREATE INDEX IF NOT EXISTS idx_videos_audio_storage_key ON videos(audio_storage_key);
