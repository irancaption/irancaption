export type SubtitleCue = {
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
};

export type SubtitleDocument = {
  language: string;
  cues: SubtitleCue[];
};

export class SubtitleValidationError extends Error {
  public readonly code = "INVALID_SUBTITLE_CUE";
  constructor(message: string) { super(message); this.name = "SubtitleValidationError"; }
}

export function validateSubtitleCue(cue: SubtitleCue): SubtitleCue {
  if (!Number.isInteger(cue.sequence) || cue.sequence < 1) throw new SubtitleValidationError("Subtitle sequence must be a positive integer.");
  if (!Number.isInteger(cue.startMs) || cue.startMs < 0) throw new SubtitleValidationError("Subtitle start timestamp must be a non-negative integer.");
  if (!Number.isInteger(cue.endMs) || cue.endMs <= cue.startMs) throw new SubtitleValidationError("Subtitle end timestamp must be greater than start timestamp.");
  if (typeof cue.text !== "string" || cue.text.trim().length === 0) throw new SubtitleValidationError("Subtitle cue text must be a non-empty string.");
  if (cue.speaker !== undefined && cue.speaker.trim().length === 0) throw new SubtitleValidationError("Subtitle speaker must be non-empty when provided.");
  return { ...cue, text: cue.text.trim(), speaker: cue.speaker?.trim() };
}

export function validateSubtitleDocument(document: SubtitleDocument): SubtitleDocument {
  if (typeof document.language !== "string" || document.language.trim().length === 0) throw new SubtitleValidationError("Subtitle language must be a non-empty string.");
  const cues = document.cues.map(validateSubtitleCue);
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].sequence <= cues[index - 1].sequence) throw new SubtitleValidationError("Subtitle cue sequences must be strictly increasing.");
    if (cues[index].startMs < cues[index - 1].startMs) throw new SubtitleValidationError("Subtitle cue timestamps must be ordered.");
  }
  return { language: document.language.trim(), cues };
}

export { formatSrt } from "./formatter/srt/index.js";
export { formatVtt } from "./formatter/vtt/index.js";
export { normalizePersianText } from "./processing/persian.js";
export { buildSubtitleCues } from "./processing/segment.js";
