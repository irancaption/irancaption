import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../index.js";
import { requireSession, type AuthVariables } from "../auth/sessions/middleware.js";
import { enqueueJob } from "../queue/publish.js";
import { writeAudit } from "../audit/log.js";
import { HttpApiError, apiError } from "../errors/api.js";
import { reserveJobQuota, addJobUsage, removeJobUsage } from "../usage/quota.js";
const app = new Hono<{ Bindings: Bindings; Variables: AuthVariables & { requestId: string } }>();
app.use("/*", requireSession);
const schema = z.object({ videoId: z.string().uuid(), idempotencyKey: z.string().trim().min(16).max(200) });
app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = schema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HttpApiError(400, "INVALID_REQUEST", "Invalid job request.");
  const video = await c.env.DB.prepare("SELECT id, audio_storage_key FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'uploaded' LIMIT 1").bind(body.data.videoId, userId).first<{ id: string; audio_storage_key: string | null }>();
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
  const inserted = await c.env.DB.prepare("INSERT OR IGNORE INTO transcription_jobs (id, user_id, video_id, status, stage, attempt, progress, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, 'queued', 'validation', 0, 0, ?, ?, ?)").bind(jobId, userId, body.data.videoId, body.data.idempotencyKey, now, now).run();
  if (!inserted.meta.changes) {
    const raced = await c.env.DB.prepare("SELECT id, user_id, status, stage, progress FROM transcription_jobs WHERE idempotency_key = ? LIMIT 1").bind(body.data.idempotencyKey).first<{ id: string; user_id: string; status: string; stage: string; progress: number }>();
    if (!raced || raced.user_id !== userId) throw new HttpApiError(403, "FORBIDDEN", "This idempotency key is already in use.");
    return c.json({ job: { id: raced.id, status: raced.status, stage: raced.stage, progress: raced.progress } });
  }
  let usageReserved = false;
  try {
    await addJobUsage(c.env.DB, userId);
    usageReserved = true;
    await enqueueJob(c.env.TRANSCRIPTION_QUEUE, { jobId, userId, videoId: body.data.videoId, stage: "validation", status: "queued", attempt: 0, requestId: c.get("requestId") });
  } catch {
    if (usageReserved) await removeJobUsage(c.env.DB, userId);
    await c.env.DB.prepare("UPDATE transcription_jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_message = 'Queue publish failed.', updated_at = ? WHERE id = ? AND user_id = ?").bind(new Date().toISOString(), jobId, userId).run();
    throw new HttpApiError(503, "INTERNAL_ERROR", "Job queue is temporarily unavailable.", true);
  }
  await writeAudit(c.env.DB, { userId, action: "JOB_CREATE", resourceType: "job", resourceId: jobId, metadata: { videoId: body.data.videoId } });
  return c.json({ job: { id: jobId, status: "queued", stage: "validation", progress: 0 } }, 202);
});
app.get("/:id", async (c) => {
  const job = await c.env.DB.prepare("SELECT id, video_id, status, stage, attempt, progress, provider, error_code, error_message, created_at, started_at, updated_at, completed_at, cancelled_at FROM transcription_jobs WHERE id = ? AND user_id = ? LIMIT 1").bind(c.req.param("id"), c.get("userId")).first();
  if (!job) throw new HttpApiError(404, "JOB_NOT_FOUND", "Job was not found.");
  return c.json({ job });
});
app.post("/:id/cancel", async (c) => {
  const userId = c.get("userId");
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare("UPDATE transcription_jobs SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status IN ('queued','validating','preparing','transcribing','translating','generating_subtitle')").bind(now, now, c.req.param("id"), userId).run();
  if (!result.meta.changes) throw new HttpApiError(404, "JOB_NOT_FOUND", "Job was not found or is no longer cancellable.");
  await writeAudit(c.env.DB, { userId, action: "JOB_CANCEL", resourceType: "job", resourceId: c.req.param("id") });
  return c.json({ ok: true });
});
app.onError((error, c) => error instanceof HttpApiError ? apiError(c, error) : apiError(c, new HttpApiError(500, "INTERNAL_ERROR", "Job request failed.", true)));
export default app;
