import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixtureKey } from "../src/providers/fixtures.ts";
import { generate } from "../src/providers/generate.ts";
import { ModelError, redact } from "../src/providers/redact.ts";
import { env, json, KEY, noSleep, queueFetch, responsesBody, tmpFixtures } from "./helpers.ts";

const schema = { name: "Sale", zod: z.object({ item: z.string(), qty: z.number() }) };
const messages = [{ role: "user" as const, content: "tea x3" }];
const textBody = (text: string) =>
  responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] });

describe("generate (live path, fake fetch)", () => {
  it("posts to the meta Responses endpoint with the Bearer key, schema and normalised usage", async () => {
    const { f, calls } = queueFetch(json(200, textBody('{"item":"tea","qty":3}')));
    const r = await generate({ role: "reason", messages, schema }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(r.json).toEqual({ item: "tea", qty: 3 });
    expect(r).toMatchObject({ provider: "meta", model: "muse-spark-1.3", usage: { inputTokens: 11, outputTokens: 7 } });
    expect(calls[0]!.url).toBe("https://api.meta.ai/v1/responses");
    const headers = new Headers(calls[0]!.init!.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "Sale" });
    expect(body.text.format.schema.required).toEqual(["item", "qty"]);
  });

  it("sends a reasoning effort only when the request names one", async () => {
    const asked = async (effort?: "low") => {
      const { f, calls } = queueFetch(json(200, textBody('{"item":"tea","qty":3}')));
      await generate({ role: "reason", messages, schema, ...(effort ? { effort } : {}) }, { env, fetch: f, mode: "live", sleep: noSleep });
      return JSON.parse(String(calls[0]!.init!.body)).reasoning;
    };
    expect(await asked("low")).toEqual({ effort: "low" });
    expect(await asked()).toBeUndefined();
  });

  it("narrate goes to baseten over Chat Completions", async () => {
    const chat = { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "namaste" } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } };
    const { f, calls } = queueFetch(json(200, chat));
    const r = await generate({ role: "narrate", messages }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(calls[0]!.url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(r).toMatchObject({ text: "namaste", provider: "baseten", model: "meta-models/muse-spark-open-1026", usage: { inputTokens: 3, outputTokens: 1 } });
  });

  it("normalises tool calls", async () => {
    const body = responsesBody({ output: [{ type: "function_call", id: "fc", call_id: "call_9", name: "record_sale", arguments: '{"item":"tea","qty":3}', status: "completed" }] });
    const { f } = queueFetch(json(200, body));
    const r = await generate(
      { role: "reason", messages, tools: [{ name: "record_sale", description: "d", parameters: { type: "object" } }], schema },
      { env, fetch: f, mode: "live", sleep: noSleep },
    );
    expect(r.toolCalls).toEqual([{ callId: "call_9", name: "record_sale", arguments: { item: "tea", qty: 3 } }]);
  });

  it("a tool call's commentary (as Meta's live API sends it) is not taken for the schema answer", async () => {
    const body = responsesBody({
      output: [
        { type: "reasoning", id: "rs", summary: [], status: "completed" },
        { type: "message", id: "m", role: "assistant", phase: "commentary", status: "completed", content: [{ type: "output_text", text: "I'll record the sale of 3 tea packets.", annotations: [] }] },
        { type: "function_call", id: "fc", call_id: "call_9", name: "record_sale", arguments: '{"item":"tea","qty":3}', status: "completed" },
      ],
    });
    const { f } = queueFetch(json(200, body));
    const r = await generate(
      { role: "reason", messages, tools: [{ name: "record_sale", description: "d", parameters: { type: "object" } }], schema },
      { env, fetch: f, mode: "live", sleep: noSleep },
    );
    expect(r.text).toBe("");
    expect(r.toolCalls).toEqual([{ callId: "call_9", name: "record_sale", arguments: { item: "tea", qty: 3 } }]);
  });

  it("refuses schema-violating live output", async () => {
    const { f } = queueFetch(json(200, textBody('{"item":"tea","qty":"three"}')));
    await expect(generate({ role: "reason", messages, schema }, { env, fetch: f, mode: "live" })).rejects.toThrow(/failed schema "Sale"/);
  });
});

describe("retries", () => {
  it("retries 429 then 5xx and succeeds on the 4th attempt", async () => {
    const waits: number[] = [];
    const { f, calls } = queueFetch(json(429, { error: { message: "slow" } }), json(503, { error: { message: "down" } }), json(500, { error: { message: "oops" } }), json(200, textBody("ok")));
    const r = await generate({ role: "reason", messages }, { env, fetch: f, mode: "live", sleep: async (ms) => void waits.push(ms) });
    expect(r.text).toBe("ok");
    expect(calls).toHaveLength(4);
    expect(waits).toHaveLength(3);
    expect(waits[1]!).toBeGreaterThan(waits[0]!); // exponential
  });

  it("gives up after 3 retries (4 calls)", async () => {
    const bad = () => json(503, { error: { message: "down" } });
    const { f, calls } = queueFetch(bad, bad, bad, bad);
    await expect(generate({ role: "reason", messages }, { env, fetch: f, mode: "live", sleep: noSleep })).rejects.toBeInstanceOf(ModelError);
    expect(calls).toHaveLength(4);
  });

  it("does not retry a 400 or model_not_found, and surfaces the code", async () => {
    const { f, calls } = queueFetch(json(404, { error: { message: "no access", code: "model_not_found", type: "invalid_request_error" } }));
    const err = await generate({ role: "reason", messages }, { env, fetch: f, mode: "live", sleep: noSleep }).catch((e) => e);
    expect(calls).toHaveLength(1);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("model_not_found");
  });
});

describe("key redaction", () => {
  it("a key planted in an upstream error body never reaches the thrown error", async () => {
    const { f } = queueFetch(json(401, { error: { message: `bad credentials ${KEY} for Bearer ${KEY}` } }));
    const err = await generate({ role: "reason", messages }, { env, fetch: f, mode: "live", sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(String(err.message)).not.toContain(KEY);
    expect(String(err.message)).toContain("[redacted]");
  });

  it("redact() strips env keys and unknown Bearer tokens", () => {
    expect(redact(`x ${KEY} y`, env)).toBe("x [redacted] y");
    expect(redact("Authorization: Bearer abcdefgh12345678", {})).toBe("Authorization: Bearer [redacted]");
  });

  it("a missing key error names the variable, not a value", async () => {
    await expect(generate({ role: "reason", messages }, { env: {}, mode: "live" })).rejects.toThrow(/META_MODEL_API_KEY is not set/);
  });
});

describe("record / replay", () => {
  const dir = tmpFixtures();
  const req = { role: "reason" as const, messages, schema };
  const keyed = () => ({ kind: "generate", provider: "meta", model: "muse-spark-1.3", messages, tools: undefined, schema: { name: "Sale", json: (({ $schema: _s, ...r }) => r)(z.toJSONSchema(schema.zod) as Record<string, unknown>) } });
  const raw = (text: string) => ({ provider: "meta", model: "muse-spark-1.3", latencyMs: 1, text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } });

  it("key is stable regardless of object key order", () => {
    expect(fixtureKey({ a: 1, b: { c: 2, d: 3 } })).toBe(fixtureKey({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fixtureKey({ a: 1 })).not.toBe(fixtureKey({ a: 2 }));
  });

  it("recorded mode with no fixture fails", async () => {
    await expect(generate(req, { env, mode: "recorded", fixturesDir: dir })).rejects.toThrow(/no recorded fixture/);
  });

  it("record writes a fixture that recorded mode then replays offline", async () => {
    const d = tmpFixtures();
    const { f } = queueFetch(json(200, textBody('{"item":"tea","qty":3}')));
    await generate(req, { env, fetch: f, mode: "record", fixturesDir: d });
    const replay = await generate(req, { env, mode: "recorded", fixturesDir: d, fetch: (() => { throw new Error("network used"); }) as never });
    expect(replay.json).toEqual({ item: "tea", qty: 3 });
  });

  it("a hand-written valid fixture replays; a schema-violating one is refused", async () => {
    const d = tmpFixtures();
    const file = join(d, `${fixtureKey(keyed())}.json`);
    writeFileSync(file, JSON.stringify(raw('{"item":"tea","qty":3}')));
    expect((await generate(req, { env, mode: "recorded", fixturesDir: d })).json).toEqual({ item: "tea", qty: 3 });
    writeFileSync(file, JSON.stringify(raw('{"item":"tea","qty":"3"}')));
    await expect(generate(req, { env, mode: "recorded", fixturesDir: d })).rejects.toThrow(/failed schema "Sale"/);
    writeFileSync(file, JSON.stringify(raw("not json")));
    await expect(generate(req, { env, mode: "recorded", fixturesDir: d })).rejects.toThrow(/not valid JSON/);
  });
});
