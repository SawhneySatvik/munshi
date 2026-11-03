import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixtureKey } from "../src/providers/fixtures.ts";
import { generate } from "../src/providers/generate.ts";
import { ModelError } from "../src/providers/redact.ts";
import { promptText, segment } from "../src/providers/meta-sam.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { env, json, noSleep, queueFetch, responsesBody, tmpFixtures, wavBytes } from "./helpers.ts";

const messages = [{ role: "user" as const, content: "tea" }];
const textBody = (text: string) =>
  responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }] });

describe("fix 1: structured output carries no strict flag (docs: always schema-constrained)", () => {
  const schema = { name: "S", zod: z.object({ item: z.string(), note: z.string().optional() }) };
  it("responses body has no strict on text.format", async () => {
    const { f, calls } = queueFetch(json(200, textBody('{"item":"tea"}')));
    await generate({ role: "reason", messages, schema }, { env, fetch: f, mode: "live", sleep: noSleep });
    const fmt = JSON.parse(String(calls[0]!.init!.body)).text.format;
    expect(fmt.schema.required).toEqual(["item"]); // optional stays optional, so strict would 400
    expect(fmt.strict).not.toBe(true);
  });
  it("chat body has no strict on json_schema", async () => {
    const { f, calls } = queueFetch(json(200, { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"item":"tea"}' } }] }));
    await generate({ role: "narrate", messages, schema }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(JSON.parse(String(calls[0]!.init!.body)).response_format.json_schema.strict).not.toBe(true);
  });
});

describe("fix 2: with no key for any model of the role, segment and voice fail by name and call nothing", () => {
  const noMeta = { env: { ...env, META_MODEL_API_KEY: undefined }, mode: "live", sleep: noSleep } as const;
  it("segment throws and calls nothing", async () => {
    const { f, calls } = queueFetch();
    await expect(segment({ imageUrl: "https://x/y.png", prompt: { phrase: "cup" } }, { ...noMeta, fetch: f })).rejects.toThrow(/META_MODEL_API_KEY is not set/);
    expect(calls).toHaveLength(0);
  });
  it("transcribe throws and calls nothing", async () => {
    const { f, calls } = queueFetch();
    await expect(transcribe({ wav: wavBytes() }, { ...noMeta, fetch: f })).rejects.toThrow(/META_MODEL_API_KEY is not set/);
    expect(calls).toHaveLength(0);
  });
});

describe("fix 3: malformed fixture", () => {
  it("fixture missing toolCalls throws a ModelError", async () => {
    const d = tmpFixtures();
    const keyed = { kind: "generate", provider: "meta", model: "muse-spark-1.3", messages, tools: undefined, schema: undefined };
    writeFileSync(join(d, `${fixtureKey(keyed)}.json`), JSON.stringify({ provider: "meta", model: "muse-spark-1.3", latencyMs: 1, text: "hi", usage: { inputTokens: 1, outputTokens: 1 } }));
    const err = await generate({ role: "reason", messages }, { env, mode: "recorded", fixturesDir: d }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect(err.message).toMatch(/malformed fixture/);
  });
});

describe("fix 4: SAM confidence and 'and'", () => {
  it("rejects ' and ' phrases", () => {
    expect(() => promptText({ phrase: "bus and bicycle" })).toThrow(/one noun phrase/);
    expect(promptText({ phrase: "sandy brand" })).toBe("sandy brand");
  });
  it("sends metadata.include_confidence \"true\"", async () => {
    const { f, calls } = queueFetch(json(200, responsesBody({ output: [] })));
    await segment({ imageUrl: "https://x/y.png", prompt: { phrase: "cup" } }, { env, fetch: f, mode: "live", sleep: noSleep });
    expect(JSON.parse(String(calls[0]!.init!.body)).metadata).toEqual({ include_confidence: "true" });
  });
});

describe("fix 5: ModelError redacts with the injected env", () => {
  it("constructor redacts a key present only in the injected env", () => {
    const e = new ModelError("upstream said key-only-injected-9999", undefined, undefined, { META_MODEL_API_KEY: "key-only-injected-9999" });
    expect(e.message).not.toContain("key-only-injected-9999");
  });
});
