import type { JobStage, JobStatus } from "@irancaption/shared";

export async function updateJobState(db: D1Database, jobId: string, state: { status: JobStatus; stage: JobStage; attempt?: number; progress?: number; errorCode?: string | null; errorMessage?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`UPDATE transcription_jobs SET status = ?, stage = ?, attempt = COALESCE(?, attempt), progress = COALESCE(?, progress), error_code = ?, error_message = ?, updated_at = ?, started_at = CASE WHEN ? IN ('validating','preparing','transcribing','translating','generating_subtitle') AND started_at IS NULL THEN ? ELSE started_at END, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END, cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END WHERE id = ?`)
    .bind(state.status, state.stage, state.attempt ?? null, state.progress ?? null, state.errorCode ?? null, state.errorMessage ?? null, now, state.status, now, state.status, now, state.status, now, jobId).run();
}
