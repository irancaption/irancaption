import { describe, expect, it } from "vitest";
import { formatSrt, formatVtt } from "@irancaption/subtitle-core";

describe("subtitle formatters", () => {
  const document = { language: "fa", cues: [{ sequence: 1, startMs: 0, endMs: 1500, text: "سلام دنیا" }] };
  it("formats SRT", () => expect(formatSrt(document)).toContain("00:00:00,000 --> 00:00:01,500"));
  it("formats VTT", () => expect(formatVtt(document)).toContain("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500"));
});
