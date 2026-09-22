import { describe, expect, it } from "vitest";
import { validateUploadInput } from "../apps/worker/src/validation/upload.js";

describe("upload validation", () => {
  it("accepts a valid MP4", () => expect(() => validateUploadInput("video.mp4", "video/mp4", 1024)).not.toThrow());
  it("rejects non-MP4", () => expect(() => validateUploadInput("video.mov", "video/quicktime", 1024)).toThrow());
  it("rejects files above 100 MB", () => expect(() => validateUploadInput("video.mp4", "video/mp4", 100 * 1024 * 1024 + 1)).toThrow());
});
