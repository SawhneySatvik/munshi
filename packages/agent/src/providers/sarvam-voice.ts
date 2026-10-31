// Sarvam's speech-to-text (Saaras), from its public docs (docs.sarvam.ai, REST API, read 31 Oct 2026): POST
// https://api.sarvam.ai/speech-to-text, multipart `file`, `model`, `mode` and an optional BCP-47 `language_code`, the key in
// the `api-subscription-key` header; the reply is { request_id, transcript, language_code }. Clips up to 30 seconds.
import { z } from "zod";
import { ROLE_TIMEOUT_MS, type RoleBinding } from "../config.ts";
import { apiKey, baseUrl, withRetry, type Deps } from "./client.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, sha256Hex, viaFixture } from "./fixtures.ts";
import { ModelError, redact } from "./redact.ts";
import type { TranscribeRequest, TranscribeResult } from "./types.ts";

type Raw = Pick<TranscribeResult, "provider" | "model" | "latencyMs" | "text" | "language">;
const RAW_SHAPE = z.object({ provider: z.string(), model: z.string(), latencyMs: z.number(), text: z.string(), language: z.string().nullable() }) as unknown as z.ZodType<Raw>;

// The app's language bias ("Hindi", "English") as Sarvam's code; anything else is left to its own detection.
const CODES: Record<string, string> = { Hindi: "hi-IN", English: "en-IN" };

export function sarvamForm(req: TranscribeRequest, model: string): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("mode", "transcribe");
  const code = req.language ? CODES[req.language] : undefined;
  if (code) form.append("language_code", code);
  form.append("file", new Blob([req.wav as BlobPart], { type: "audio/wav" }), "audio.wav");
  return form;
}

export async function sarvamTranscribe(req: TranscribeRequest, { provider, model }: RoleBinding, d: Deps): Promise<TranscribeResult> {
  const env = d.env ?? process.env;
  const mode = parseMode(d.mode ?? env.MUNSHI_MODEL_MODE);
  return viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, { kind: "transcribe", provider, model, audio: sha256Hex(req.wav), language: req.language }, RAW_SHAPE, async () => {
    const key = apiKey(provider, env);
    const doFetch = d.fetch ?? fetch;
    const t0 = Date.now();
    // The chat base is .../v1; speech-to-text sits at the host's root.
    const url = new URL("/speech-to-text", baseUrl(provider)).toString();
    const j = await withRetry(async () => {
      const res = await doFetch(url, { method: "POST", headers: { "api-subscription-key": key }, body: sarvamForm(req, model), signal: AbortSignal.timeout(ROLE_TIMEOUT_MS.voice) });
      if (!res.ok) {
        const body = redact((await res.text()).slice(0, 300), env);
        throw Object.assign(new Error(`voice call failed (${res.status}): ${body}`), { status: res.status });
      }
      return (await res.json()) as { transcript?: unknown; language_code?: unknown };
    }, d);
    if (typeof j.transcript !== "string") throw new ModelError("voice response had no transcript");
    return { provider, model, latencyMs: Date.now() - t0, text: j.transcript, language: typeof j.language_code === "string" ? j.language_code : null };
  });
}
