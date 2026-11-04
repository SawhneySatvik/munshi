import { z } from "zod";
import { DEFAULT_FIXTURES_DIR, parseMode, sha256Hex, viaFixture } from "./fixtures.ts";
import { aliasOf, allowCall, onList, openaiClient, requireKey, resolveBinding, told, withRetry, type Deps } from "./client.ts";
import { ModelError } from "./redact.ts";
import type { SegmentMatch, SegmentRequest, SegmentResult } from "./types.ts";

type Raw = Pick<SegmentResult, "provider" | "model" | "latencyMs"> & { text: string };
const RAW_SHAPE = z.object({ provider: z.string(), model: z.string(), latencyMs: z.number(), text: z.string() }) as unknown as z.ZodType<Raw>;

/** Builds the prompt text. Box grammar is from Meta's SAM docs ("Prompt with boxes and points"); a noun phrase is sent as-is. */
export function promptText(p: SegmentRequest["prompt"]): string {
  if ("phrase" in p) {
    const phrase = p.phrase.trim();
    if (!phrase || /[,;+\n]|\sand\s/i.test(phrase)) throw new ModelError("segment prompt must be one noun phrase (no lists)");
    return phrase;
  }
  if (p.boxes.length === 0) throw new ModelError("segment prompt has no boxes");
  const o = p.boxes.map((b) => `${b.id}<|box;x1=${b.x1};y1=${b.y1};x2=${b.x2};y2=${b.y2};w=${p.width};h=${p.height}|>`);
  return `<0f>${o.join(",")}`;
}

// The box's fields are read by name: with include_confidence the live API adds `;c=<score>` after h.
const RECORD = /(\d+)<\|box;([^|]*)\|><\|mask;(.*?)\|>/gs;
const BOX = ["x1", "y1", "x2", "y2", "w", "h"] as const;

/** One match per box+mask record. Empty text (concept absent) is a normal zero-match result. */
export function parseSegments(text: string): { matches: SegmentMatch[]; imageSize: { width: number; height: number } | null } {
  const matches: SegmentMatch[] = [];
  let imageSize: { width: number; height: number } | null = null;
  for (const m of text.matchAll(RECORD)) {
    const [, id, fields, mask] = m as unknown as string[];
    const f = Object.fromEntries((fields ?? "").split(";").map((kv) => kv.split("=") as [string, string]));
    if (!BOX.every((k) => /^\d+$/.test(f[k] ?? ""))) continue;
    const score = f.c !== undefined && Number.isFinite(Number(f.c)) ? Number(f.c) : null;
    matches.push({ id: Number(id), box: { x1: Number(f.x1), y1: Number(f.y1), x2: Number(f.x2), y2: Number(f.y2) }, mask: mask ?? "", score });
    imageSize ??= { width: Number(f.w), height: Number(f.h) };
  }
  if (text.trim() !== "" && matches.length === 0) throw new ModelError("segmentation output was not in the expected token format");
  return { matches, imageSize };
}

/**
 * A reply as the books keep it: every box record, with its masks and confidence scores dropped. A live reply carries a
 * mask of about 2 kB a match, so a full shelf overruns the evidence column (ops.shelf_count.raw, 20,000 characters); the
 * count is re-derived from the boxes alone, and the column's check counts records in exactly this form.
 */
export function evidenceOf(text: string): string {
  const { matches, imageSize } = parseSegments(text);
  if (!imageSize) return "";
  const { width: w, height: h } = imageSize;
  return `<0f>${matches.map((m) => `${m.id}<|box;x1=${m.box.x1};y1=${m.box.y1};x2=${m.box.x2};y2=${m.box.y2};w=${w};h=${h}|><|mask;|>`).join(",")}`;
}

// Request shape (Responses API, input_text + input_image, non-streaming) from Meta's SAM docs; non-streaming image
// response parsing is UNVERIFIED against a live call (docs show the streamed output_text deltas).
// `beforeCall`: core's allow (a media call), asked after the key is checked; false is a ModelError coded "off".
export async function segment(req: SegmentRequest, d: Deps = {}, beforeCall?: () => Promise<boolean>): Promise<SegmentResult> {
  const { provider, model } = await onList("segment", resolveBinding("segment", d), d, (p) => p === "meta");
  const text = promptText(req.prompt);
  requireKey(provider, d);
  await allowCall(beforeCall);
  const mode = parseMode(d.mode ?? (d.env ?? process.env).MUNSHI_MODEL_MODE);
  const imageKey = req.imageUrl.startsWith("data:") ? sha256Hex(new TextEncoder().encode(req.imageUrl)) : req.imageUrl;
  const raw = await viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, { kind: "segment", provider, model, prompt: text, image: imageKey }, RAW_SHAPE, async () => {
    const client = openaiClient(provider, "segment", d);
    const t0 = Date.now();
    const r = await withRetry(
      () =>
        client.responses.create({
          model,
          // meta-docs-sam-segmenting.txt: metadata values are strings; "true" fills per-record confidence
          metadata: { include_confidence: "true" },
          input: [{ type: "message", role: "user", content: [{ type: "input_text", text }, { type: "input_image", image_url: req.imageUrl, detail: "auto" }] }],
        }),
      d,
    );
    let out = "";
    for (const item of r.output) if (item.type === "message") for (const c of item.content) if (c.type === "output_text") out += c.text;
    return { provider, model, latencyMs: Date.now() - t0, text: out };
  });
  await told(d, { role: "segment", alias: aliasOf({ provider, model }, "segment"), provider, model, usage: null, replayed: mode === "recorded" });
  const rawSha256 = sha256Hex(new TextEncoder().encode(raw.text));
  return { provider: raw.provider, model: raw.model, latencyMs: raw.latencyMs, ...parseSegments(raw.text), raw: raw.text, rawSha256 };
}
