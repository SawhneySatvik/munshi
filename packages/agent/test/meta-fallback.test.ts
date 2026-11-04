// Meta's models are the default; without Meta's key the allow-list offers Gemini next, then the other providers, so a
// run's chain (core's modelFor, then fallbackOrder) and a flow with no chain (keyedBinding) both reach a provider whose
// key is set. With every key set, Meta answers every role; segment has no other adapter, so the shelf count marks the
// item uncounted without a call. Fake fetches only, no network.
import type { Cell } from "@munshi/core/read";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aliasBinding, allowList, DEFAULT_ALIASES, fallbackOrder, generate, MODEL_ALIASES, onModelNotice, resolveBinding, type Role, ROLES, segment, transcribe } from "@munshi/ai";
import type { AgentPort, EvidencePort, TraceEvent } from "../src/port.ts";
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
// No Meta key, and no key for a host of Meta's open model either: Baseten or OpenRouter would rightly keep answering narrate.
const { META_MODEL_API_KEY: _m, BASETEN_API_KEY: _b, OPENROUTER_API_KEY: _o, ...noMeta } = every;
const live = (e: NodeJS.ProcessEnv) => ({ env: e, mode: "live", sleep: noSleep }) as const;

const GEMINI_HOST = "generativelanguage.googleapis.com";
const hosts = (calls: { url: string }[]) => calls.map((c) => new URL(c.url).host);

// Core's modelFor over the demo allow-list, with no pick by the shop: the default, then every other alias allowed for the
// role, by name (its `order by alias`).
const modelFor = (role: Role) => {
  const allowed = allowList().filter((p) => p.role === role).map((p) => p.alias).sort();
  return [...new Set([DEFAULT_ALIASES[role], ...allowed])].filter((a) => allowed.includes(a));
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

describe("with every key set", () => {
  it("every role resolves to its Meta alias, chain or none; Ask's calls all go to Meta's hosts", async () => {
    // Speak is the one exception: Meta has no text-to-speech model, so Sarvam's Bulbul is the default.
    for (const role of ROLES.filter((r) => r !== "speak")) {
      const alias = DEFAULT_ALIASES[role];
      const b = aliasBinding(alias, role);
      expect(["meta", "baseten"], role).toContain(b?.provider);
      expect(resolveBinding(role, live(every)), role).toEqual({ provider: b?.provider, model: b?.model });
    }
    expect(resolveBinding("speak", live(every))).toEqual({ provider: "sarvam", model: "bulbul:v3" });
    for (const role of ["router", "reason", "vision", "narrate"] as const) expect(fallbackOrder(modelFor(role), role)[0], role).toBe(DEFAULT_ALIASES[role]);

    const events: TraceEvent[] = [];
    const { f, calls } = queueFetch(meta('{"desk":"stock"}'), meta("Nothing to read."), chat('{"segments":[]}'));
    await ask("What should I reorder?", { port: askPort(events, []), asOf: "2026-11-02", deps: { ...live(every), fetch: f } });
    expect(modelLabels(events)).toEqual(["router,muse-spark", "reason,muse-spark", "narrate,spark-open"]);
    expect(hosts(calls)).toEqual(["api.meta.ai", "api.meta.ai", "inference.baseten.co"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("Meta's own models stay first: Baseten busy, narrate stays on the open model through OpenRouter, then Meta's API", async () => {
    expect(fallbackOrder(modelFor("narrate"), "narrate").slice(0, 4)).toEqual(["spark-open", "or-spark-open", "muse-spark", "gemini-flash"]);
    const events: TraceEvent[] = [];
    const { f, calls } = queueFetch(meta('{"desk":"stock"}'), meta("Nothing to read."), busy(), busy(), busy(), busy(), chat('{"segments":[]}'));
    await ask("What should I reorder?", { port: askPort(events, []), asOf: "2026-11-02", deps: { ...live(every), fetch: f } });
    expect(modelLabels(events)).toEqual(["router,muse-spark", "reason,muse-spark", "narrate,spark-open,fallback,or-spark-open"]);
    expect(hosts(calls).at(-1)).toBe("openrouter.ai");
  });
});

describe("with no Meta key", () => {
  it("a run's chain moves past Meta to an allowed alias whose key is set, for router, reason, vision and narrate", async () => {
    const events: TraceEvent[] = [];
    const allowed: string[] = [];
    const { f, calls } = queueFetch(chat('{"desk":"stock"}'), chat("Nothing to read."), chat('{"segments":[]}'));
    const reply = await ask("What should I reorder?", { port: askPort(events, allowed), asOf: "2026-11-02", deps: { ...live(noMeta), fetch: f } });
    expect(reply).toMatchObject({ kind: "abstain", missing: ["no_answer"] });
    expect(modelLabels(events)).toEqual([
      "router,muse-spark,fallback,gemini-flash",
      "reason,muse-spark,fallback,gemini-flash",
      "narrate,spark-open,fallback,or-spark-open,fallback,muse-spark,fallback,gemini-flash",
    ]);
    expect(hosts(calls)).toEqual([GEMINI_HOST, GEMINI_HOST, GEMINI_HOST]);
    expect(allowed).toEqual(["router", "reason", "narrate"]); // a skipped binding made no call: one allowance each

    const vision = queueFetch(chat('{"products":[]}'));
    const chain = async () => fallbackOrder(modelFor("vision"), "vision").flatMap((a) => aliasBinding(a, "vision") ?? []);
    const r = await generate({ role: "vision", messages: [{ role: "user", content: "the shelf", imageUrl: "data:image/png;base64,iVBORw0KGgo=" }] }, { ...live(noMeta), fetch: vision.f, chain });
    expect(r).toMatchObject({ provider: "gemini", alias: "gemini-flash", tried: ["muse-spark", "gemini-flash"] });
    expect(hosts(vision.calls)).toEqual([GEMINI_HOST]);
    const said = warn.mock.calls.flat().join(" ");
    expect(said).toMatch(/model\.key_\w+ .*META_MODEL_API_KEY/);
    for (const v of Object.values(every)) if (v?.includes("SECRET")) expect(said).not.toContain(v);
  });

  it("a flow with no chain takes the next allowed alias with a key, Gemini's; voice falls back to saaras-v4", async () => {
    for (const role of ["router", "reason", "vision", "narrate"] as const) {
      const b = resolveBinding(role, live(noMeta));
      expect(b, role).toEqual({ provider: "gemini", model: MODEL_ALIASES["gemini-flash"]?.model });
      expect(allowList().some((p) => p.role === role && p.alias === "gemini-flash"), role).toBe(true);
    }
    // Recorded mode keys fixtures by the default binding: no key is needed there, and nothing moves.
    expect(resolveBinding("reason", { env: {}, mode: "recorded" })).toEqual({ provider: "meta", model: "muse-spark-1.3" });

    const { f, calls } = queueFetch(json(200, { request_id: "r1", transcript: "दो किलो चीनी", language_code: "hi-IN" }));
    const t = await transcribe({ wav: wavBytes(), language: "Hindi" }, { ...live(noMeta), fetch: f });
    expect(t).toMatchObject({ provider: "sarvam", model: "saaras:v4", text: "दो किलो चीनी" });
    expect(hosts(calls)).toEqual(["api.sarvam.ai"]);
    const { SARVAM_API_KEY: _s, ...noVoice } = noMeta;
    await expect(transcribe({ wav: wavBytes() }, { ...live(noVoice), fetch: queueFetch().f })).rejects.toMatchObject({ code: "no_key" });
  });

  it("segment has no other adapter: the shelf count reads the photo on Gemini and marks the item uncounted, no crash, no call to Meta", async () => {
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
    // The segment call fails by name before it is counted: the key is checked before allow.
    expect(r).toEqual({ kind: "counted", counts: [], uncounted: [{ itemId: "it-1", why: "no_key" }], unrecognised: [] });
    expect(hosts(calls)).toEqual([GEMINI_HOST]);
    expect(counted).toEqual([]);
    expect(modelLabels(events)).toEqual(["vision"]);
  });
});

// The fallback order's tiers, as the test below reads them from each alias's provider.
const TEXT_ROLES = ["router", "reason", "vision", "narrate"] as const;
const RANK = { meta: 0, gemini: 1, other: 2 } as const;
const tierOf = (alias: string) => {
  const p = MODEL_ALIASES[alias]?.provider;
  return p === "meta" || p === "baseten" || alias === "or-spark-open" ? "meta" : p === "gemini" ? "gemini" : "other";
};
const inTierOrder = (aliases: string[]) => aliases.every((a, i) => i === 0 || RANK[tierOf(aliases[i - 1] as string)] <= RANK[tierOf(a)]);
const aliasOfBinding = (b: { provider: string; model: string }, role: Role) =>
  Object.entries(MODEL_ALIASES).find(([, m]) => m.provider === b.provider && m.model === b.model && m.roles.includes(role))?.[0] as string;

it("every text role falls back to Meta's own models first, then Gemini, then the other providers", async () => {
  // The pick, the shop's default and the build's default (spark-open for narrate) stay as given; after them a scrambled
  // list holds the order to the providers, not to the alphabet.
  expect(fallbackOrder(["haiku-4-5", "gpt-luna-6", "spark-open", "nemotron-super-vl", "gemini-3.1-lite", "or-glm-5.3-flash", "gemini-flash", "muse-spark"], "narrate")).toEqual([
    "haiku-4-5", "gpt-luna-6", "spark-open", "muse-spark", "gemini-flash", "gemini-3.1-lite", "nemotron-super-vl", "or-glm-5.3-flash",
  ]);
  for (const role of TEXT_ROLES) {
    const chain = modelFor(role);
    expect(tierOf(fallbackOrder(chain, role)[0] as string), role).toBe("meta");
    for (const given of [chain, [chain[0] as string, ...chain.slice(1).reverse()]]) {
      const order = fallbackOrder(given, role).slice(1);
      expect(inTierOrder(order), `${role}: ${order.join(" ")}`).toBe(true);
      expect(new Set(order.map(tierOf)), role).toEqual(new Set(role === "narrate" ? ["meta", "gemini", "other"] : ["gemini", "other"]));
      // Gemini's best model first, whatever order core gave them in.
      expect(order.filter((a) => tierOf(a) === "gemini"), role).toEqual(["gemini-flash", "gemini-flash-lite", "gemini-3.1-lite"]);
    }
    // A call with no chain, held to the demo shop's list, without Meta's or Baseten's key: Gemini's best.
    const one = queueFetch(chat("ok"));
    const answered = await generate({ role, messages: [{ role: "user", content: "hello" }] }, { ...live(noMeta), fetch: one.f, permitted: async () => chain });
    expect(answered, role).toMatchObject({ provider: "gemini", model: MODEL_ALIASES["gemini-flash"]?.model });
    // A flow with no chain, live, without Meta's key: Gemini's; without Gemini's either, another provider's.
    expect(resolveBinding(role, live(noMeta)).provider, role).toBe("gemini");
    const { GEMINI_API_KEY: _g, ...neither } = noMeta;
    expect(tierOf(aliasOfBinding(resolveBinding(role, live(neither)), role)), role).toBe("other");
  }

  // A call with no chain, held to the shop's list, with no Baseten key: Meta's open model through OpenRouter; with no
  // OpenRouter key either, Muse Spark on Meta's API, still before Gemini.
  const { BASETEN_API_KEY: _b, ...noBaseten } = every;
  const open = queueFetch(chat("Nothing to read."));
  const viaOpenRouter = await generate({ role: "narrate", messages: [{ role: "user", content: "hello" }] }, { ...live(noBaseten), fetch: open.f, permitted: async () => modelFor("narrate") });
  expect(viaOpenRouter).toMatchObject({ provider: "openrouter", model: "meta/muse-spark-open" });
  const { OPENROUTER_API_KEY: _o2, ...noHost } = noBaseten;
  const { f, calls } = queueFetch(meta("Nothing to read."));
  const r = await generate({ role: "narrate", messages: [{ role: "user", content: "hello" }] }, { ...live(noHost), fetch: f, permitted: async () => modelFor("narrate") });
  expect(r).toMatchObject({ provider: "meta", model: "muse-spark-1.3" });
  expect(hosts(calls)).toEqual(["api.meta.ai"]);
});

it("the owner's pick and the shop's default come before every tier: a failed pick falls to the shop's default, not to Meta or Gemini", async () => {
  // Core's chain for reason: the owner's pick (haiku-4-5, no Anthropic key here), the shop's default (gpt-luna-6, an
  // OpenAI model with its key set), the build's default, then the rest by name. Meta and Gemini both have keys.
  const list = [...new Set(["haiku-4-5", "gpt-luna-6", ...modelFor("reason")])];
  const { CLAUDE_API_KEY: _c, ...noPick } = every;
  const messages = [{ role: "user" as const, content: "hello" }];
  const OPENAI_HOST = "api.openai.com";

  // A call with no chain, held to the shop's list.
  const lone = queueFetch(meta("Nothing to read."));
  const r = await generate({ role: "reason", messages }, { ...live(noPick), fetch: lone.f, permitted: async () => list });
  expect(r).toMatchObject({ provider: "openai", model: "gpt-6-luna" });
  expect(hosts(lone.calls)).toEqual([OPENAI_HOST]);

  // A run's chain: the pick is skipped for its missing key without a call, and the shop's default answers.
  const run = queueFetch(meta("Nothing to read."));
  const chain = async () => fallbackOrder(list, "reason").flatMap((a) => aliasBinding(a, "reason") ?? []);
  const c = await generate({ role: "reason", messages }, { ...live(noPick), fetch: run.f, chain });
  expect(c).toMatchObject({ provider: "openai", alias: "gpt-luna-6", tried: ["haiku-4-5", "gpt-luna-6"] });
  expect(hosts(run.calls)).toEqual([OPENAI_HOST]);
});
