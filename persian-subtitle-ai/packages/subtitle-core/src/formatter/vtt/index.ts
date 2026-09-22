import type { SubtitleDocument, SubtitleCue } from "../../index.js";
import { validateSubtitleDocument } from "../../index.js";

function timestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = safe % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function formatVtt(document: SubtitleDocument): string {
  const normalized = validateSubtitleDocument(document);
  const cues = normalized.cues.map((cue: SubtitleCue, index) => {
    const speaker = cue.speaker ? `${cue.speaker}: ` : "";
    return `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${speaker}${cue.text}\n`;
  }).join("\n");
  return `WEBVTT\n\n${cues}`;
}
