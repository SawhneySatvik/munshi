import type { z } from "zod";

export const ROLES = ["router", "reason", "vision", "segment", "voice", "narrate", "speak"] as const;
export type Role = (typeof ROLES)[number];

export const PROVIDER_IDS = ["meta", "baseten", "nebius", "gemini", "openrouter", "sarvam", "anthropic", "openai", "nvidia"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
  /** vision: a data: URL or https URL, sent as an image part on a user message */
  imageUrl?: string;
};

export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { callId: string; name: string; arguments: unknown };

export type Usage = { inputTokens: number; outputTokens: number };

/** A provider's token counts as usage, or null when it reported either one not at all: an unreported count is unknown,
 * never zero (a zero would price the call at nothing). */
export const usageOf = (input: unknown, output: unknown): Usage | null =>
  typeof input === "number" && typeof output === "number" ? { inputTokens: input, outputTokens: output } : null;
export type CallMeta = { provider: ProviderId; model: string; latencyMs: number };

export type GenerateRequest = {
  role: Role;
  messages: Message[];
  tools?: ToolSpec[];
  /** When set, output is strict JSON validated against this schema; the result is `json`. */
  schema?: { name: string; zod: z.ZodType };
  /** Aborts the call (and any retry backoff) when it fires: the run's time budget. Not part of a fixture's key. */
  signal?: AbortSignal;
};

export type GenerateResult = CallMeta & {
  /** With a chain only: the alias that answered, and every alias tried in order (the last answered). */
  alias?: string;
  tried?: string[];
  text: string;
  toolCalls: ToolCall[];
  json?: unknown;
  /** null: the provider reported no usage for the call */
  usage: Usage | null;
};

export type SegmentRequest = {
  /** a data: URL (base64 image) or https URL */
  imageUrl: string;
  /** one noun phrase OR boxes, never both */
  prompt: { phrase: string } | { boxes: { id: number; x1: number; y1: number; x2: number; y2: number }[]; width: number; height: number };
};

export type SegmentMatch = {
  id: number;
  box: { x1: number; y1: number; x2: number; y2: number };
  /** the raw `<|mask;...|>` token, undecoded */
  mask: string;
  /** the API returns no score; always null */
  score: number | null;
};

/**
 * No count field exists upstream: count = matches.length. `raw` is the response text as it arrived and `rawSha256` its
 * sha256 (hex, of its UTF-8 bytes), taken on arrival: a stored count is tied to them.
 */
export type SegmentResult = CallMeta & { matches: SegmentMatch[]; imageSize: { width: number; height: number } | null; raw: string; rawSha256: string };

export type TranscribeRequest = {
  /** mono 16-bit PCM WAV at 16 or 24 kHz */
  wav: Uint8Array;
  /** e.g. "Hindi" */
  language?: string;
};

export type TranscribeResult = CallMeta & { text: string; language: string | null };


/**
 * The speak role's languages (BCP-47): the agent's own contract, which a speak adapter must serve; any other is refused
 * before a call. Today's adapter (Sarvam's Bulbul) speaks exactly these.
 */
export const SPEAK_LANGUAGES = ["bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN"] as const;
export type SpeakLanguage = (typeof SPEAK_LANGUAGES)[number];

/** Text read aloud (role `speak`): text that already passed its checks, in one of the speak role's languages. */
export type SpeakRequest = {
  text: string;
  language: SpeakLanguage;
  speaker?: string;
};

/**
 * The clips joined; `mime` by their first bytes; `chars`, the characters voiced. `chars` is what a speak call is to be
 * counted by in the spend ledger (tokens_in for speak).
 */
export type SpeakResult = CallMeta & { audio: Uint8Array; mime: "audio/mpeg" | "audio/wav"; chars: number };

/**
 * A document's pages as the document model read them: each page's text blocks in reading order, each with its place on
 * the page (0–1000 grid, (0, 0) at the top-left), or null where the model gave none. `complete` is false when the
 * reader could not read every page.
 */
export type DocBlock = { text: string; box: [number, number, number, number] | null };
export type DocumentResult = CallMeta & { complete: boolean; pages: { page: number; blocks: DocBlock[] }[] };
