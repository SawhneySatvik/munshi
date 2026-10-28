import { z } from "zod";
import { ROLE_TIMEOUT_MS } from "../config.ts";
import { apiKey, baseUrl, resolveMetaBinding, withRetry, type Deps } from "./client.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, sha256Hex, viaFixture } from "./fixtures.ts";
import { ModelError, redact } from "./redact.ts";
import type { TranscribeRequest, TranscribeResult } from "./types.ts";

type Raw = Pick<TranscribeResult, "provider" | "model" | "latencyMs" | "text">;
const RAW_SHAPE = z.object({ provider: z.string(), model: z.string(), latencyMs: z.number(), text: z.string() }) as unknown as z.ZodType<Raw>;

/** The endpoint accepts only RIFF/WAVE mono 16-bit PCM at 16 or 24 kHz; check before spending a call. */
export function assertWav(b: Uint8Array): void {
  if (b.length < 44) throw new ModelError("audio is not a WAV file");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new ModelError("audio is not a WAV file");
  // fmt chunk is first in files from afconvert/ffmpeg; offset 20 = format, 22 = channels, 24 = rate, 34 = bits
  const fmt = v.getUint16(20, true), ch = v.getUint16(22, true), rate = v.getUint32(24, true), bits = v.getUint16(34, true);
  if (fmt !== 1 || ch !== 1 || bits !== 16 || (rate !== 16000 && rate !== 24000)) throw new ModelError("audio must be mono 16-bit PCM WAV at 16 or 24 kHz");
}

// Request shape (multipart: `request` JSON part + `audio` part, to POST /v1/asr/transcribe) follows Meta's speech-to-text docs.
// UNVERIFIED: the response is read as { transcript }; the docs show no detected-language field, so language is null.
export async function transcribe(req: TranscribeRequest, d: Deps = {}): Promise<TranscribeResult> {
  const { provider, model } = resolveMetaBinding("voice", d);
  assertWav(req.wav);
  const mode = parseMode(d.mode ?? (d.env ?? process.env).MUNSHI_MODEL_MODE);
  const raw = await viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, { kind: "transcribe", provider, model, audio: sha256Hex(req.wav), language: req.language }, RAW_SHAPE, async () => {
    const key = apiKey(provider, d.env ?? process.env);
    const doFetch = d.fetch ?? fetch;
    const t0 = Date.now();
    const text = await withRetry(async () => {
      const form = new FormData();
      const settings = { mode: "PUSH_TO_TALK", model, audioEncoding: "WAV", ...(req.language ? { languageBias: [req.language] } : {}) };
      form.append("request", new Blob([JSON.stringify(settings)], { type: "application/json" }));
      form.append("audio", new Blob([req.wav as BlobPart], { type: "audio/wav" }), "audio.wav");
      const res = await doFetch(`${baseUrl(provider)}/asr/transcribe`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(ROLE_TIMEOUT_MS.voice),
      });
      if (!res.ok) {
        const body = redact((await res.text()).slice(0, 300), d.env ?? process.env);
        let code: string | undefined;
        try {
          const j = JSON.parse(body) as { error?: { code?: unknown } };
          if (typeof j.error?.code === "string") code = j.error.code;
        } catch { /* body was not JSON */ }
        throw Object.assign(new Error(`voice call failed (${res.status}): ${body}`), { status: res.status, code });
      }
      const j = (await res.json()) as { transcript?: unknown };
      if (typeof j.transcript !== "string") throw new ModelError("voice response had no transcript");
      return j.transcript;
    }, d);
    return { provider, model, latencyMs: Date.now() - t0, text };
  });
  return { ...raw, language: null };
}
