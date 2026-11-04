// Gemini's adapter on a fake fetch: the response schema it is sent leaves out what its endpoint refuses (zod's
// safe-integer bounds, a long maxItems), while other providers, the fixture key and the zod check are untouched; a
// failed call is told to operators by role, code and status.
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { aliasBinding } from "../src/models.ts";
import { onModelNotice } from "../src/notice.ts";
import { GEMINI_MAX_ITEMS, geminiSchema } from "../src/providers/gemini.ts";
import { generate, generateKeyed, jsonSchemaOf } from "../src/providers/generate.ts";
import { env, json, noSleep, queueFetch } from "./helpers.ts";

const keys = { ...env, GEMINI_API_KEY: "gm-test-SECRET-0123456789" } as NodeJS.ProcessEnv;
const live = { env: keys, mode: "live", sleep: noSleep } as const;
const binding = (alias: string, role: "reason" | "vision" | "narrate") => aliasBinding(alias, role) as NonNullable<ReturnType<typeof aliasBinding>>;
const bodyOf = (c: { init: RequestInit | undefined }) => JSON.parse(String(c.init?.body));
const chat = (content: string) =>
  json(200, { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } });

// The two shapes that 400'd live: narrate's (int refs under maxItems 12) and the bill's (60 lines of int boxes).
const Narrate = z.object({ segments: z.array(z.object({ text: z.string(), refs: z.array(z.object({ read: z.number().int().min(0), row: z.number().int().min(0), col: z.string() })).max(12) })).max(6) });
const Place = z.array(z.number().int()).length(4);
const Bill = z.object({ billNo: z.string().nullable(), lines: z.array(z.object({ text: z.string(), qtyAt: Place.nullable() })).max(60) });
const walk = (s: unknown, out: [string, unknown][] = []): [string, unknown][] => {
  if (!s || typeof s !== "object") return out;
  for (const [k, v] of Object.entries(s)) {
    out.push([k, v]);
    walk(v, out);
  }
  return out;
};
const SAFE = [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER];

describe("geminiSchema", () => {
  it("drops zod's safe-integer bounds and keeps every real one", () => {
    const sent = walk(geminiSchema(jsonSchemaOf({ name: "answer", zod: Narrate })));
    expect(sent.filter(([k, v]) => (k === "minimum" || k === "maximum") && SAFE.includes(v as number))).toEqual([]);
    expect(sent.filter(([k]) => k === "minimum").map(([, v]) => v)).toEqual([0, 0]);
    expect(sent.filter(([k]) => k === "maxItems").map(([, v]) => v)).toEqual([6, 12]);
    expect(sent.filter(([k]) => k === "additionalProperties")).toHaveLength(3);
  });

  it(`drops a maxItems over ${GEMINI_MAX_ITEMS} and keeps a box's length`, () => {
    const sent = walk(geminiSchema(jsonSchemaOf({ name: "bill", zod: Bill })));
    expect(sent.filter(([k]) => k === "maxItems").map(([, v]) => v)).toEqual([4]);
    expect(sent.filter(([k]) => k === "minItems").map(([, v]) => v)).toEqual([4]);
  });
});

describe("gemini over Chat Completions", () => {
  it("is sent the trimmed schema; the fixture key keeps the full one; the reply is still held to the full zod schema", async () => {
    const req = { role: "narrate" as const, messages: [{ role: "user" as const, content: "hi" }], schema: { name: "answer", zod: Narrate } };
    const ok = '{"segments":[{"text":"x","refs":[{"read":1,"row":0,"col":"total"}]}]}';
    const tooMany = JSON.stringify({ segments: Array.from({ length: 7 }, () => ({ text: "x", refs: [] })) });
    const { f, calls } = queueFetch(chat(ok), chat(tooMany));
    const d = { ...live, fetch: f, chain: async () => [binding("gemini-flash", "narrate")] };
    expect((await generate(req, d)).json).toEqual(JSON.parse(ok));
    expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    const sent = walk(bodyOf(calls[0] as { init: RequestInit | undefined }).response_format.json_schema.schema);
    expect(sent.filter(([, v]) => SAFE.includes(v as number))).toEqual([]);
    expect(walk(generateKeyed(req, { provider: "gemini", model: "gemini-3.5-flash" }).schema).filter(([, v]) => SAFE.includes(v as number))).toHaveLength(2);
    await expect(generate(req, d)).rejects.toMatchObject({ code: "off_schema" });
  });

  it("another Chat Completions provider is sent the schema as zod gives it", async () => {
    const { f, calls } = queueFetch(chat('{"segments":[]}'));
    await generate({ role: "narrate", messages: [{ role: "user", content: "hi" }], schema: { name: "answer", zod: Narrate } }, { ...live, fetch: f });
    expect(calls[0]?.url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(bodyOf(calls[0] as { init: RequestInit | undefined }).response_format.json_schema.schema).toEqual(jsonSchemaOf({ name: "answer", zod: Narrate }));
  });
});

describe("a 429 in a chain", () => {
  // Gemini's 429 body, as it arrives (an array), with its QuotaFailure and RetryInfo details.
  const quota = (quotaId: string, retryDelay: string) =>
    json(429, [{ error: { code: 429, message: "You exceeded your current quota", status: "RESOURCE_EXHAUSTED", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_requests", quotaId }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
    ] } }]);
  const chain = async () => [binding("gemini-flash", "reason"), binding("gemini-flash-lite", "reason")];
  const req = { role: "reason" as const, messages: [{ role: "user" as const, content: "hi" }] };

  it("a daily quota is not retried: the next alias answers at once", async () => {
    const { f, calls } = queueFetch(quota("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "78952s"), chat("ok"));
    const r = await generate(req, { ...live, fetch: f, chain });
    expect(r).toMatchObject({ alias: "gemini-flash-lite", tried: ["gemini-flash", "gemini-flash-lite"], text: "ok" });
    expect(calls.map((c) => bodyOf(c).model)).toEqual(["gemini-3.5-flash", "gemini-3.5-flash-lite"]);
  });

  it("a wait over a minute counts as daily; a per-minute 429 is retried as before", async () => {
    const long = queueFetch(quota("SomeOtherQuota", "120s"), chat("ok"));
    expect((await generate(req, { ...live, fetch: long.f, chain })).alias).toBe("gemini-flash-lite");
    expect(long.calls).toHaveLength(2);

    const minute = () => quota("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "12s");
    const { f, calls } = queueFetch(minute(), minute(), chat("ok"));
    const r = await generate(req, { ...live, fetch: f, chain });
    expect(r).toMatchObject({ alias: "gemini-flash", tried: ["gemini-flash"] });
    expect(calls).toHaveLength(3);
  });
});

describe("a failed call", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("a failed call is told to operators by role, code and status, never by its message", async () => {
    const told: string[] = [];
    restore = onModelNotice((event, fields) => told.push(`${event} ${JSON.stringify(fields)}`));
    const { f } = queueFetch(json(400, { error: { code: 400, message: "Request contains an invalid argument: tea x3", status: "INVALID_ARGUMENT" } }));
    await expect(generate({ role: "vision", messages: [{ role: "user", content: "tea x3" }] }, { ...live, fetch: f, chain: async () => [binding("gemini-flash", "vision")] })).rejects.toMatchObject({ status: 400 });
    expect(told).toEqual(['model.failed.vision {"code":"error","status":400}']);
  });

  it("a call cut off by the run's time budget is told as aborted", async () => {
    const told: string[] = [];
    restore = onModelNotice((event, fields) => told.push(`${event} ${JSON.stringify(fields)}`));
    const late = new AbortController();
    const { f } = queueFetch(() => {
      late.abort();
      throw new DOMException("This operation was aborted", "AbortError");
    });
    const req = { role: "reason" as const, messages: [{ role: "user" as const, content: "hi" }], signal: late.signal };
    await expect(generate(req, { ...live, fetch: f, chain: async () => [binding("gemini-flash", "reason")] })).rejects.toBeInstanceOf(Error);
    expect(told).toEqual(['model.failed.reason {"code":"aborted"}']);
  });
});
