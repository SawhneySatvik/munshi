// The meta edition without Meta's key (D-077): its allow-list offers the paytm edition's providers behind Meta's own
// models, so a run's chain (core's modelFor, then metaFirst) and a flow with no chain (keyedBinding) both reach a
// provider whose key is set. With every key set, Meta answers every role; segment has no other adapter, so the shelf
// count degrades to "model_error" without a call. Fake fetches only, no network.
import type { Cell } from "@munshi/core/read";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITION_ALIASES, editionAllowList, metaFirst } from "../src/config.ts";
import { aliasBinding, MODEL_ALIASES } from "../src/models.ts";
import { onModelNotice } from "../src/notice.ts";
import type { AgentPort, EvidencePort, TraceEvent } from "../src/port.ts";
import { resolveBinding } from "../src/providers/client.ts";
import { generate } from "../src/providers/generate.ts";
import { segment } from "../src/providers/meta-sam.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { ROLES, type Role } from "../src/providers/types.ts";
import { ask } from "../src/run.ts";
import { countShelf } from "../src/shelf.ts";
import { env, json, noSleep, queueFetch, responsesBody, wavBytes } from "./helpers.ts";

const every = {
  ...env,
  GEMINI_API_KEY: "gm-test-SECRET-0123456789",
  CLAUDE_API_KEY: "ck-test-SECRET-0123456789",
  OPENAI_API_KEY: "ok-test-SECRET-0123456789",
  OPENROUTER_API_KEY: "or-test-SECRET-0123456789",
  NVIDIA_API_KEY: "nv-test-SECRET-0123456789",
  SARVAM_API_KEY: "sv-test-SECRET-0123456789",
} as NodeJS.ProcessEnv;
// No Meta key, and no Baseten key either: spark-open (Meta's open model on Baseten) would rightly keep answering narrate.
const { META_MODEL_API_KEY: _m, BASETEN_API_KEY: _b, ...noMeta } = every;
const live = (e: NodeJS.ProcessEnv) => ({ env: e, mode: "live", sleep: noSleep, edition: "meta" }) as const;

const GEMINI_HOST = "generativelanguage.googleapis.com";
const hosts = (calls: { url: string }[]) => calls.map((c) => new URL(c.url).host);

// Core's modelFor over the meta demo allow-list, with no pick by the shop: the edition's default, then every other alias
// allowed for the role, by name (its `order by alias`).
const modelFor = (role: Role) => {
  const allowed = editionAllowList("meta").filter((p) => p.role === role).map((p) => p.alias).sort();
  return [...new Set([EDITION_ALIASES.meta?.[role], ...allowed])].filter((a): a is string => typeof a === "string" && allowed.includes(a));
};

const meta = (text: string) => json(200, responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] }));
const chat = (content: string) => json(200, { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
const busy = () => json(429, { error: { message: "slow down" } });

const askPort = (events: TraceEvent[], allowed: string[]): AgentPort => ({
  async read() {
    throw new Error("no reads in this run");
  },
  async resolve() {
    return null;
  },
  async propose() {
    throw new Error("no drafts in this run");
  },
  async finding() {
    return null;
  },
  trace(e) {
    events.push(e);
  },
  async allow(role) {
    allowed.push(role);
    return true;
  },
  async models(_agent, role) {
    return modelFor(role);
  },
});
const modelLabels = (events: TraceEvent[]) => events.filter((e) => e.kind === "model").map((e) => e.label);

// Model notices (names only) go to the sink the app hands in; here, a mock.
let warn: ReturnType<typeof vi.fn<(event: string, fields: string) => void>>;
let restore: () => void;
beforeEach(() => {
  warn = vi.fn<(event: string, fields: string) => void>();
  restore = onModelNotice((event, fields) => warn(event, JSON.stringify(fields)));
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

describe("the meta edition with every key set", () => {
  it("METAFB1 every role resolves to its Meta alias, chain or none; Ask's calls all go to Meta's hosts", async () => {
    // Speak is the one exception: Meta has no text-to-speech model, so Sarvam's Bulbul is the meta edition's own default.
    for (const role of ROLES.filter((r) => r !== "speak")) {
      const alias = EDITION_ALIASES.meta?.[role] as string;
      const b = aliasBinding(alias, role);
      expect(["meta", "baseten"], role).toContain(b?.provider);
      expect(resolveBinding(role, live(every)), role).toEqual({ provider: b?.provider, model: b?.model });
    }
    expect(resolveBinding("speak", live(every))).toEqual({ provider: "sarvam", model: "bulbul:v3" });
    for (const role of ["router", "reason", "vision", "narrate"] as const) expect(metaFirst("meta", modelFor(role))[0], role).toBe(EDITION_ALIASES.meta?.[role]);

    const events: TraceEvent[] = [];
    const { f, calls } = queueFetch(meta('{"desk":"stock"}'), meta("Nothing to read."), chat('{"segments":[]}'));
    await ask("What should I reorder?", { port: askPort(events, []), asOf: "2026-11-02", deps: { ...live(every), fetch: f } });
    expect(modelLabels(events)).toEqual(["router,muse-spark", "reason,muse-spark", "narrate,spark-open"]);
    expect(hosts(calls)).toEqual(["api.meta.ai", "api.meta.ai", "inference.baseten.co"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("METAFB2 Meta's own models stay first: Baseten busy, narrate falls back to Meta's API, not to another provider", async () => {
    expect(metaFirst("meta", modelFor("narrate")).slice(0, 3)).toEqual(["spark-open", "muse-spark", "gemini-3.1-lite"]);
    expect(metaFirst("paytm", ["gemini-flash", "haiku-4-5", "muse-spark"])).toEqual(["gemini-flash", "haiku-4-5", "muse-spark"]); // other editions untouched
    const events: TraceEvent[] = [];
    const { f, calls } = queueFetch(meta('{"desk":"stock"}'), meta("Nothing to read."), busy(), busy(), busy(), busy(), meta('{"segments":[]}'));
    await ask("What should I reorder?", { port: askPort(events, []), asOf: "2026-11-02", deps: { ...live(every), fetch: f } });
    expect(modelLabels(events)).toEqual(["router,muse-spark", "reason,muse-spark", "narrate,spark-open,fallback,muse-spark"]);
    expect(hosts(calls).at(-1)).toBe("api.meta.ai");
  });
});

describe("the meta edition with no Meta key", () => {
  it("METAFB3 a run's chain moves past Meta to an allowed alias whose key is set, for router, reason, vision and narrate", async () => {
    const events: TraceEvent[] = [];
    const allowed: string[] = [];
    const { f, calls } = queueFetch(chat('{"desk":"stock"}'), chat("Nothing to read."), chat('{"segments":[]}'));
    const reply = await ask("What should I reorder?", { port: askPort(events, allowed), asOf: "2026-11-02", deps: { ...live(noMeta), fetch: f } });
    expect(reply).toMatchObject({ kind: "abstain", missing: ["no_answer"] });
    expect(modelLabels(events)).toEqual([
      "router,muse-spark,fallback,gemini-3.1-lite",
      "reason,muse-spark,fallback,gemini-3.1-lite",
      "narrate,spark-open,fallback,muse-spark,fallback,gemini-3.1-lite",
    ]);
    expect(hosts(calls)).toEqual([GEMINI_HOST, GEMINI_HOST, GEMINI_HOST]);
    expect(allowed).toEqual(["router", "reason", "narrate"]); // a skipped binding made no call: one allowance each

    const vision = queueFetch(chat('{"products":[]}'));
    const chain = async () => metaFirst("meta", modelFor("vision")).flatMap((a) => aliasBinding(a, "vision") ?? []);
    const r = await generate({ role: "vision", messages: [{ role: "user", content: "the shelf", imageUrl: "data:image/png;base64,iVBORw0KGgo=" }] }, { ...live(noMeta), fetch: vision.f, chain });
    expect(r).toMatchObject({ provider: "gemini", alias: "gemini-3.1-lite", tried: ["muse-spark", "gemini-3.1-lite"] });
    expect(hosts(vision.calls)).toEqual([GEMINI_HOST]);
    const said = warn.mock.calls.flat().join(" ");
    expect(said).toMatch(/model\.key_\w+ .*META_MODEL_API_KEY/);
    for (const v of Object.values(every)) if (v?.includes("SECRET")) expect(said).not.toContain(v);
  });

  it("METAFB4 a flow with no chain takes the edition's next allowed alias with a key; voice falls back to saaras-v4", async () => {
    for (const role of ["router", "reason", "vision", "narrate"] as const) {
      const b = resolveBinding(role, live(noMeta));
      expect(b, role).toEqual({ provider: "gemini", model: MODEL_ALIASES["gemini-flash"]?.model });
      expect(editionAllowList("meta").some((p) => p.role === role && p.alias === "gemini-flash"), role).toBe(true);
    }
    // Recorded mode keys fixtures by the edition's binding: no key is needed there, and nothing moves. Nor on paytm.
    expect(resolveBinding("reason", { env: {}, mode: "recorded", edition: "meta" })).toEqual({ provider: "meta", model: "muse-spark-1.3" });
    const { GEMINI_API_KEY: _g, ...noGemini } = every;
    expect(resolveBinding("reason", { ...live(noGemini), edition: "paytm" })).toEqual({ provider: "gemini", model: "gemini-3.5-flash" });

    const { f, calls } = queueFetch(json(200, { request_id: "r1", transcript: "दो किलो चीनी", language_code: "hi-IN" }));
    const t = await transcribe({ wav: wavBytes(), language: "Hindi" }, { ...live(noMeta), fetch: f });
    expect(t).toMatchObject({ provider: "sarvam", model: "saaras:v4", text: "दो किलो चीनी" });
    expect(hosts(calls)).toEqual(["api.sarvam.ai"]);
    const { SARVAM_API_KEY: _s, ...noVoice } = noMeta;
    await expect(transcribe({ wav: wavBytes() }, { ...live(noVoice), fetch: queueFetch().f })).rejects.toMatchObject({ code: "no_key" });
  });

  it("METAFB5 segment has no other adapter: the shelf count reads the photo on Gemini and marks the item uncounted, no crash, no call to Meta", async () => {
    const nothing = queueFetch();
    await expect(segment({ imageUrl: "data:image/png;base64,AAAA", prompt: { phrase: "cup" } }, { ...live(noMeta), fetch: nothing.f })).rejects.toMatchObject({ code: "no_key" });
    expect(nothing.calls).toEqual([]);

    const events: TraceEvent[] = [];
    const counted: unknown[] = [];
    const row: Record<string, Cell> = { item_id: { kind: "text", txt: "it-1" }, item: { kind: "text", txt: "Glucose biscuits" }, on_hand: { kind: "quantity", num: "24000", unit: "pack" } };
    const port: EvidencePort = {
      ...askPort(events, []),
      async read(name) {
        if (name !== "items.list") throw new Error(`unexpected read ${name}`);
        return { snapshotId: "00000000-0000-4000-8000-000000000001", rows: [row] };
      },
      async recordCount(c) {
        counted.push(c);
        return "count-1";
      },
      async recordBill() {
        throw new Error("no bills here");
      },
    };
    const { f, calls } = queueFetch(chat('{"products":[{"item":"item:1","phrase":"yellow biscuit packet"}]}'));
    const photo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = await countShelf(photo, { port, deps: { ...live(noMeta), fetch: f } });
    // The segment call fails by name before it is counted (W2-C fix cycle: the key is checked before allow).
    expect(r).toEqual({ kind: "counted", counts: [], uncounted: [{ itemId: "it-1", why: "no_key" }], unrecognised: [] });
    expect(hosts(calls)).toEqual([GEMINI_HOST]);
    expect(counted).toEqual([]);
    expect(modelLabels(events)).toEqual(["vision"]);
  });
});
