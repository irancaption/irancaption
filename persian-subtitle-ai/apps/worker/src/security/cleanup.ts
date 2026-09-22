import type { Bindings } from "../index.js";
import { releaseUploadQuota } from "../usage/quota.js";

/**
 * Removes expired WebAuthn challenges/sessions and releases abandoned upload
 * reservations. Storage objects are deleted before their database rows are
 * marked expired so abandoned R2 objects do not accumulate indefinitely.
 */
export async function cleanupExpiredResources(env: Bindings): Promise<void> {
  const now = new Date().toISOString();

  await env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)")
    .bind(now, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).run();

  await env.DB.prepare("DELETE FROM sessions WHERE (expires_at <= ? OR revoked_at <= ?) AND created_at <= ?")
    .bind(now, now, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).run();

  const expired = await env.DB.prepare(
    "SELECT id, user_id, video_id, storage_key, total_bytes, quota_period_start, quota_period_end FROM uploads WHERE status IN ('created','uploading') AND expires_at <= ? LIMIT 100",
  ).bind(now).all<{ id: string; user_id: string; video_id: string | null; storage_key: string; total_bytes: number; quota_period_start: string | null; quota_period_end: string | null }>();

  for (const upload of expired.results) {
    await env.VIDEO_BUCKET.delete(upload.storage_key);
    await env.DB.batch([
      env.DB.prepare("UPDATE uploads SET status='expired', aborted_at=? WHERE id=? AND status IN ('created','uploading')").bind(now, upload.id),
      env.DB.prepare("UPDATE videos SET status='failed', updated_at=?, deleted_at=? WHERE id=? AND user_id=? AND status='uploading' AND deleted_at IS NULL")
        .bind(now, now, upload.video_id, upload.user_id),
    ]);
    await releaseUploadQuota(env.DB, upload.user_id, upload.total_bytes, upload.quota_period_start && upload.quota_period_end ? { start: upload.quota_period_start, end: upload.quota_period_end } : undefined);
  }
}
