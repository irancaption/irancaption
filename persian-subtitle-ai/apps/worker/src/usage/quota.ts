import { HttpApiError } from "../errors/api.js";
import type { Bindings } from "../index.js";

type UsageRow = { uploaded_bytes: number; video_count: number; job_count: number; processed_seconds: number };
const DEFAULT_UPLOAD_BYTES = 1024 * 1024 * 1024;
const DEFAULT_VIDEO_COUNT = 10;
const DEFAULT_JOB_COUNT = 20;
const DEFAULT_PROCESSED_SECONDS = 3600;

function integerEnv(value: string | undefined, fallback: number, minimum = 0): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function period(): { start: string; end: string } {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

export async function getUsage(db: D1Database, userId: string): Promise<UsageRow> {
  const p = period();
  const row = await db.prepare(
    "SELECT uploaded_bytes, video_count, job_count, processed_seconds FROM usage WHERE user_id = ? AND period_start = ? AND period_end = ? LIMIT 1",
  ).bind(userId, p.start, p.end).first<UsageRow>();
  return row ?? { uploaded_bytes: 0, video_count: 0, job_count: 0, processed_seconds: 0 };
}

/** Atomically reserves both upload bytes and one video slot. */
export async function reserveUploadQuota(env: Bindings, userId: string, bytes: number): Promise<void> {
  const p = period();
  const maxBytes = integerEnv(env.MAX_UPLOAD_BYTES_PER_PERIOD, DEFAULT_UPLOAD_BYTES);
  const maxVideos = integerEnv(env.MAX_VIDEO_COUNT_PER_PERIOD, DEFAULT_VIDEO_COUNT, 1);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO usage (id,user_id,period_start,period_end,uploaded_bytes,stored_bytes,video_count,processed_seconds,ai_neurons,job_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,period_start,period_end) DO UPDATE SET
       uploaded_bytes=usage.uploaded_bytes+excluded.uploaded_bytes,
       stored_bytes=usage.stored_bytes+excluded.stored_bytes,
       video_count=usage.video_count+1,
       updated_at=excluded.updated_at
     WHERE usage.uploaded_bytes + ? <= ? AND usage.video_count + 1 <= ?`,
  ).bind(
    crypto.randomUUID(), userId, p.start, p.end, bytes, bytes, 1, 0, 0, 0, now, now,
    bytes, maxBytes, maxVideos,
  ).run();
  if (!result.meta.changes) throw new HttpApiError(429, "QUOTA_EXCEEDED", "Monthly upload quota has been exceeded.");
}

/** Releases a previously reserved upload slot when an upload is aborted or expires. */
export async function releaseUploadQuota(db: D1Database, userId: string, bytes: number, periodOverride?: { start: string; end: string }): Promise<void> {
  const p = periodOverride ?? period();
  await db.prepare(
    `UPDATE usage SET
       uploaded_bytes=CASE WHEN uploaded_bytes>=? THEN uploaded_bytes-? ELSE 0 END,
       stored_bytes=CASE WHEN stored_bytes>=? THEN stored_bytes-? ELSE 0 END,
       video_count=CASE WHEN video_count>0 THEN video_count-1 ELSE 0 END,
       updated_at=?
     WHERE user_id=? AND period_start=? AND period_end=?`,
  ).bind(bytes, bytes, bytes, bytes, new Date().toISOString(), userId, p.start, p.end).run();
}

/** Atomically reserves one processing job slot. */
export async function reserveJobQuota(env: Bindings, userId: string): Promise<void> {
  const p = period();
  const maxJobs = integerEnv(env.MAX_JOB_COUNT_PER_PERIOD, DEFAULT_JOB_COUNT, 1);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO usage (id,user_id,period_start,period_end,uploaded_bytes,stored_bytes,video_count,processed_seconds,ai_neurons,job_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,period_start,period_end) DO UPDATE SET
       job_count=usage.job_count+1,
       updated_at=excluded.updated_at
     WHERE usage.job_count + 1 <= ?`,
  ).bind(crypto.randomUUID(), userId, p.start, p.end, 0, 0, 0, 0, 0, 1, now, now, maxJobs).run();
  if (!result.meta.changes) throw new HttpApiError(429, "QUOTA_EXCEEDED", "Monthly processing-job quota has been exceeded.");
}

export async function addProcessedSeconds(db: D1Database, userId: string, seconds: number, maxSeconds: number): Promise<void> {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new PipelineQuotaError("Invalid processed duration.");
  const p = period();
  const now = new Date().toISOString();
  const result = await db.prepare(
    `INSERT INTO usage (id,user_id,period_start,period_end,uploaded_bytes,stored_bytes,video_count,processed_seconds,ai_neurons,job_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id,period_start,period_end) DO UPDATE SET
       processed_seconds=usage.processed_seconds+excluded.processed_seconds,
       updated_at=excluded.updated_at
     WHERE usage.processed_seconds + ? <= ?`,
  ).bind(crypto.randomUUID(), userId, p.start, p.end, 0, 0, 0, seconds, 0, 0, now, now, seconds, maxSeconds).run();
  if (!result.meta.changes) throw new PipelineQuotaError("Monthly processed-duration quota has been exceeded.");
}

export class PipelineQuotaError extends Error {
  readonly code = "QUOTA_EXCEEDED";
  readonly retryable = false;
  constructor(message: string) { super(message); this.name = "PipelineQuotaError"; }
}

export function maxProcessedSeconds(env: Bindings): number {
  return integerEnv(env.MAX_PROCESSED_SECONDS_PER_PERIOD, DEFAULT_PROCESSED_SECONDS, 1);
}

export async function removeJobUsage(db: D1Database, userId: string): Promise<void> {
  const p = period();
  await db.prepare("UPDATE usage SET job_count=CASE WHEN job_count>0 THEN job_count-1 ELSE 0 END, updated_at=? WHERE user_id=? AND period_start=? AND period_end=?")
    .bind(new Date().toISOString(), userId, p.start, p.end).run();
}
