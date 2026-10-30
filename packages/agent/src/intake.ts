// What the inbox flows share (order-draft.ts, inbox.ts): a message's words as core stores them, the model calls they
// make, and the way a model points into the words. The words are the customer's own, untrusted (§7.8): reading them
// taints the run (tappedPort), they reach a model only inside a <data> block, a phone-shaped digit run is shown to it as
// "[phone]" (PII2), and they never enter a trace. A voice note is transcribed (role `voice`) and a photo of a handwritten
// list copied (role `vision`, no tools), and the words are stored once as the message's transcript (core's
// saveTranscript), so every span points into the stored words. The model points by word numbers: the words are numbered
// here, and code turns a pick of words into the span of code points core stores and re-reads; a model gives no offset,
// value or quote of its own. Every model call first asks the port's allow (core's count and caps), and is offered no
// tools: an answer that tries one is refused whole.
import { RULES } from "@munshi/core/read";
import { z } from "zod";
import type { InboxPort, TraceKind } from "./port.ts";
import type { Deps } from "./providers/client.ts";
import { generate } from "./providers/generate.ts";
import { transcribe } from "./providers/meta-voice.ts";
import { ModelError } from "./providers/redact.ts";
import type { GenerateRequest, Role } from "./providers/types.ts";
import { dataUrl, stillType } from "./photo.ts";
import { asData } from "./tools.ts";

export type InboxOptions = {
  port: InboxPort;
  deps?: Deps;
  now?: () => number;
  /** the message's media as the app fetched it: a voice note's WAV or a photo's still; none for a text message */
  media?: Uint8Array;
  /** a bias for the voice model ("Hindi", "English") */
  language?: string;
};

const BUDGET_MS = 45_000;

// The fixed labels the inbox flows put in a trace (a test holds every event to this list).
export const INBOX_LABELS: ReadonlySet<string> = new Set([
  "reason",
  "vision",
  "voice",
  "model_error",
  "tool_call",
  "ai_off",
  "transcript",
  "extracts",
  "order.extracts",
  "items.price",
  "inbox.extract",
  "credit.balance",
  "campaign.audience",
  "offer.detail",
  "order.confirm",
  "message.reply",
  "copy",
  "reply",
  "not_found",
  "no_words",
  "no_media",
  "not_a_still",
  "too_long",
  "unplaced",
  "unreadable",
  "nothing_matched",
  "refused",
  "no_answer",
  "ok",
  ...RULES,
]);

export async function traced(o: { port: InboxPort; now?: () => number }, kind: TraceKind, label: string, ids: string[] = [], since?: number): Promise<void> {
  const now = o.now ?? Date.now;
  await o.port.trace({ kind, label, ids, ms: since === undefined ? 0 : Math.max(0, Math.round(now() - since)) });
}

export type Refusal = "ai_off" | "model_error" | "tool_call";

/** One model call of an inbox flow: counted by core's allow first, no tools, the time budget as its signal. */
export async function quarantined(o: InboxOptions, req: Omit<GenerateRequest, "tools" | "signal">): Promise<{ json: unknown; model: string } | Refusal> {
  if (o.port.allow && !(await o.port.allow(req.role))) {
    await traced(o, "budget", "ai_off");
    return "ai_off";
  }
  const t0 = (o.now ?? Date.now)();
  try {
    const r = await generate({ ...req, signal: AbortSignal.timeout(BUDGET_MS) }, o.deps);
    await traced(o, "model", req.role, [], t0);
    if (r.toolCalls.length > 0 || r.json === undefined) {
      await traced(o, "abstain", "tool_call");
      return "tool_call";
    }
    return { json: r.json, model: r.model };
  } catch (err) {
    if (!(err instanceof ModelError)) throw err;
    await traced(o, "model", "model_error", [], t0);
    return "model_error";
  }
}

const COPY_LIST = [
  "You read one photo of a handwritten list a customer sent to a small shop, and copy what is written, one line of the list per line, exactly as written.",
  "Never compute, total, translate or correct anything, and never add a word that is not written. Give no lines if nothing is written.",
].join("\n");
const ListSchema = z.object({ lines: z.array(z.string().max(200)).max(40) });

export type Words = { source: string } | { refused: Refusal | "not_found" | "no_words" | "no_media" | "not_a_still" | "too_long" };

const allowed = async (o: InboxOptions, role: Role) => {
  if (!o.port.allow || (await o.port.allow(role))) return true;
  await traced(o, "budget", "ai_off");
  return false;
};

/**
 * A message's words as core stores them (the transcript, else the text). A voice note or a photo with no transcript yet
 * is read now from `media` and its words stored as the transcript, once. Read through the run's port, so the run is
 * tainted before the words reach it.
 */
export async function wordsOf(o: InboxOptions, messageId: string): Promise<Words> {
  const w = await o.port.message(messageId);
  if (!w) return { refused: "not_found" };
  if (w.transcript?.trim()) return { source: w.transcript };
  if (w.kind === "text" || w.kind === "other") return w.text?.trim() ? { source: w.text } : { refused: "no_words" };
  if (!o.media) return { refused: "no_media" };
  let read: string;
  const t0 = (o.now ?? Date.now)();
  if (w.kind === "audio") {
    if (!(await allowed(o, "voice"))) return { refused: "ai_off" };
    try {
      read = (await transcribe({ wav: o.media, ...(o.language ? { language: o.language } : {}) }, o.deps)).text;
      await traced(o, "model", "voice", [], t0);
    } catch (err) {
      if (!(err instanceof ModelError)) throw err;
      await traced(o, "model", "model_error", [], t0);
      return { refused: "model_error" };
    }
  } else {
    const mime = stillType(o.media);
    if (!mime) return { refused: "not_a_still" };
    const seen = await quarantined(o, {
      role: "vision",
      messages: [
        { role: "system", content: COPY_LIST },
        { role: "user", content: "The photo:", imageUrl: dataUrl(mime, o.media) },
      ],
      schema: { name: "list", zod: ListSchema },
    });
    if (typeof seen === "string") return { refused: seen };
    read = (seen.json as z.infer<typeof ListSchema>).lines.join("\n");
  }
  if (!read.trim()) return { refused: "no_words" };
  if ([...read].length > 4096) return { refused: "too_long" };
  await o.port.saveTranscript(messageId, read);
  await traced(o, "evidence", "transcript", [messageId]);
  return { source: read };
}

/** A word of the stored words: its text and its span in code points. */
export type Word = { text: string; start: number; end: number };

// A word is a run of digits (with the commas and points inside a figure), a run of letters and marks (Devanagari's
// vowel signs are marks), or one other visible character; spaces and invisible characters divide them.
const WORD = /\p{Nd}+(?:[,.]\p{Nd}+)*|[\p{L}\p{M}]+|[^\s\p{L}\p{M}\p{Nd}\p{Cc}\p{Cf}]/gu;
// A phone-shaped run: ten or more digits, with spaces or dashes between them.
const PHONE = /\+?\p{Nd}(?:[\s-]?\p{Nd}){9,}/gu;

export function wordsIn(source: string): Word[] {
  const out: Word[] = [];
  let unit = 0; // UTF-16 index the code-point count below has reached
  let point = 0;
  for (const m of source.matchAll(WORD)) {
    point += [...source.slice(unit, m.index)].length;
    const len = [...m[0]].length;
    out.push({ text: m[0], start: point, end: point + len });
    point += len;
    unit = m.index + m[0].length;
  }
  return out;
}

/** The words as a model sees them: one <data> block of numbered words; a word inside a phone-shaped run is "[phone]". */
export function shownWords(source: string, words: Word[]): string {
  const phones: [number, number][] = [];
  for (const m of source.matchAll(PHONE)) {
    const start = [...source.slice(0, m.index)].length;
    phones.push([start, start + [...m[0]].length]);
  }
  const shown = words.map((w, i) => [i, phones.some(([a, b]) => w.start < b && a < w.end) ? "[phone]" : w.text]);
  return `<data words="${words.length}">${asData(JSON.stringify(shown))}</data>`;
}

/** A model's pick of words, numbered from 0, first and last inclusive. */
export const Pick = z.object({ from: z.number().int().min(0), to: z.number().int().min(0) });
export type Span = { start: number; end: number };

/** The span a pick names, or null when it names no word of these. */
export function spanOf(words: Word[], pick: z.infer<typeof Pick> | null): Span | null {
  if (!pick || pick.from > pick.to) return null;
  const a = words[pick.from];
  const b = words[pick.to];
  return a && b ? { start: a.start, end: b.end } : null;
}

export const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;
