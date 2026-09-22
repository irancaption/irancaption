import type { SubtitleCue } from "../index.js";
import { normalizePersianText } from "./persian.js";

const MAX_CHARS = 48;

function splitWords(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

export function buildSubtitleCues(input: Array<{ startMs: number; endMs: number; text: string; speaker?: string }>): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const item of input) {
    const text = normalizePersianText(item.text);
    if (!text || item.endMs <= item.startMs) continue;
    const words = splitWords(text);
    if (text.length <= MAX_CHARS || words.length < 2) {
      cues.push({ sequence: cues.length + 1, startMs: item.startMs, endMs: item.endMs, text, speaker: item.speaker });
      continue;
    }
    const pieces: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > MAX_CHARS && current) {
        pieces.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) pieces.push(current);
    const duration = item.endMs - item.startMs;
    for (let index = 0; index < pieces.length; index += 1) {
      const start = item.startMs + Math.floor(duration * index / pieces.length);
      const end = index === pieces.length - 1 ? item.endMs : item.startMs + Math.floor(duration * (index + 1) / pieces.length);
      if (end > start) cues.push({ sequence: cues.length + 1, startMs: start, endMs: end, text: pieces[index], speaker: item.speaker });
    }
  }
  return cues;
}
