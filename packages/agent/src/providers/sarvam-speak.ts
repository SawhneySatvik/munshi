// Sarvam's text-to-speech (Bulbul), from its public REST reference (docs.sarvam.ai/api-reference/text-to-speech/convert,
// read 2 Nov 2026): POST https://api.sarvam.ai/text-to-speech, JSON { text, language_code, speaker, model,
// output_audio_codec }, the key in the `api-subscription-key` header; the reply is { request_id, audios: [base64] }.
// bulbul:v3 takes at most 2500 characters a request and the speak role's languages (types.ts SPEAK_LANGUAGES); its
// default speaker is shubh. MP3 frames stand alone, so the clips of a long text, each decoded on its own, are joined
// byte for byte into one playable file.
import { z } from "zod";
import { ROLE_TIMEOUT_MS, type RoleBinding } from "../config.ts";
import { allowCall, apiKey, baseUrl, withRetry, type Deps } from "./client.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, viaFixture } from "./fixtures.ts";
import { ModelError, redact } from "./redact.ts";
import type { SpeakLanguage, SpeakRequest, SpeakResult } from "./types.ts";

export const MAX_SPEAK_CHARS = 2500;
const SPEAKER = "shubh";

type Raw = { provider: string; model: string; latencyMs: number; audios: string[] };
const RAW_SHAPE = z.object({ provider: z.string(), model: z.string(), latencyMs: z.number(), audios: z.array(z.string()).min(1) }) as unknown as z.ZodType<Raw>;

// A character of a figure: a digit, a point or a comma. A cut never falls between two of them, nor inside ⟦n⟧.
const FIGURE = /[\p{Nd}.,]/u;

/** Where `cut` may stand: moved back off a run of figure characters and out of an unclosed ⟦…⟧; 0 if nowhere. */
function safeCut(text: string, cut: number): number {
  let at = cut;
  while (at > 0 && FIGURE.test(text[at - 1] as string) && FIGURE.test(text[at] ?? "")) at--;
  const open = text.lastIndexOf("⟦", at - 1);
  if (open >= 0 && text.indexOf("⟧", open) >= at) at = open;
  return at;
}

/**
 * The text as requests of at most `max` characters. A piece ends after a sentence's end (. ? ! ।) followed by a space in
 * the whole text (so "₹8." at the limit, with "50" after it, is no sentence end), else at the last space, else at the
 * limit moved back off any figure or placeholder. No piece is empty; together they hold every non-space character.
 */
export function speakPieces(text: string, max = MAX_SPEAK_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    // One character past the limit, so the lookahead sees what follows the last character a piece may hold.
    const reach = rest.slice(0, max + 1);
    let cut = -1;
    for (const m of reach.matchAll(/[.?!।](?=\s)/g)) if (m.index + 1 <= max) cut = m.index + 1;
    if (cut <= 0) cut = reach.lastIndexOf(" ", max);
    if (cut <= 0) cut = safeCut(rest, max) || max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** One request: one piece of text, its clips, through the recorded fixtures like every other call. */
async function speakPiece(text: string, language: SpeakLanguage, speaker: string, provider: SpeakResult["provider"], model: string, d: Deps): Promise<Raw> {
  const env = d.env ?? process.env;
  const mode = parseMode(d.mode ?? env.MUNSHI_MODEL_MODE);
  return viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, { kind: "speak", provider, model, text, language, speaker }, RAW_SHAPE, async () => {
    const key = apiKey(provider, env);
    const doFetch = d.fetch ?? fetch;
    const t0 = Date.now();
    // The chat base is .../v1; text-to-speech sits at the host's root.
    const url = new URL("/text-to-speech", baseUrl(provider)).toString();
    const body = JSON.stringify({ text, language_code: language, speaker, model, output_audio_codec: "mp3" });
    const j = await withRetry(async () => {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "api-subscription-key": key, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(ROLE_TIMEOUT_MS.speak),
      });
      if (!res.ok) {
        const msg = redact((await res.text()).slice(0, 300), env);
        throw Object.assign(new Error(`speak call failed (${res.status}): ${msg}`), { status: res.status });
      }
      return (await res.json()) as { audios?: unknown };
    }, d);
    const audios = Array.isArray(j.audios) ? j.audios.filter((a): a is string => typeof a === "string" && a.length > 0) : [];
    if (audios.length === 0) throw new ModelError("speak response had no audio");
    return { provider, model, latencyMs: Date.now() - t0, audios };
  });
}

/**
 * Sarvam's adapter for the speak role (speech.ts dispatches to it, having checked the language and the key): one
 * request a piece of the text, the clips joined. `beforeEach` is asked before every request (core's allow, a media
 * call); false stops with a ModelError coded "off".
 */
export async function sarvamSpeak(req: SpeakRequest, b: RoleBinding, d: Deps, beforeEach?: () => Promise<boolean>): Promise<SpeakResult> {
  const pieces = speakPieces(req.text);
  if (pieces.length === 0) throw new ModelError("speak: nothing to read");
  const speaker = req.speaker ?? SPEAKER;
  const clips: Uint8Array[] = [];
  let latencyMs = 0;
  for (const piece of pieces) {
    await allowCall(beforeEach);
    const r = await speakPiece(piece, req.language, speaker, b.provider, b.model, d);
    for (const a of r.audios) clips.push(Buffer.from(a, "base64"));
    latencyMs += r.latencyMs;
  }
  const audio = new Uint8Array(clips.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of clips) {
    audio.set(c, at);
    at += c.length;
  }
  // Sarvam answers MP3, as asked; a recorded stand-in clip may be a WAV (the hero tests write one), and plays as one.
  const mime = String.fromCharCode(...audio.subarray(0, 4)) === "RIFF" ? "audio/wav" : "audio/mpeg";
  return { provider: b.provider, model: b.model, latencyMs, audio, mime, chars: pieces.reduce((n, p) => n + p.length, 0) };
}
