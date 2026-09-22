export async function userExists(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1").bind(userId).first<{ id: string }>();
  return row !== null;
}

export async function videoForUser(db: D1Database, videoId: string, userId: string) {
  return db.prepare("SELECT id, user_id, title, original_filename, mime_type, file_size, duration_ms, storage_key, language, status, created_at, updated_at, completed_at FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(videoId, userId).first();
}
