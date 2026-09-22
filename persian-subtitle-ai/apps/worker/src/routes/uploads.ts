import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../index.js";
import { requireSession, type AuthVariables } from "../auth/sessions/middleware.js";
import { validateUploadInput, createStorageKey } from "../validation/upload.js";
import { createPresignedPutUrl } from "../r2/presign.js";
import { HttpApiError, apiError } from "../errors/api.js";
import { writeAudit } from "../audit/log.js";
import { reserveUploadQuota, releaseUploadQuota } from "../usage/quota.js";
const createSchema = z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.literal("video/mp4"), fileSize: z.number().int().positive() });
const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables & { requestId: string } }>();
app.use("/*", requireSession);
app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HttpApiError(400, "INVALID_REQUEST", "Invalid upload request.");
  validateUploadInput(body.data.filename, body.data.mimeType, body.data.fileSize);
  await reserveUploadQuota(c.env, userId, body.data.fileSize);
  if (!c.env.R2_ACCOUNT_ID || !c.env.R2_ACCESS_KEY_ID || !c.env.R2_SECRET_ACCESS_KEY || !c.env.R2_BUCKET_NAME) throw new HttpApiError(500, "R2_ERROR", "R2 upload service is not configured.", true);
  const videoId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const storageKey = createStorageKey(userId, videoId);
  const now = new Date();
  const quotaPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const quotaPeriodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const title = body.data.filename.replace(/\.mp4$/iu, "");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO videos (id, user_id, title, original_filename, mime_type, file_size, duration_ms, storage_key, language, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'uploading', ?, ?)").bind(videoId, userId, title, body.data.filename, body.data.mimeType, body.data.fileSize, storageKey, now.toISOString(), now.toISOString()),
      c.env.DB.prepare("INSERT INTO uploads (id, user_id, video_id, storage_key, upload_type, status, total_bytes, quota_period_start, quota_period_end, expires_at, created_at) VALUES (?, ?, ?, ?, 'single_put', 'created', ?, ?, ?, ?, ?)").bind(uploadId, userId, videoId, storageKey, body.data.fileSize, quotaPeriodStart.toISOString(), quotaPeriodEnd.toISOString(), expiresAt.toISOString(), now.toISOString()),
    ]);
  } catch (error) {
    await releaseUploadQuota(c.env.DB, userId, body.data.fileSize, { start: quotaPeriodStart.toISOString(), end: quotaPeriodEnd.toISOString() });
    throw error;
  }
  try {
    const uploadUrl = await createPresignedPutUrl({ R2_ACCOUNT_ID: c.env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: c.env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: c.env.R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME: c.env.R2_BUCKET_NAME }, storageKey, body.data.mimeType);
    await writeAudit(c.env.DB, { userId, action: "VIDEO_UPLOAD", resourceType: "video", resourceId: videoId, metadata: { uploadId, fileSize: body.data.fileSize } });
    return c.json({ uploadId, videoId, method: "PUT", uploadUrl, expiresAt: expiresAt.toISOString(), headers: { "Content-Type": body.data.mimeType } }, 201);
  } catch {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM uploads WHERE id = ? AND user_id = ?").bind(uploadId, userId),
      c.env.DB.prepare("DELETE FROM videos WHERE id = ? AND user_id = ? AND status = 'uploading'").bind(videoId, userId),
    ]);
    throw new HttpApiError(503, "R2_ERROR", "Could not authorize the R2 upload.", true);
  }
});
app.post("/:id/complete", async (c) => {
  const userId = c.get("userId");
  const uploadId = c.req.param("id");
  const upload = await c.env.DB.prepare("SELECT id, video_id, storage_key, total_bytes, quota_period_start, quota_period_end, status, expires_at FROM uploads WHERE id = ? AND user_id = ? LIMIT 1").bind(uploadId, userId).first<{ id: string; video_id: string | null; storage_key: string; total_bytes: number; quota_period_start: string | null; quota_period_end: string | null; status: string; expires_at: string }>();
  if (!upload?.video_id) throw new HttpApiError(404, "UPLOAD_FAILED", "Upload session was not found.");
  if (upload.status === "completed") return c.json({ ok: true, uploadId, videoId: upload.video_id });
  if (Date.parse(upload.expires_at) <= Date.now()) throw new HttpApiError(410, "UPLOAD_EXPIRED", "Upload session has expired.");
  const object = await c.env.VIDEO_BUCKET.head(upload.storage_key);
  if (!object) throw new HttpApiError(400, "UPLOAD_FAILED", "The uploaded video was not found in storage.");
  if (object.size !== upload.total_bytes) throw new HttpApiError(400, "UPLOAD_FAILED", "Uploaded file size does not match the authorized size.");
  if (object.httpMetadata?.contentType !== "video/mp4") throw new HttpApiError(415, "UNSUPPORTED_FORMAT", "Uploaded object is not an MP4 video.");
  const now = new Date().toISOString();
  const updated = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE uploads SET status = 'completed', uploaded_bytes = total_bytes, completed_at = ? WHERE id = ? AND user_id = ? AND status IN ('created','uploading')").bind(now, uploadId, userId),
    c.env.DB.prepare("UPDATE videos SET status = 'uploaded', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(now, upload.video_id, userId),
  ]);
  return c.json({ ok: true, uploadId, videoId: upload.video_id });
});
app.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const uploadId = c.req.param("id");
  const upload = await c.env.DB.prepare("SELECT id, video_id, storage_key, total_bytes, quota_period_start, quota_period_end, status FROM uploads WHERE id = ? AND user_id = ? LIMIT 1").bind(uploadId, userId).first<{ id: string; video_id: string | null; storage_key: string; total_bytes: number; quota_period_start: string | null; quota_period_end: string | null; status: string }>();
  if (!upload) throw new HttpApiError(404, "UPLOAD_FAILED", "Upload session was not found.");
  if (upload.status !== "completed") {
    await c.env.VIDEO_BUCKET.delete(upload.storage_key);
    await releaseUploadQuota(c.env.DB, userId, upload.total_bytes, upload.quota_period_start && upload.quota_period_end ? { start: upload.quota_period_start, end: upload.quota_period_end } : undefined);
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE uploads SET status = 'aborted', aborted_at = ? WHERE id = ? AND user_id = ? AND status <> 'completed'").bind(now, uploadId, userId),
    c.env.DB.prepare("UPDATE videos SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = 'uploading'").bind(now, now, upload.video_id, userId),
  ]);
  return c.body(null, 204);
});
app.onError((error, c) => error instanceof HttpApiError ? apiError(c, error) : apiError(c, new HttpApiError(500, "INTERNAL_ERROR", "Upload request failed.", true)));
export default app;
