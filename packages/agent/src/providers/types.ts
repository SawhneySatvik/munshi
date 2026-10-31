import type { z } from "zod";

export const ROLES = ["router", "reason", "vision", "segment", "voice", "narrate"] as const;
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
  usage: Usage;
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
