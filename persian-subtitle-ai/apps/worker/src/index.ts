import { Hono } from "hono";
import type { ErrorCode } from "@irancaption/shared";
import { SERVICE_NAME } from "@irancaption/shared";
import { apiError, HttpApiError } from "./errors/api.js";
import { logger } from "./logging/logger.js";
import { securityHeaders } from "./security/headers.js";
import { corsHeaders, originGuard } from "./security/origin.js";
import { createMemoryRateLimitStore, rateLimit } from "./security/rate-limit.js";
import { sanitizeRequestId } from "./security/request-id.js";
import { updateJobState } from "./jobs/state.js";
import type { TranscriptionQueueMessage } from "./queue/publish.js";
import passkeyRoutes from "./auth/passkey/routes.js";
import uploadRoutes from "./routes/uploads.js";
import videoRoutes from "./routes/videos.js";
import jobRoutes from "./routes/jobs.js";
import { processJob, PipelineError } from "./jobs/pipeline.js";
import subtitleRoutes from "./routes/subtitles.js";
import usageRoutes from "./routes/usage.js";
import { cleanupExpiredResources } from "./security/cleanup.js";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  VIDEO_BUCKET: R2Bucket;
  TRANSCRIPTION_QUEUE: Queue;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  ALLOWED_ORIGINS?: string;
  MAX_UPLOAD_BYTES_PER_PERIOD?: string;
  MAX_VIDEO_COUNT_PER_PERIOD?: string;
  MAX_JOB_COUNT_PER_PERIOD?: string;
  MAX_PROCESSED_SECONDS_PER_PERIOD?: string;
  WEBAUTHN_RP_NAME?: string;
  WEBAUTHN_RP_ID?: string;
  WEBAUTHN_ORIGIN?: string;
  SESSION_TTL_SECONDS?: string;
  ENVIRONMENT?: string;
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
};

type Variables = { requestId: string };
type WorkerEnv = { Bindings: Bindings; Variables: Variables };

const app = new Hono<WorkerEnv>();
const rateStore = createMemoryRateLimitStore();

function safeRequestId(value: string | undefined): string {
  return sanitizeRequestId(value) ?? crypto.randomUUID();
}

app.use("*", securityHeaders);
app.use("*", async (c, next) => {
  await next();
  if (c.env.ENVIRONMENT === "production") c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});
app.use("/api/*", async (c, next) => {
  const requestId = safeRequestId(c.req.header("X-Request-Id")?.trim());
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  const started = Date.now();
  try {
    await next();
  } finally {
    c.header("Cache-Control", "no-store");
    logger.info("request", { requestId, route: c.req.path, method: c.req.method, status: c.res.status, durationMs: Date.now() - started });
  }
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  for (const [key, value] of Object.entries(corsHeaders(origin, c.env.ALLOWED_ORIGINS, new URL(c.req.url).origin))) c.header(key, value);
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  await originGuard(c, next);
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS" && c.req.header("Cookie") && !origin) {
    throw new HttpApiError(403, "ORIGIN_REJECTED", "A valid request origin is required for this session request.");
  }
});

app.onError((error, c) => {
  if (error instanceof HttpApiError) return apiError(c, error);
  const requestId = c.get("requestId") as string;
  logger.error("unhandled_error", { requestId, route: c.req.path, method: c.req.method });
  return c.json({ error: { code: "INTERNAL_ERROR" as ErrorCode, message: "An internal error occurred.", retryable: false, requestId } }, 500);
});

app.get("/api/v1/health", (c) => c.json({ ok: true, service: SERVICE_NAME }));

app.use("/api/v1/auth/*", rateLimit(rateStore, 20, 60));
app.use("/api/v1/uploads", rateLimit(rateStore, 30, 60));
app.use("/api/v1/uploads/*", rateLimit(rateStore, 30, 60));
app.use("/api/v1/videos", rateLimit(rateStore, 60, 60));
app.use("/api/v1/videos/*", rateLimit(rateStore, 60, 60));
app.use("/api/v1/jobs", rateLimit(rateStore, 60, 60));
app.use("/api/v1/jobs/*", rateLimit(rateStore, 60, 60));

app.route("/api/v1/auth/passkey", passkeyRoutes);
app.route("/api/v1/auth", passkeyRoutes);
app.route("/api/v1/uploads", uploadRoutes);
app.route("/api/v1/videos", videoRoutes);
app.route("/api/v1/jobs", jobRoutes);
app.route("/api/v1/subtitles", subtitleRoutes);
app.route("/api/v1/usage", usageRoutes);

app.all("/api/*", (c) => apiError(c, new HttpApiError(404, "INVALID_REQUEST", "The requested API endpoint does not exist.")));

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Bindings): Promise<void> {
    await cleanupExpiredResources(env);
  },
  async queue(batch: MessageBatch<TranscriptionQueueMessage>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
      const payload = message.body;
      const job = await env.DB.prepare("SELECT id, user_id, video_id, status, attempt, usage_recorded_at FROM transcription_jobs WHERE id = ? AND user_id = ? AND video_id = ? LIMIT 1")
        .bind(payload.jobId, payload.userId, payload.videoId).first<{ id: string; user_id: string; video_id: string; status: string; attempt: number; usage_recorded_at: string | null }>();
      if (!job || job.status === "cancelled" || job.status === "completed") {
        message.ack();
        continue;
      }
      try {
        await processJob(env, job, payload.requestId);
        message.ack();
      } catch (error) {
        if (error instanceof PipelineError) {
          await updateJobState(env.DB, job.id, { status: "failed", stage: payload.stage, progress: 0, errorCode: error.code as ErrorCode, errorMessage: error.message });
          if (error.retryable) {
            message.retry({ delaySeconds: Math.min(300, 15 * Math.max(1, job.attempt + 1)) });
          } else {
            await env.DB.prepare("UPDATE videos SET status = 'failed', updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL").bind(new Date().toISOString(), job.video_id, job.user_id).run();
            message.ack();
          }
          continue;
        }
        logger.error("job_processing_failed", { requestId: payload.requestId, jobId: payload.jobId, videoId: payload.videoId, userId: payload.userId, stage: payload.stage, attempt: job.attempt });
        message.retry({ delaySeconds: Math.min(300, 15 * Math.max(1, job.attempt + 1)) });
      }
    }
  }
};
