import type { SpeechToTextProvider, SpeechToTextRequest, SpeechToTextResponse, TranslationProvider, TranslationRequest, TranslationResponse } from "../index.js";

type WorkersAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type WhisperSegment = { start?: number; end?: number; text?: string; avg_logprob?: number };
type WhisperResult = { language?: string; text?: string; segments?: WhisperSegment[] };

type TranslationResult = { translated_text?: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export class WorkersAiSpeechToTextProvider implements SpeechToTextProvider {
  readonly name = "cloudflare-workers-ai-whisper-large-v3-turbo";
  constructor(private readonly ai: WorkersAiBinding) {}

  async transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResponse> {
    const audio = toBase64(new Uint8Array(request.audio));
    const result = await this.ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio,
      task: "transcribe",
      ...(request.languageHint ? { language: request.languageHint } : {}),
      vad_filter: true,
      condition_on_previous_text: true,
    }) as WhisperResult;

    const segments = (result.segments ?? []).filter((segment) =>
      typeof segment.start === "number" && typeof segment.end === "number" &&
      segment.end > segment.start && typeof segment.text === "string" && segment.text.trim().length > 0
    ).map((segment) => ({
      startMs: Math.max(0, Math.round((segment.start as number) * 1000)),
      endMs: Math.max(1, Math.round((segment.end as number) * 1000)),
      text: (segment.text as string).trim(),
      confidence: typeof segment.avg_logprob === "number" ? Math.max(0, Math.min(1, Math.exp(segment.avg_logprob))) : undefined,
    }));

    return { language: result.language?.trim().toLowerCase() || "unknown", segments };
  }
}

export class WorkersAiTranslationProvider implements TranslationProvider {
  readonly name = "cloudflare-workers-ai-m2m100-1.2b";
  constructor(private readonly ai: WorkersAiBinding) {}

  async translate(request: TranslationRequest): Promise<TranslationResponse> {
    const result = await this.ai.run("@cf/meta/m2m100-1.2b", {
      text: request.text,
      source_lang: request.sourceLanguage,
      target_lang: request.targetLanguage,
    }) as TranslationResult;
    if (typeof result.translated_text !== "string" || result.translated_text.trim().length === 0) {
      throw new Error("Workers AI translation returned no translated text.");
    }
    return { text: result.translated_text.trim() };
  }
}
