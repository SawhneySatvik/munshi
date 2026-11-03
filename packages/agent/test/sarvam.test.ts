// W2-C, Sarvam through the provider layer: Bulbul reads checked text aloud (the speak role, Sarvam's on both editions),
// Saaras detects the language it hears, and Sarvam Vision reads a PDF bill whose every figure is then placed on its page.
// Fake fetches only, no network; recorded mode replays what record mode wrote and never calls out.
import type { Cell } from "@munshi/core/read";
import { expect, it } from "vitest";
import { heldAsToken, isPdf, printedDate, readBill } from "../src/bill.ts";
import { aliasBinding, EDITION_ROLES, editionAllowList, keyedBinding, KNOWN_ALIASES, MAX_PAGES, MAX_SPEAK_CHARS, pageBlocks, readDocument, speak, speakPieces, transcribe } from "@munshi/ai";
import type { AgentPort, BillReadRecord, EvidencePort, TraceEvent } from "../src/port.ts";
import { readAloud } from "../src/speak.ts";
import { askByVoice } from "../src/voice.ts";
import { env, json, noSleep, queueFetch, responsesBody, tmpFixtures, wavBytes } from "./helpers.ts";

const SARVAM = "sv-test-SECRET-0123456789";
const keyed = { ...env, SARVAM_API_KEY: SARVAM } as NodeJS.ProcessEnv;
const live = (e: NodeJS.ProcessEnv = keyed) => ({ env: e, mode: "live", sleep: noSleep, edition: "meta" }) as const;
const clip = (s: string) => Buffer.from(s).toString("base64");
const headerOf = (c: { init: RequestInit | undefined } | undefined) => (c?.init?.headers as Record<string, string> | undefined)?.["api-subscription-key"];
const noNetwork = (async () => {
  throw new Error("recorded mode reached the network");
}) as typeof fetch;

function port(events: TraceEvent[], allow: (role: string) => boolean = () => true, allowed: string[] = []): AgentPort {
  return {
    read: async () => {
      throw new Error("no reads");
    },
    resolve: async () => null,
    propose: async () => {
      throw new Error("no drafts");
    },
    finding: async () => null,
    trace: (e) => {
      events.push(e);
    },
    allow: async (role) => {
      allowed.push(role);
      return allow(role);
    },
  };
}

it("SPEAK1 is Sarvam's Bulbul on both editions, on both allow-lists, and in no other alias's roles", () => {
  expect(EDITION_ROLES.meta.speak).toEqual({ provider: "sarvam", model: "bulbul:v3" });
  expect(EDITION_ROLES.paytm.speak).toEqual({ provider: "sarvam", model: "bulbul:v3" });
  for (const e of ["meta", "paytm"] as const) expect(editionAllowList(e).filter((p) => p.role === "speak")).toEqual([{ alias: "bulbul-v3", role: "speak" }]);
  expect(Object.entries(KNOWN_ALIASES).filter(([, roles]) => roles.includes("speak")).map(([a]) => a)).toEqual(["bulbul-v3"]);
});

it("SPEAK2 posts the text to text-to-speech at the host's root with the key in its header, and returns the clip", async () => {
  const { f, calls } = queueFetch(json(200, { request_id: "r1", audios: [clip("ID3-one")] }));
  const r = await speak({ text: "Sales yesterday were ₹1,240.", language: "en-IN" }, { ...live(), fetch: f });
  expect(calls.map((c) => c.url)).toEqual(["https://api.sarvam.ai/text-to-speech"]);
  expect(headerOf(calls[0])).toBe(SARVAM);
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ text: "Sales yesterday were ₹1,240.", language_code: "en-IN", speaker: "shubh", model: "bulbul:v3", output_audio_codec: "mp3" });
  expect(Buffer.from(r.audio).toString()).toBe("ID3-one");
  expect(r).toMatchObject({ provider: "sarvam", model: "bulbul:v3", mime: "audio/mpeg", chars: 28 });
});

it("SPEAK3 a text over the request limit goes as pieces cut at sentence ends, each allowed first; a refusal stops it", async () => {
  const sentence = `${"word ".repeat(99)}end.`; // 499 characters
  const text = Array.from({ length: 6 }, () => sentence).join(" ");
  const pieces = speakPieces(text);
  expect(pieces.length).toBe(2);
  for (const p of pieces) expect(p.length).toBeLessThanOrEqual(MAX_SPEAK_CHARS);
  for (const p of pieces) expect(p.endsWith("end.")).toBe(true);
  expect(pieces.join(" ")).toBe(text);
  expect(speakPieces("नमस्ते। ".repeat(400)).every((p) => p.endsWith("।") && p.length <= MAX_SPEAK_CHARS)).toBe(true);

  const allowed: string[] = [];
  const { f, calls } = queueFetch(json(200, { audios: [clip("A")] }), json(200, { audios: [clip("B")] }));
  const r = await speak({ text, language: "hi-IN" }, { ...live(), fetch: f }, async () => {
    allowed.push("speak");
    return true;
  });
  expect([calls.length, allowed.length, Buffer.from(r.audio).toString()]).toEqual([2, 2, "AB"]);

  const events: TraceEvent[] = [];
  const once = queueFetch(json(200, { audios: [clip("A")] }));
  let n = 0;
  const out = await readAloud(text, { port: port(events, () => n++ === 0), language: "hi-IN", deps: { ...live(), fetch: once.f } });
  expect(out).toEqual({ kind: "refused", why: "off" });
  expect(once.calls.length).toBe(1);
  expect(events.map((e) => [e.kind, e.label])).toEqual([["abstain", "ai_off"]]);
});

it("SPEAK4 a speak call is asked of core's allow as role speak (a media call), before any request", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const out = await readAloud("Hello.", { port: port(events, () => false, allowed), language: "en-IN", deps: { ...live(), fetch: f } });
  expect(out).toEqual({ kind: "refused", why: "off" });
  expect(allowed).toEqual(["speak"]);
  expect(calls).toEqual([]);
});

it("SPEAK5 a missing Sarvam key fails the call by name (no_key), before any request, as a result, not a throw", async () => {
  const { SARVAM_API_KEY: _s, ...noKey } = keyed;
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const out = await readAloud("Hello.", { port: port(events, () => true, allowed), language: "en-IN", deps: { ...live(noKey), fetch: f } });
  expect(out).toEqual({ kind: "refused", why: "no_key" });
  expect(calls).toEqual([]);
  expect(allowed).toEqual([]); // no call counted against the shop's caps
  expect(events.map((e) => e.label)).toEqual(["no_key"]);
  await expect(speak({ text: "Hello.", language: "en-IN" }, { ...live(noKey), fetch: f })).rejects.toThrow("SARVAM_API_KEY is not set");
});

it("SPEAK6 recorded mode replays what record mode wrote, with no network call; with no fixture it fails, still offline", async () => {
  const dir = tmpFixtures();
  const { f } = queueFetch(json(200, { audios: [clip("ID3-recorded")] }));
  await speak({ text: "Hello.", language: "en-IN" }, { env: keyed, mode: "record", fixturesDir: dir, fetch: f, edition: "paytm" });
  const events: TraceEvent[] = [];
  const out = await readAloud("Hello.", { port: port(events), language: "en-IN", deps: { env: {}, mode: "recorded", fixturesDir: dir, fetch: noNetwork, edition: "paytm" } });
  expect(out.kind === "audio" && Buffer.from(out.audio).toString()).toBe("ID3-recorded");
  expect(events.map((e) => e.label)).toEqual(["speak"]);
  const missing = await readAloud("Something else.", { port: port([]), language: "en-IN", deps: { env: {}, mode: "recorded", fixturesDir: dir, fetch: noNetwork } });
  expect(missing).toEqual({ kind: "refused", why: "model_error" });
});

it("SPEAK7 a language Bulbul does not speak is refused before a call", async () => {
  const { f, calls } = queueFetch();
  await expect(speak({ text: "Hello.", language: "fr-FR" as never }, { ...live(), fetch: f })).rejects.toThrow("not spoken");
  expect(calls).toEqual([]);
});

it("SPEAK8 the speak desk's chain decides: an empty one (none allowed) is off before any call; else its first alias answers", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const asked: string[] = [];
  const { f, calls } = queueFetch(json(200, { audios: [clip("ID3-chain")] }));
  const chained = (aliases: string[]): AgentPort => ({
    ...port(events, () => true, allowed),
    models: async (agent, role) => {
      asked.push(`${agent}/${role}`);
      return aliases;
    },
  });
  expect(await readAloud("Hello.", { port: chained([]), language: "en-IN", deps: { ...live(), fetch: f } })).toEqual({ kind: "refused", why: "off" });
  expect([calls.length, allowed.length, events.map((e) => e.label)]).toEqual([0, 0, ["ai_off"]]);
  // An alias the build does not serve for speak (a text model) is passed over for the next.
  const out = await readAloud("Hello.", { port: chained(["muse-spark", "bulbul-v3"]), language: "en-IN", deps: { ...live(), fetch: f } });
  expect(out.kind === "audio" && [out.model, Buffer.from(out.audio).toString()]).toEqual(["bulbul:v3", "ID3-chain"]);
  expect(asked).toEqual(["speak/speak", "speak/speak"]);
});

it("VOICE1 with no bias it asks Sarvam to detect (unknown), and the language it heard comes back through askByVoice", async () => {
  const events: TraceEvent[] = [];
  // Sarvam hears Tamil; the question then goes to the router, which fails here, so the reply abstains: the language
  // still comes back with the transcript.
  const { f, calls } = queueFetch(json(200, { request_id: "r", transcript: "நேற்று விற்பனை எவ்வளவு?", language_code: "ta-IN" }), json(400, { error: { message: "no" } }));
  const out = await askByVoice(wavBytes(), { port: port(events), asOf: "2026-11-02", deps: { env: keyed, mode: "live", sleep: noSleep, edition: "paytm", fetch: f } });
  expect((calls[0]?.init?.body as FormData | undefined)?.get("language_code")).toBe("unknown");
  expect(out).toMatchObject({ transcript: "நேற்று விற்பனை எவ்வளவு?", language: "ta-IN", reply: { kind: "abstain" } });
});

it("VOICE2 on the meta edition with no Meta key, voice falls back from Muse Voice to Saaras, and a non-code language is dropped", async () => {
  const { META_MODEL_API_KEY: _m, ...noMeta } = keyed;
  expect(keyedBinding("voice", "meta", noMeta, true)).toEqual({ provider: "sarvam", model: "saaras:v4" });
  const { f } = queueFetch(json(200, { transcript: "hello", language_code: "<b>en</b>" }));
  expect((await transcribe({ wav: wavBytes() }, { env: noMeta, mode: "live", sleep: noSleep, edition: "meta", fetch: f })).language).toBe("<b>en</b>");
  const g = queueFetch(json(200, { transcript: "hello", language_code: "<b>en</b>" }), json(400, { error: { message: "no" } }));
  const out = await askByVoice(wavBytes(), { port: port([]), asOf: "2026-11-02", deps: { env: noMeta, mode: "live", sleep: noSleep, edition: "meta", fetch: g.f } });
  expect(out.language).toBeNull();
});

// ---- a PDF bill ----------------------------------------------------------------------------------------------------

const SUPPLIER = "9a1b2c3d-0000-4000-8000-000000000002";
const ITEM = "9a1b2c3d-0000-4000-8000-000000000001";
const t = (txt: string): Cell => ({ kind: "text", txt });
const WORLD: Record<string, Record<string, Cell>[]> = {
  "bill.lines": [
    {
      item_id: t(ITEM),
      bill_no: t("GT-77"),
      bill_date: { kind: "date", day: "2026-10-30" },
      qty: { kind: "quantity", num: "24000", unit: "pack" },
      unit_cost: { kind: "money", num: "850", currency: "INR" },
    },
  ],
  "stock.on_hand": [{ on_hand: { kind: "quantity", num: "10000", unit: "pack" } }],
  "purchases.last_price": [{ unit_cost: { kind: "money", num: "850", currency: "INR" } }],
};
const PDF = new Uint8Array(Buffer.from("%PDF-1.4\n% a synthetic one-page bill for tests\n%%EOF\n"));
// The page as Sarvam Vision's parse JSON gives it (UNVERIFIED shape, providers/sarvam-docs.ts): blocks with a bbox in
// the page's own size.
const PAGE = {
  width: 800,
  height: 1000,
  blocks: [
    { text: "Gupta Traders (simulated) Bill No. GT-77 Date 30/10/2026", bbox: [40, 40, 600, 80] },
    { text: "Glucose biscuits 70 g", bbox: [40, 200, 300, 230] },
    { text: "24", bbox: [400, 200, 440, 230] },
    { text: "₹8.50", bbox: [560, 200, 640, 230] },
  ],
};
const docReplies = (page: unknown = PAGE) => [
  json(201, { job_id: "job_1", status: "Pending", run_id: "r" }),
  json(200, { job_id: "job_1", status: "Running", usage: {} }),
  json(200, { job_id: "job_1", status: "Completed", usage: {} }),
  json(200, { job_id: "job_1", type: "parse", status: "completed", usage: {}, documents: [{ file_name: "document.pdf", pages: [{ page_number: 1, content: JSON.stringify(page) }] }] }),
];
const reading = (over: Record<string, unknown> = {}) => ({
  billNo: { block: 1, text: "GT-77" },
  billDate: { block: 1, text: "30/10/2026" },
  lines: [{ item: { block: 2, text: "Glucose biscuits 70 g" }, qty: { block: 3, text: "24" }, rate: { block: 4, text: "8.50" } }],
  ...over,
});
const reasonReply = (r: unknown) =>
  json(200, responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(r), annotations: [] }] }] }));

function billPort(events: TraceEvent[], kept: BillReadRecord[], allowed: string[] = []): EvidencePort {
  return {
    async read(name) {
      const rows = WORLD[name];
      if (!rows) throw new Error("no such read");
      return { snapshotId: `00000000-0000-4000-8000-${String(events.length).padStart(12, "0")}`, rows };
    },
    resolve: async () => null,
    propose: async () => "draft-1",
    finding: async () => null,
    trace: (e) => {
      events.push(e);
    },
    allow: async (role) => {
      allowed.push(role);
      return true;
    },
    recordCount: async () => "count",
    async recordBill(b) {
      kept.push(b);
      return "00000000-0000-4000-8000-0000000000bb";
    },
  };
}

it("DOC1 Sarvam Vision runs one parse job (parse, poll, results) with the key; the page's blocks come back placed", async () => {
  const { f, calls } = queueFetch(...docReplies());
  const r = await readDocument(PDF, "application/pdf", "en-IN", { ...live(), fetch: f });
  expect(calls.map((c) => [c.init?.method ?? "GET", new URL(c.url).pathname + new URL(c.url).search])).toEqual([
    ["POST", "/doc-ai/v1/job/parse"],
    ["GET", "/doc-ai/v1/job/job_1/status"],
    ["GET", "/doc-ai/v1/job/job_1/status"],
    ["GET", "/doc-ai/v1/job/job_1/results?format=json"],
  ]);
  for (const c of calls) expect(headerOf(c)).toBe(SARVAM);
  const form = calls[0]?.init?.body as FormData;
  expect([form.get("language"), form.get("model"), (form.get("file") as Blob).type]).toEqual(["en-IN", "sarvam-vision", "application/pdf"]);
  expect(r.complete).toBe(true);
  expect(r.pages).toEqual([{ page: 1, blocks: PAGE.blocks.map(({ text, bbox: [x1, y1, x2, y2] }) => ({ text, box: [(x1 as number) * 1.25, y1, (x2 as number) * 1.25, y2] })) }]);
  expect(pageBlocks({ blocks: [{ text: "x", region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }] })).toEqual([{ text: "x", box: [100, 200, 400, 300] }]);
  expect(pageBlocks({ content: "<p>markdown, no blocks</p>" })).toEqual([]);
});

it("DOC2 sarvam-vision is a document reader only: never in a chain, a picker, the allow-list, or an image call", () => {
  expect(aliasBinding("sarvam-vision", "vision")).toBeNull();
  expect(KNOWN_ALIASES["sarvam-vision"]).toBeUndefined();
  for (const e of ["meta", "paytm"] as const) expect(editionAllowList(e).some((p) => p.alias === "sarvam-vision")).toBe(false);
  // Meta's key gone, only Sarvam's set: an image still never goes to the document reader.
  const { META_MODEL_API_KEY: _m, ...onlySarvam } = keyed;
  expect(keyedBinding("vision", "meta", onlySarvam, true)).not.toMatchObject({ model: "sarvam-vision" });
});

it("DOC3 a PDF bill reads to a purchase draft: every figure the text of its block, placed where the block is", async () => {
  expect(isPdf(PDF)).toBe(true);
  const events: TraceEvent[] = [];
  const kept: BillReadRecord[] = [];
  const allowed: string[] = [];
  const { f } = queueFetch(...docReplies(), reasonReply(reading()));
  const r = await readBill(PDF, { port: billPort(events, kept, allowed), deps: { ...live(), fetch: f }, supplierId: SUPPLIER });
  expect(r).toMatchObject({ kind: "read", draftId: "draft-1", why: null });
  expect(allowed).toEqual(["vision", "reason"]);
  expect(kept).toEqual([
    {
      supplierId: SUPPLIER,
      photoSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      model: "sarvam-vision:muse-spark-1.3",
      billNo: "GT-77",
      billDate: "2026-10-30",
      lines: [{ text: "Glucose biscuits 70 g", qtyMilli: 24000, qtyAt: [500, 200, 550, 230], unitCostMinor: 850, unitCostAt: [700, 200, 800, 230] }],
    },
  ]);
  expect(events.filter((e) => e.kind === "model").map((e) => e.label)).toEqual(["document", "reason"]);
});

it("DOC4 a figure not in the block it names, or a block with no place, refuses the whole bill: nothing is recorded", async () => {
  for (const [r, page, why] of [
    [reading({ lines: [{ item: { block: 2, text: "Glucose biscuits 70 g" }, qty: { block: 3, text: "48" }, rate: { block: 4, text: "8.50" } }] }), PAGE, "unreadable"],
    [reading(), { ...PAGE, blocks: PAGE.blocks.map((b, i) => (i === 2 ? { text: b.text } : b)) }, "unplaced"],
  ] as const) {
    const kept: BillReadRecord[] = [];
    const { f } = queueFetch(...docReplies(page), reasonReply(r));
    expect(await readBill(PDF, { port: billPort([], kept), deps: { ...live(), fetch: f }, supplierId: SUPPLIER })).toEqual({ kind: "refused", why });
    expect(kept).toEqual([]);
  }
});

it("DOC5 recorded mode reads the PDF bill from what record mode wrote, with no network call", async () => {
  const dir = tmpFixtures();
  const { f } = queueFetch(...docReplies(), reasonReply(reading()));
  await readBill(PDF, { port: billPort([], []), deps: { ...live(), mode: "record", fixturesDir: dir, fetch: f }, supplierId: SUPPLIER });
  const kept: BillReadRecord[] = [];
  const r = await readBill(PDF, { port: billPort([], kept), deps: { env: {}, mode: "recorded", fixturesDir: dir, fetch: noNetwork, edition: "meta" }, supplierId: SUPPLIER });
  expect(r).toMatchObject({ kind: "read", draftId: "draft-1" });
  expect(kept[0]?.lines[0]?.qtyMilli).toBe(24000);
});

// ---- fix cycle 1: whole tokens, the date read on the page, part-read documents, the job POST, the key, the cut ----------

const line = (qty: string, rate: string, qtyBlock = 3, rateBlock = 4) => [{ item: { block: 2, text: "Glucose biscuits 70 g" }, qty: { block: qtyBlock, text: qty }, rate: { block: rateBlock, text: rate } }];
const readPdf = async (r: unknown, page: unknown = PAGE, kept: BillReadRecord[] = []) => {
  const { f } = queueFetch(...docReplies(page), reasonReply(r));
  return readBill(PDF, { port: billPort([], kept), deps: { ...live(), fetch: f }, supplierId: SUPPLIER });
};

it("DOC6 a figure is held only as a whole token of its block: 4 inside 24, 50 inside ₹8.50 and a zero are refused", async () => {
  expect([heldAsToken("24", "4"), heldAsToken("₹8.50", "50"), heldAsToken("₹8.50", "8.5"), heldAsToken("₹8.50", "8.50"), heldAsToken("24 pcs", "24")]).toEqual([false, false, false, true, true]);
  const zero = { ...PAGE, blocks: [...PAGE.blocks, { text: "0.00", bbox: [560, 240, 640, 270] }, { text: "0", bbox: [400, 240, 440, 270] }] };
  for (const [r, page] of [
    [reading({ lines: line("4", "8.50") }), PAGE],
    [reading({ lines: line("24", "50") }), PAGE],
    [reading({ lines: line("24", "0.00", 3, 5) }), zero],
    [reading({ lines: line("0", "8.50", 6) }), zero],
  ] as const) {
    const kept: BillReadRecord[] = [];
    expect(await readPdf(r, page, kept), JSON.stringify(r.lines)).toEqual({ kind: "refused", why: "unreadable" });
    expect(kept).toEqual([]);
  }
});

it("DOC7 the bill's date is read on the page as a whole token and a calendar day; else the bill is kept with no date", async () => {
  expect([printedDate("30/10/2026"), printedDate("2026-10-30"), printedDate("3.1.2026"), printedDate("31/02/2026"), printedDate("30 Oct")]).toEqual([
    "2026-10-30",
    "2026-10-30",
    "2026-01-03",
    null,
    null,
  ]);
  const dated = { ...PAGE, blocks: PAGE.blocks.map((b, i) => (i === 0 ? { ...b, text: "Gupta Traders (simulated) Bill No. GT-77 Date 31/02/2026 or 30/10/20261" } : b)) };
  for (const [billDate, page] of [
    [{ block: 2, text: "30/10/2026" }, PAGE], // not in the block it names
    [{ block: 1, text: "31/02/2026" }, dated], // in the block, no calendar day
    [{ block: 1, text: "30/10/2026" }, dated], // only inside a longer figure
  ] as const) {
    const kept: BillReadRecord[] = [];
    await readPdf(reading({ billDate }), page, kept);
    expect(kept.map((k) => k.billDate), JSON.stringify(billDate)).toEqual([null]);
  }
});

it("DOC8 a document Sarvam Vision read only in part is refused as partly read: nothing recorded, no reason call", async () => {
  const kept: BillReadRecord[] = [];
  const allowed: string[] = [];
  const replies = docReplies();
  replies[2] = json(200, { job_id: "job_1", status: "Partially_Completed", usage: {} });
  const { f, calls } = queueFetch(...replies);
  const r = await readBill(PDF, { port: billPort([], kept, allowed), deps: { ...live(), fetch: f }, supplierId: SUPPLIER });
  expect(r).toEqual({ kind: "refused", why: "partly_read" });
  expect([kept, allowed, calls.length]).toEqual([[], ["vision"], 4]);
});

it("DOC9 the job's POST is sent once, never retried; a result of more pages than Sarvam Vision's cap is refused", async () => {
  const busy = queueFetch(json(500, { error: "busy" }));
  await expect(readDocument(PDF, "application/pdf", "en-IN", { ...live(), fetch: busy.f })).rejects.toThrow("500");
  expect(busy.calls.map((c) => c.init?.method)).toEqual(["POST"]);
  const eleven = Array.from({ length: MAX_PAGES + 1 }, (_, i) => ({ page_number: i + 1, content: JSON.stringify(PAGE) }));
  const replies = docReplies();
  replies[3] = json(200, { job_id: "job_1", status: "completed", documents: [{ pages: eleven }] });
  const many = queueFetch(...replies);
  await expect(readDocument(PDF, "application/pdf", "en-IN", { ...live(), fetch: many.f })).rejects.toThrow("too many pages");
});

it("DOC10 a PDF with no Sarvam key fails by name (no_key) before any call is counted or made", async () => {
  const { SARVAM_API_KEY: _s, ...noKey } = keyed;
  const allowed: string[] = [];
  const { f, calls } = queueFetch();
  const r = await readBill(PDF, { port: billPort([], [], allowed), deps: { ...live(noKey), fetch: f }, supplierId: SUPPLIER });
  expect([r, allowed, calls]).toEqual([{ kind: "refused", why: "no_key" }, [], []]);
});

it("SPEAK9 a cut never falls inside a figure: not at a decimal point at the limit, nor inside digits or a placeholder", () => {
  // "₹8." ends exactly at the limit, "50" after it: no sentence end there; the cut is at the space before the figure.
  const straddle = `${"x".repeat(MAX_SPEAK_CHARS - 4)} ₹8.50 left.`;
  expect(straddle[MAX_SPEAK_CHARS - 1]).toBe(".");
  expect(speakPieces(straddle)).toEqual(["x".repeat(MAX_SPEAK_CHARS - 4), "₹8.50 left."]);
  // No space or sentence end in reach: the hard cut moves back off the digits, and out of a placeholder.
  expect(speakPieces(`${"x".repeat(MAX_SPEAK_CHARS - 2)}1,23,456`)).toEqual(["x".repeat(MAX_SPEAK_CHARS - 2), "1,23,456"]);
  expect(speakPieces(`${"x".repeat(MAX_SPEAK_CHARS - 3)}⟦12⟧y`)).toEqual(["x".repeat(MAX_SPEAK_CHARS - 3), "⟦12⟧y"]);
});
