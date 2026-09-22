export type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
};

export type SpeechToTextRequest = {
  audio: ArrayBuffer;
  languageHint?: string;
};

export type SpeechToTextResponse = {
  language: string;
  segments: TranscriptSegment[];
};

export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResponse>;
}

export type TranslationRequest = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
};

export type TranslationResponse = {
  text: string;
};

export interface TranslationProvider {
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

export { WorkersAiSpeechToTextProvider, WorkersAiTranslationProvider } from "./providers/workers-ai.js";
