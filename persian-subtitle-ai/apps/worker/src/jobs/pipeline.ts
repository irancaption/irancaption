import { WorkersAiSpeechToTextProvider, WorkersAiTranslationProvider } from "@irancaption/ai-core";
import { buildSubtitleCues, validateSubtitleDocument } from "@irancaption/subtitle-core";
import type { Bindings } from "../index.js";
import { updateJobState } from "./state.js";
import { addProcessedSeconds, maxProcessedSeconds, PipelineQuotaError } from "../usage/quota.js";

export class PipelineError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) { super(message); }
}

type JobRow = { id: string; user_id: string; video_id: string; attempt: number; status: string; usage_recorded_at?: string | null };
type VideoRow = { id: string; audio_storage_key: string | null; audio_mime_type: string | null; audio_size: number | null; language: string | null };

function sourceLanguageForTranslation(language: string): string {
  const normalized = language.toLowerCase().trim();
  if (normalized === "fa" || normalized === "fas" || normalized === "per") return "fa";
  return normalized.split("-")[0] || "en";
}

async function persistSegments(db: D1Database, jobId: string, segments: Array<{ startMs: number; endMs: number; text: string; confidence?: number }>): Promise<void> {
  await db.prepare("DELETE FROM transcription_segments WHERE job_id = ?").bind(jobId).run();
  const now = new Date().toISOString();
  const statements = segments.map((segment, index) => db.prepare(
    "INSERT INTO transcription_segments (id, job_id, sequence, start_ms, end_ms, original_text, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), jobId, index + 1, segment.startMs, segment.endMs, segment.text, segment.confidence ?? null, now, now));
  for (let start = 0; start < statements.length; start += 50) await db.batch(statements.slice(start, start + 50));
}

async function translateSegments(db: D1Database, ai: WorkersAiTranslationProvider, jobId: string, language: string, segments: Array<{ id: string; original_text: string }>): Promise<void> {
  if (sourceLanguageForTranslation(language) === "fa") {
    for (const segment of segments) await db.prepare("UPDATE transcription_segments SET translated_text = ?, updated_at = ? WHERE id = ? AND job_id = ?").bind(segment.original_text, new Date().toISOString(), segment.id, jobId).run();
    return;
  }
  for (const segment of segments) {
    const result = await ai.translate({ text: segment.original_text, sourceLanguage: sourceLanguageForTranslation(language), targetLanguage: "fa" });
    await db.prepare("UPDATE transcription_segments SET translated_text = ?, updated_at = ? WHERE id = ? AND job_id = ?").bind(result.text, new Date().toISOString(), segment.id, jobId).run();
  }
}

async function createSubtitle(db: D1Database, userId: string, videoId: string, jobId: string, language: string): Promise<void> {
  const segments = await db.prepare("SELECT id, start_ms, end_ms, original_text, translated_text FROM transcription_segments WHERE job_id = ? ORDER BY sequence ASC").bind(jobId).all<{ id: string; start_ms: number; end_ms: number; original_text: string; translated_text: string | null }>();
  const cues = buildSubtitleCues(segments.results.map((segment) => ({ startMs: segment.start_ms, endMs: segment.end_ms, text: segment.translated_text || segment.original_text })));
  const document = validateSubtitleDocument({ language: "fa", cues });
  if (document.cues.length === 0) throw new PipelineError("SUBTITLE_GENERATION_FAILED", "No subtitle cues were generated from the transcript.", false);

  const now = new Date().toISOString();
  const subtitle = await db.prepare("SELECT id FROM subtitles WHERE video_id = ? AND user_id = ? AND language = 'fa' LIMIT 1").bind(videoId, userId).first<{ id: string }>();
  const subtitleId = subtitle?.id ?? crypto.randomUUID();
  if (!subtitle) await db.prepare("INSERT INTO subtitles (id, user_id, video_id, language, created_at, updated_at) VALUES (?, ?, ?, 'fa', ?, ?)").bind(subtitleId, userId, videoId, now, now).run();
  const latest = await db.prepare("SELECT COALESCE(MAX(version_number), 0) AS version_number FROM subtitle_versions WHERE subtitle_id = ?").bind(subtitleId).first<{ version_number: number }>();
  const versionId = crypto.randomUUID();
  const versionNumber = (latest?.version_number ?? 0) + 1;
  await db.prepare("INSERT INTO subtitle_versions (id, subtitle_id, version_number, source, created_by, created_at) VALUES (?, ?, ?, 'ai', ?, ?)").bind(versionId, subtitleId, versionNumber, userId, now).run();
  const statements = document.cues.map((cue) => db.prepare("INSERT INTO subtitle_cues (id, version_id, sequence, start_ms, end_ms, text, speaker, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), versionId, cue.sequence, cue.startMs, cue.endMs, cue.text, cue.speaker ?? null, now, now));
  for (let start = 0; start < statements.length; start += 50) await db.batch(statements.slice(start, start + 50));
  await db.prepare("UPDATE subtitles SET current_version_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(versionId, now, subtitleId, userId).run();
}

export async function processJob(env: Bindings, job: JobRow, requestId: string): Promise<void> {
  const video = await env.DB.prepare("SELECT id, audio_storage_key, audio_mime_type, audio_size, language FROM videos WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1").bind(job.video_id, job.user_id).first<VideoRow>();
  if (!video) throw new PipelineError("VIDEO_NOT_FOUND", "The source video no longer exists.", false);
  if (!video.audio_storage_key) throw new PipelineError("AUDIO_SOURCE_REQUIRED", "An extracted audio source is required before transcription can start.", false);
  const object = await env.VIDEO_BUCKET.get(video.audio_storage_key);
  if (!object) throw new PipelineError("UPLOAD_FAILED", "The prepared audio source is missing from storage.", false);
  if (video.audio_size !== null && object.size !== video.audio_size) throw new PipelineError("UPLOAD_FAILED", "The prepared audio source size does not match its database record.", false);
  if (!env.AI) throw new PipelineError("AI_PROVIDER_ERROR", "Workers AI binding is not configured.", false);

  await env.DB.prepare("UPDATE transcription_jobs SET provider = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind("cloudflare-workers-ai", new Date().toISOString(), job.id, job.user_id).run();
  await updateJobState(env.DB, job.id, { status: "transcribing", stage: "transcription", attempt: job.attempt + 1, progress: 20 });
  const existingSegments = await env.DB.prepare("SELECT id, start_ms, end_ms, original_text, translated_text FROM transcription_segments WHERE job_id = ? ORDER BY sequence ASC").bind(job.id).all<{ id: string; start_ms: number; end_ms: number; original_text: string; translated_text: string | null }>();
  let detectedLanguage = video.language ?? "en";
  if (existingSegments.results.length === 0) {
    const audio = await object.arrayBuffer();
    const stt = new WorkersAiSpeechToTextProvider(env.AI);
    let transcription;
    try { transcription = await stt.transcribe({ audio, languageHint: video.language ?? undefined }); }
    catch (error) { throw new PipelineError("AI_PROVIDER_ERROR", error instanceof Error ? error.message : "Speech-to-text failed.", true); }
    if (transcription.segments.length === 0) throw new PipelineError("AI_PROVIDER_ERROR", "Speech-to-text returned no timestamped segments.", false);
    const durationMs = Math.max(...transcription.segments.map(segment => segment.endMs));
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 30 * 60 * 1000) throw new PipelineError("VIDEO_TOO_LONG", "The detected audio duration exceeds the 30 minute limit.", false);
    try { await addProcessedSeconds(env.DB, job.user_id, Math.ceil(durationMs / 1000), maxProcessedSeconds(env)); }
    catch (error) { if (error instanceof PipelineQuotaError) throw new PipelineError(error.code, error.message, false); throw error; }
    await env.DB.prepare("UPDATE transcription_jobs SET usage_recorded_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND usage_recorded_at IS NULL").bind(new Date().toISOString(), new Date().toISOString(), job.id, job.user_id).run();
    await persistSegments(env.DB, job.id, transcription.segments);
    detectedLanguage = transcription.language;
    await env.DB.prepare("UPDATE videos SET language = ?, duration_ms = ?, status = 'processing', updated_at = ? WHERE id = ? AND user_id = ?").bind(transcription.language, durationMs, new Date().toISOString(), video.id, job.user_id).run();
  } else {
    const durationMs = Math.max(...existingSegments.results.map(segment => segment.end_ms));
    if (durationMs > 30 * 60 * 1000) throw new PipelineError("VIDEO_TOO_LONG", "The detected audio duration exceeds the 30 minute limit.", false);
    if (!job.usage_recorded_at) {
      try { await addProcessedSeconds(env.DB, job.user_id, Math.ceil(durationMs / 1000), maxProcessedSeconds(env)); }
      catch (error) { if (error instanceof PipelineQuotaError) throw new PipelineError(error.code, error.message, false); throw error; }
      await env.DB.prepare("UPDATE transcription_jobs SET usage_recorded_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND usage_recorded_at IS NULL").bind(new Date().toISOString(), new Date().toISOString(), job.id, job.user_id).run()
    }
  }

  await updateJobState(env.DB, job.id, { status: "translating", stage: "translation", progress: 55 });
  const rows = await env.DB.prepare("SELECT id, original_text, translated_text FROM transcription_segments WHERE job_id = ? ORDER BY sequence ASC").bind(job.id).all<{ id: string; original_text: string; translated_text: string | null }>();
  const translator = new WorkersAiTranslationProvider(env.AI);
  const pending = rows.results.filter(row => !row.translated_text);
  if (pending.length) {
    try { await translateSegments(env.DB, translator, job.id, detectedLanguage, pending); }
    catch (error) { throw new PipelineError("TRANSLATION_FAILED", error instanceof Error ? error.message : "Translation failed.", true); }
  }

  await updateJobState(env.DB, job.id, { status: "generating_subtitle", stage: "subtitle_generation", progress: 85 });
  await createSubtitle(env.DB, job.user_id, video.id, job.id, detectedLanguage);
  await env.DB.prepare("UPDATE videos SET status = 'completed', updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ?").bind(new Date().toISOString(), new Date().toISOString(), video.id, job.user_id).run();
  await updateJobState(env.DB, job.id, { status: "completed", stage: "subtitle_generation", progress: 100 });
  void requestId;
}
