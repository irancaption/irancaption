import { describe, expect, it } from "vitest";
import { buildSubtitleCues, normalizePersianText } from "@irancaption/subtitle-core";

describe("Persian subtitle processing", () => {
  it("normalizes Arabic letter variants and spacing", () => {
    expect(normalizePersianText("كِتاب  خوب ،است")).toBe("کتاب خوب، است");
  });

  it("splits long transcript segments while preserving time bounds", () => {
    const cues = buildSubtitleCues([{ startMs: 0, endMs: 10000, text: "این یک جمله بسیار طولانی برای آزمایش تقسیم‌بندی زیرنویس فارسی است که باید به چند بخش خوانا تقسیم شود." }]);
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBe(10000);
    for (const cue of cues) expect(cue.endMs).toBeGreaterThan(cue.startMs);
  });
});
