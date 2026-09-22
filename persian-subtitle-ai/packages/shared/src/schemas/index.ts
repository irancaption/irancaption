import { z } from "zod";

export const createUploadSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.literal("video/mp4"),
  fileSize: z.number().int().positive().max(100 * 1024 * 1024),
});

export const createJobSchema = z.object({
  videoId: z.string().min(1).max(128),
  idempotencyKey: z.string().trim().min(16).max(200),
});
