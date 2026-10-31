// P-5's agent half: the edition's roles named by alias (the bindings, and so every fixture key, exactly as before), the
// live fallback chain in generate() (a 429 on the first binding moves to the next, each further attempt allowed again;
// recorded mode never falls back), and a run's trace naming the alias that answered and the one it fell back from.
import { describe, expect, it } from "vitest";
import { EDITION_ALIASES, EDITION_ROLES } from "../src/config.ts";
import { aliasBinding, KNOWN_ALIASES, MODEL_ALIASES } from "../src/models.ts";
import type { AgentPort, TraceEvent } from "../src/port.ts";
import type { ChainBinding } from "../src/providers/client.ts";
import { generate } from "../src/providers/generate.ts";
import { ROLES } from "../src/providers/types.ts";
import { ask, TRACE_LABELS } from "../src/run.ts";
import { env, json, noSleep, queueFetch, responsesBody, tmpFixtures } from "./helpers.ts";

const messages = [{ role: "user" as const, content: "hello" }];
const meta = (text: string) => json(200, responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] }));
const busy = () => json(429, { error: { message: "slow down" } });
const BASETEN: ChainBinding = { provider: "baseten", model: "meta-models/muse-spark-open-1026", alias: "spark-open" };
const META: ChainBinding = { provider: "meta", model: "muse-spark-1.3", alias: "muse-spark" };

describe("aliases", () => {
  it("the meta edition's roles resolve through its aliases to the same provider and model as before", () => {
    const aliases = EDITION_ALIASES.meta as Record<string, string>;
    for (const role of ROLES) {
      const b = aliasBinding(aliases[role] as string, role);
      expect(b, role).not.toBeNull();
      expect(EDITION_ROLES.meta[role]).toEqual({ provider: b?.provider, model: b?.model });
    }
    expect(EDITION_ROLES.meta.narrate).toEqual({ provider: "baseten", model: "meta-models/muse-spark-open-1026" });
  });

  it("every alias fits the schema's alias check, is a fixed trace word, and serves only its listed roles", () => {
    expect(Object.keys(MODEL_ALIASES).length).toBe(4);
    for (const [alias, roles] of Object.entries(KNOWN_ALIASES)) {
      expect(alias).toMatch(/^[a-z0-9][a-z0-9.-]{1,31}$/);
      expect(TRACE_LABELS.has(alias), alias).toBe(true);
      for (const role of ROLES) expect(aliasBinding(alias, role) !== null, `${alias} ${role}`).toBe(roles.includes(role));
    }
    expect(aliasBinding("toString", "reason")).toBeNull();
    expect(aliasBinding("gpt-unknown", "reason")).toBeNull();
  });
});

it("FALLBACK1 a 429 on the first binding (after its retries) moves to the second, which answers, allowed again first", async () => {
  const { f, calls } = queueFetch(busy(), busy(), busy(), busy(), meta("namaste"));
  const allowed: string[] = [];
  const r = await generate(
    { role: "narrate", messages },
    { env, fetch: f, mode: "live", sleep: noSleep, chain: async () => [BASETEN, META], allowAgain: async (role) => { allowed.push(role); return true; } },
  );
  expect(r).toMatchObject({ text: "namaste", provider: "meta", alias: "muse-spark", tried: ["spark-open", "muse-spark"] });
  expect(calls.map((c) => new URL(c.url).host)).toEqual([...Array(4).fill("inference.baseten.co"), "api.meta.ai"]);
  expect(allowed).toEqual(["narrate"]); // the first attempt is the caller's own allow
});

it("a refused second allowance stops the chain; a 400 never falls back; an empty chain is refused", async () => {
  const one = queueFetch(busy(), busy(), busy(), busy());
  await expect(
    generate({ role: "narrate", messages }, { env, fetch: one.f, mode: "live", sleep: noSleep, chain: async () => [BASETEN, META], allowAgain: async () => false }),
  ).rejects.toThrow(/calls today are spent/);
  expect(one.calls).toHaveLength(4);
  const bad = queueFetch(json(400, { error: { message: "bad request" } }));
  await expect(generate({ role: "narrate", messages }, { env, fetch: bad.f, mode: "live", sleep: noSleep, chain: async () => [BASETEN, META] })).rejects.toMatchObject({ status: 400 });
  expect(bad.calls).toHaveLength(1);
  await expect(generate({ role: "narrate", messages }, { env, mode: "live", chain: async () => [] })).rejects.toThrow(/no model is allowed/);
});

it("recorded mode never falls back: the first binding's missing fixture stays an error", async () => {
  const network = (() => {
    throw new Error("network used");
  }) as never;
  await expect(
    generate({ role: "narrate", messages }, { env, fetch: network, mode: "recorded", fixturesDir: tmpFixtures(), chain: async () => [BASETEN, META] }),
  ).rejects.toThrow(/no recorded fixture/);
});

const port = (events: TraceEvent[], allowed: string[]): AgentPort => ({
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
  // The shop's chain per role, as core's modelFor gives it: narrate on Baseten first, then Meta's own model.
  async models(agent, role) {
    expect(agent).toBe("ask");
    return role === "narrate" ? ["spark-open", "muse-spark"] : ["muse-spark", "gpt-unknown"];
  },
});

it("FALLBACK2 the trace names the alias that answered each call, and the one narrate fell back from", async () => {
  const events: TraceEvent[] = [];
  const allowed: string[] = [];
  const { f } = queueFetch(meta('{"desk":"stock"}'), meta("Nothing to read."), busy(), busy(), busy(), busy(), meta('{"segments":[]}'));
  const reply = await ask("What should I reorder?", { port: port(events, allowed), asOf: "2026-10-31", deps: { env, fetch: f, mode: "live", sleep: noSleep } });
  expect(reply).toMatchObject({ kind: "abstain", missing: ["no_answer"] });
  expect(events.filter((e) => e.kind === "model").map((e) => e.label)).toEqual(["router,muse-spark", "reason,muse-spark", "narrate,spark-open,fallback,muse-spark"]);
  expect(allowed).toEqual(["router", "reason", "narrate", "narrate"]);
  for (const e of events) for (const label of e.label.split(",")) expect(TRACE_LABELS.has(label), label).toBe(true);
});
