import { Hono } from "hono";
import type { Bindings } from "../index.js";
import { requireSession, type AuthVariables } from "../auth/sessions/middleware.js";
import { HttpApiError, apiError } from "../errors/api.js";
import { writeAudit } from "../audit/log.js";
import { enqueueJob } from "../queue/publish.js";
import { z } from "zod";
import { createPresignedPutUrl } from "../r2/presign.js";
import { reserveJobQuota, removeJobUsage } from "../usage/quota.js";

const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg"]);
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;
const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables & { requestId: string } }>();
app.use("/*", requireSession);
app.post("/:id/audio-upload", async (c) => {
  const userId = c.get("userId");
  const videoId = c.req.param("id");
  const body = z.object({ mimeType: z.string().min(1).max(100), fileSize: z.number().int().positive().max(MAX_AUDIO_BYTES) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success || !AUDIO_MIME_TYPES.has(body.data.mimeType)) throw new HttpApiError(400, "INVALID_FILE", "Unsupported prepared-audio format.");
  const video = await c.env.DB.prepare("SELECT id, status, deleted_at FROM videos WHERE id = ? AND user_id = ? LIMIT 1").bind(videoId, userId).first<{ id: string; status: string; deleted_at: string | null }>();
  if (!video || video.deleted_at || !["uploaded", "processing", "failed"].includes(video.status)) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Video was not found or is not ready for audio preparation.");
  if (!c.env.R2_ACCOUNT_ID || !c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_BUCKET_NAME) throw new HttpApiError(500, "R2_ERROR", "R2 upload service is not configured.", true);
  const audioKey = `users/${encodeURIComponent(userId)}/videos/${encodeURIComponent(videoId)}/audio/source`;
  const uploadUrl = await createPresignedPutUrl({ R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME: c.env.R2_BUCKET_NAME }, audioKey, body.data.mimeType);
  await c.env.DB.prepare("UPDATE videos SET audio_storage_key = ?, audio_mime_type = ?, audio_size = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(audioKey, body.data.mimeType, body.data.fileSize, new Date().toISOString(), videoId, userId).run();
  return c.json({ videoId, method: "PUT", uploadUrl, headers: { "Content-Type": body.data.mimeType } }, 201);
});

app.post("/:id/audio-upload/complete", async (c) => {
  const userId = c.get("userId");
  const videoId = c.req.param("id");
  const video = await c.env.DB.prepare("SELECT id, audio_storage_key, audio_mime_type, audio_size FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(videoId, userId).first<{ id: string; audio_storage_key: string | null; audio_mime_type: string | null; audio_size: number | null }>();
  if (!video?.audio_storage_key || !video.audio_mime_type || video.audio_size === null) throw new HttpApiError(404, "UPLOAD_FAILED", "Audio upload session was not found.");
  const object = await c.env.VIDEO_BUCKET.head(video.audio_storage_key);
  if (!object) throw new HttpApiError(400, "UPLOAD_FAILED", "Prepared audio was not found in storage.");
  if (object.size !== video.audio_size || object.httpMetadata?.contentType !== video.audio_mime_type) throw new HttpApiError(400, "UPLOAD_FAILED", "Prepared audio metadata does not match the authorized upload.");
  await c.env.DB.prepare("UPDATE videos SET status = 'uploaded', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(new Date().toISOString(), videoId, userId).run();
  return c.json({ ok: true, videoId });
});

app.get("/", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, title, original_filename, mime_type, file_size, duration_ms, language, status, created_at, updated_at, completed_at FROM videos WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100").bind(c.get("userId")).all();
  return c.json({ videos: rows.results });
});
app.post("/:id/process", async (c) => {
  const userId = c.get("userId");
  const body = z.object({ idempotencyKey: z.string().trim().min(16).max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HttpApiError(400, "INVALID_REQUEST", "Invalid processing request.");
  const videoId = c.req.param("id");
  const video = await c.env.DB.prepare("SELECT id, audio_storage_key FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'uploaded' LIMIT 1").bind(videoId, userId).first<{ id: string; audio_storage_key: string | null }>();
  if (!video) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Video was not found or is not ready for processing.");
  if (!video.audio_storage_key) throw new HttpApiError(409, "AUDIO_SOURCE_REQUIRED", "Prepared audio must be uploaded before processing can start.");
  const existing = await c.env.DB.prepare("SELECT id, user_id, status, stage, progress FROM transcription_jobs WHERE idempotency_key = ? LIMIT 1").bind(body.data.idempotencyKey).first<{ id: string; user_id: string; status: string; stage: string; progress: number }>();
  if (existing) {
    if (existing.user_id !== userId) throw new HttpApiError(403, "FORBIDDEN", "This idempotency key is already in use.");
    return c.json({ job: { id: existing.id, status: existing.status, stage: existing.stage, progress: existing.progress } });
  }
  await reserveJobQuota(c.env, userId);
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const inserted = await c.env.DB.prepare("INSERT OR IGNORE INTO transcription_jobs (id, user_id, video_id, status, stage, attempt, progress, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'validation', 0, 0, ?, ?, ?)").bind(jobId, userId, videoId, body.data.idempotencyKey, now, now).run();
  if (!inserted.meta.changes) return c.json({ job: await c.env.DB.prepare("SELECT id, status, stage, progress FROM transcription_jobs WHERE idempotency_key = ? AND user_id = ? LIMIT 1").bind(body.data.idempotencyKey, userId).first() });
  try {
    await enqueueJob(c.env.TRANSCRIPTION_QUEUE, { jobId, userId, videoId, stage: "validation", status: "queued", attempt: 0, requestId: c.get("requestId") });
  } catch {
    await removeJobUsage(c.env.DB, userId);
    await c.env.DB.prepare("UPDATE transcription_jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_message = 'Queue publish failed.', updated_at = ? WHERE id = ? AND user_id = ?").bind(new Date().toISOString(), jobId, userId).run();
    throw new HttpApiError(503, "INTERNAL_ERROR", "Job queue is temporarily unavailable.", true);
  }
  await writeAudit(c.env.DB, { userId, action: "JOB_CREATE", resourceType: "job", resourceId: jobId, metadata: { videoId } });
  return c.json({ job: { id: jobId, status: "queued", stage: "validation", progress: 0 } }, 202);
});

app.get("/:id/subtitles", async (c) => {
  const userId = c.get("userId");
  const videoId = c.req.param("id");
  const video = await c.env.DB.prepare("SELECT id FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(videoId, userId).first<{ id: string }>();
  if (!video) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Video was not found.");
  const rows = await c.env.DB.prepare("SELECT id, language, current_version_id, created_at, updated_at FROM subtitles WHERE video_id = ? AND user_id = ? ORDER BY updated_at DESC").bind(videoId, userId).all();
  return c.json({ subtitles: rows.results });
});

app.get("/:id", async (c) => {
  const video = await c.env.DB.prepare("SELECT id, title, original_filename, mime_type, file_size, duration_ms, language, status, created_at, updated_at, completed_at FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(c.req.param("id"), c.get("userId")).first();
  if (!video) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Video was not found.");
  return c.json({ video });
});
app.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const video = await c.env.DB.prepare("SELECT id, storage_key FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(c.req.param("id"), userId).first<{ id: string; storage_key: string }>();
  if (!video) throw new HttpApiError(404, "VIDEO_NOT_FOUND", "Video was not found.");
  await c.env.VIDEO_BUCKET.delete(video.storage_key);
  const audio = await c.env.DB.prepare("SELECT audio_storage_key FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(video.id, userId).first<{ audio_storage_key: string | null }>();
  if (audio?.audio_storage_key) await c.env.VIDEO_BUCKET.delete(audio.audio_storage_key);
  const now = new Date().toISOString();
  await c.env.DB.prepare("UPDATE videos SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, now, video.id, userId).run();
  await writeAudit(c.env.DB, { userId, action: "VIDEO_DELETE", resourceType: "video", resourceId: video.id });
  return c.body(null, 204);
});
app.onError((error, c) => error instanceof HttpApiError ? apiError(c, error) : apiError(c, new HttpApiError(500, "INTERNAL_ERROR", "Video request failed.", true)));
export default app;
