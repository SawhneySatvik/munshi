import { z } from "zod";
import { DEFAULT_FIXTURES_DIR, parseMode, sha256Hex, viaFixture } from "./fixtures.ts";
import { openaiClient, resolveMetaBinding, withRetry, type Deps } from "./client.ts";
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

const RECORD = /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|><\|mask;(.*?)\|>/gs;

/** One match per box+mask record. Empty text (concept absent) is a normal zero-match result. */
export function parseSegments(text: string): { matches: SegmentMatch[]; imageSize: { width: number; height: number } | null } {
  const matches: SegmentMatch[] = [];
  let imageSize: { width: number; height: number } | null = null;
  for (const m of text.matchAll(RECORD)) {
    const [, id, x1, y1, x2, y2, w, h, mask] = m as unknown as string[];
    matches.push({ id: Number(id), box: { x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2) }, mask: mask ?? "", score: null });
    imageSize ??= { width: Number(w), height: Number(h) };
  }
  if (text.trim() !== "" && matches.length === 0) throw new ModelError("segmentation output was not in the expected token format");
  return { matches, imageSize };
}

// Request shape (Responses API, input_text + input_image, non-streaming) from Meta's SAM docs; non-streaming image
// response parsing is UNVERIFIED against a live call (docs show the streamed output_text deltas).
export async function segment(req: SegmentRequest, d: Deps = {}): Promise<SegmentResult> {
  const { provider, model } = resolveMetaBinding("segment", d);
  const text = promptText(req.prompt);
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
  const rawSha256 = sha256Hex(new TextEncoder().encode(raw.text));
  return { provider: raw.provider, model: raw.model, latencyMs: raw.latencyMs, ...parseSegments(raw.text), raw: raw.text, rawSha256 };
}
