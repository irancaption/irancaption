import { MAX_VIDEO_BYTES } from "@irancaption/shared";
import { HttpApiError } from "../errors/api.js";

const SAFE_FILENAME = /^[^\\/:*?"<>|\u0000-\u001F]+$/u;

export function validateUploadInput(filename: string, mimeType: string, fileSize: number): void {
  if (!filename || filename.length > 255 || !SAFE_FILENAME.test(filename)) throw new HttpApiError(400, "INVALID_FILE", "Invalid video filename.");
  if (mimeType !== "video/mp4" || !filename.toLowerCase().endsWith(".mp4")) throw new HttpApiError(415, "UNSUPPORTED_FORMAT", "Only MP4 video files are supported.");
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) throw new HttpApiError(400, "INVALID_FILE", "Invalid video file size.");
  if (fileSize > MAX_VIDEO_BYTES) throw new HttpApiError(413, "FILE_TOO_LARGE", "Video size must not exceed 100 MB.");
}

export function createStorageKey(userId: string, videoId: string): string {
  return `users/${encodeURIComponent(userId)}/videos/${encodeURIComponent(videoId)}/source.mp4`;
}
