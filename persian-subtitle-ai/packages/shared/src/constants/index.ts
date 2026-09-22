export const SERVICE_NAME = "persian-subtitle-ai" as const;
export const API_PREFIX = "/api/v1" as const;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_DURATION_MS = 30 * 60 * 1000;
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ALLOWED_VIDEO_MIME = "video/mp4" as const;
export const ALLOWED_VIDEO_EXTENSION = ".mp4" as const;

export const JOB_STATUSES = [
  "uploaded", "queued", "validating", "preparing", "transcribing",
  "translating", "generating_subtitle", "completed", "failed", "cancelled"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STAGES = [
  "validation", "media_preparation", "transcription", "translation", "subtitle_generation"
] as const;
export type JobStage = (typeof JOB_STAGES)[number];
