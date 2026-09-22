import { describe, expect, it } from "vitest";
import {
  SubtitleValidationError,
  validateSubtitleCue,
  validateSubtitleDocument
} from "@irancaption/subtitle-core";

describe("subtitle core", () => {
  it("accepts a valid cue", () => {
    const cue = validateSubtitleCue({
      sequence: 1,
      startMs: 0,
      endMs: 1500,
      text: "  سلام دنیا  "
    });

    expect(cue.text).toBe("سلام دنیا");
  });

  it("rejects a negative start timestamp", () => {
    expect(() =>
      validateSubtitleCue({
        sequence: 1,
        startMs: -1,
        endMs: 1500,
        text: "سلام"
      })
    ).toThrow(SubtitleValidationError);
  });

  it("rejects an end timestamp before or equal to start", () => {
    expect(() =>
      validateSubtitleCue({
        sequence: 1,
        startMs: 1500,
        endMs: 1500,
        text: "سلام"
      })
    ).toThrow(SubtitleValidationError);
  });

  it("rejects invalid sequence ordering", () => {
    expect(() =>
      validateSubtitleDocument({
        language: "fa",
        cues: [
          { sequence: 2, startMs: 0, endMs: 1000, text: "یک" },
          { sequence: 1, startMs: 1000, endMs: 2000, text: "دو" }
        ]
      })
    ).toThrow(SubtitleValidationError);
  });
});
