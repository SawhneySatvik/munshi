// The paytm edition's adapters (D-075): each provider's request and reply mapping on a fake fetch, wire shapes from each
// provider's public docs (Anthropic Messages, OpenAI Responses, OpenAI-compatible chat, Sarvam speech-to-text); a
// missing key moves a live chain on; the new keys are redacted. Red-proofs: the lane report (t/providers).
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { aliasBinding } from "../src/models.ts";
import { onModelNotice } from "../src/notice.ts";
import { generate } from "../src/providers/generate.ts";
import { ModelError } from "../src/providers/redact.ts";
import { transcribe } from "../src/providers/transcribe.ts";
import { env, json, noSleep, queueFetch, responsesBody, wavBytes } from "./helpers.ts";

const keys = { ...env, CLAUDE_API_KEY: "ck-test-SECRET-0123456789", OPENAI_API_KEY: "ok-test-SECRET-0123456789", OPENROUTER_API_KEY: "or-test-SECRET-0123456789", NVIDIA_API_KEY: "nv-test-SECRET-0123456789", SARVAM_API_KEY: "sv-test-SECRET-0123456789" } as NodeJS.ProcessEnv;
const live = { env: keys, mode: "live", sleep: noSleep } as const;
const chainOf = (alias: string, role: "router" | "reason" | "vision" | "narrate" = "reason") => async () => [aliasBinding(alias, role) as NonNullable<ReturnType<typeof aliasBinding>>];
const Sale = { name: "sale", zod: z.object({ item: z.string(), qty: z.number() }) };
const tool = { name: "record_sale", description: "Record a sale", parameters: { type: "object", properties: { item: { type: "string" } } } };
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const bodyOf = (c: { init: RequestInit | undefined }) => JSON.parse(String(c.init?.body));

const claude = (content: unknown[]) => json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content, stop_reason: "end_turn", usage: { input_tokens: 21, output_tokens: 9 } });

describe("anthropic: the Messages API over fetch", () => {
  it("ANTH1 a schema is a forced tool; its input is the JSON answer; system and the image go where the API wants them", async () => {
    const { f, calls } = queueFetch(claude([{ type: "tool_use", id: "toolu_1", name: "sale", input: { item: "tea", qty: 3 } }]));
    const r = await generate(
      { role: "vision", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "The bill:", imageUrl: PNG }], schema: Sale },
      { ...live, fetch: f, chain: chainOf("haiku-5-5", "vision") },
    );
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", alias: "haiku-5-5", json: { item: "tea", qty: 3 }, toolCalls: [], usage: { inputTokens: 21, outputTokens: 9 } });
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    const h = new Headers(calls[0]?.init?.headers);
    expect([h.get("x-api-key"), h.get("anthropic-version"), h.get("authorization")]).toEqual([keys.CLAUDE_API_KEY, "2023-06-01", null]);
    const b = bodyOf(calls[0] as never);
    expect(b).toMatchObject({ model: "claude-haiku-5-5", system: "Be brief.", tool_choice: { type: "tool", name: "sale" } });
    expect(b.max_tokens).toBeGreaterThan(0);
    expect(b.messages).toEqual([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }, { type: "text", text: "The bill:" }] }]);
    expect(b.tools[0]).toMatchObject({ name: "sale", input_schema: { type: "object", required: ["item", "qty"] } });
  });

  it("ANTH2 a tool call maps to toolCalls with its input as arguments; no tool_choice without a schema", async () => {
    const { f, calls } = queueFetch(claude([{ type: "text", text: "Recording." }, { type: "tool_use", id: "toolu_2", name: "record_sale", input: { item: "tea" } }]));
    const r = await generate({ role: "reason", messages: [{ role: "user", content: "tea" }], tools: [tool] }, { ...live, fetch: f, chain: chainOf("haiku-4-5") });
    expect(r.toolCalls).toEqual([{ callId: "toolu_2", name: "record_sale", arguments: { item: "tea" } }]);
    expect(r.text).toBe("Recording.");
    const b = bodyOf(calls[0] as never);
    expect(b.tools).toEqual([{ name: "record_sale", description: "Record a sale", input_schema: tool.parameters }]);
    expect(b.tool_choice).toBeUndefined();
    expect(b.model).toBe("claude-haiku-4-5-20251001");
  });

  it("ANTH3 a 529 is retried then falls back; the role's own timeout is a timeout the chain moves past", async () => {
    const overloaded = () => json(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    const meta = json(200, responsesBody());
    const { f, calls } = queueFetch(overloaded(), overloaded(), overloaded(), overloaded(), meta);
    const chain = async () => [aliasBinding("haiku-5-5", "narrate"), aliasBinding("muse-spark", "narrate")] as NonNullable<ReturnType<typeof aliasBinding>>[];
    const r = await generate({ role: "narrate", messages: [{ role: "user", content: "hi" }] }, { ...live, fetch: f, chain });
    expect(r.tried).toEqual(["haiku-5-5", "muse-spark"]);
    expect(calls).toHaveLength(5);
    const slow = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as typeof fetch;
    await expect(generate({ role: "narrate", messages: [{ role: "user", content: "hi" }] }, { ...live, fetch: slow, chain: chainOf("haiku-5-5", "narrate") })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("openai, openrouter, nvidia, sarvam chat: the OpenAI wire formats", () => {
  it("OPENAI1 openai rides the Responses API with an input_image part and a json_schema format", async () => {
    const out = responsesBody({ model: "gpt-6-luna", output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"item":"tea","qty":3}', annotations: [] }] }] });
    const { f, calls } = queueFetch(json(200, out));
    const r = await generate({ role: "vision", messages: [{ role: "user", content: "read", imageUrl: PNG }], schema: Sale }, { ...live, fetch: f, chain: chainOf("gpt-luna-6", "vision") });
    expect(r).toMatchObject({ provider: "openai", model: "gpt-6-luna", json: { item: "tea", qty: 3 } });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(`Bearer ${keys.OPENAI_API_KEY}`);
    const b = bodyOf(calls[0] as never);
    expect(b.input[0].content[1]).toEqual({ type: "input_image", image_url: PNG, detail: "auto" });
    expect(b.text.format).toMatchObject({ type: "json_schema", name: "sale" });
  });

  it("CHAT1 openrouter, nvidia and sarvam post chat completions to their own hosts with their own key", async () => {
    const chat = (content: string) => json(200, { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
    for (const [alias, url, key] of [
      ["or-glm-5.3-flash", "https://openrouter.ai/api/v1/chat/completions", keys.OPENROUTER_API_KEY],
      ["nemotron-super-vl", "https://integrate.api.nvidia.com/v1/chat/completions", keys.NVIDIA_API_KEY],
      ["sarvam-105b", "https://api.sarvam.ai/v1/chat/completions", keys.SARVAM_API_KEY],
    ] as const) {
      const { f, calls } = queueFetch(chat('{"item":"tea","qty":3}'));
      const r = await generate({ role: "reason", messages: [{ role: "user", content: "tea" }], schema: Sale }, { ...live, fetch: f, chain: chainOf(alias) });
      expect(r.json, alias).toEqual({ item: "tea", qty: 3 });
      expect(calls[0]?.url, alias).toBe(url);
      expect(new Headers(calls[0]?.init?.headers).get("authorization"), alias).toBe(`Bearer ${key}`);
      expect(bodyOf(calls[0] as never).response_format.type, alias).toBe("json_schema");
    }
  });
});

describe("sarvam: speech-to-text", () => {
  it("SARVAM1 under paytm the voice role posts the WAV to Sarvam's speech-to-text with the language as a BCP-47 code", async () => {
    const { f, calls } = queueFetch(json(200, { request_id: "r1", transcript: "दो किलो चीनी", language_code: "hi-IN" }));
    const r = await transcribe({ wav: wavBytes(), language: "Hindi" }, { ...live, edition: "paytm", fetch: f });
    expect(r).toMatchObject({ provider: "sarvam", model: "saaras:v4", text: "दो किलो चीनी", language: "hi-IN" });
    expect(calls[0]?.url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(new Headers(calls[0]?.init?.headers).get("api-subscription-key")).toBe(keys.SARVAM_API_KEY);
    const form = calls[0]?.init?.body as FormData;
    expect([form.get("model"), form.get("mode"), form.get("language_code")]).toEqual(["saaras:v4", "transcribe", "hi-IN"]);
    expect((form.get("file") as Blob).size).toBe(wavBytes().length);
  });

  it("SARVAM2 a language with no code asks Sarvam to detect it (unknown); a reply without a transcript is refused", async () => {
    const { f, calls } = queueFetch(json(200, { request_id: "r2", transcript: "two kilo sugar", language_code: null }), json(200, { request_id: "r3" }));
    const r = await transcribe({ wav: wavBytes(), language: "Klingon" }, { ...live, edition: "paytm", fetch: f });
    expect(r.language).toBeNull();
    expect((calls[0]?.init?.body as FormData | undefined)?.get("language_code")).toBe("unknown");
    await expect(transcribe({ wav: wavBytes() }, { ...live, edition: "paytm", fetch: f })).rejects.toThrow(/no transcript/);
  });
});

describe("keys", () => {
  afterEach(() => vi.restoreAllMocks());

  it("NOKEY1 a live chain skips a binding whose key is unset, loudly and by name, and the next answers", async () => {
    const warn = vi.fn();
    const restore = onModelNotice((event, fields) => warn(event, JSON.stringify(fields)));
    const { CLAUDE_API_KEY: _drop, ...noClaude } = keys;
    const { f, calls } = queueFetch(json(200, responsesBody()));
    const chain = async () => [aliasBinding("haiku-5-5", "narrate"), aliasBinding("muse-spark", "narrate")] as NonNullable<ReturnType<typeof aliasBinding>>[];
    const again: string[] = [];
    const r = await generate({ role: "narrate", messages: [{ role: "user", content: "hi" }] }, { ...live, env: noClaude, fetch: f, chain, allowAgain: async (role) => { again.push(role); return true; } });
    expect(r).toMatchObject({ alias: "muse-spark", tried: ["haiku-5-5", "muse-spark"] });
    expect(again).toEqual([]); // the skipped binding made no call, so the caller's one allowance covers the answer
    expect(calls.map((c) => new URL(c.url).host)).toEqual(["api.meta.ai"]);
    restore();
    expect(warn.mock.calls.flat().join(" ")).toBe('model.key_skipped {"names":["CLAUDE_API_KEY"]}');
    expect(warn.mock.calls.flat().join(" ")).not.toContain(keys.META_MODEL_API_KEY as string);
  });

  it("REDACT1 the new providers' keys never reach an error message", () => {
    for (const name of ["CLAUDE_API_KEY", "OPENAI_API_KEY", "NVIDIA_API_KEY"]) {
      const e = new ModelError(`upstream echoed ${keys[name]}`, 401, undefined, keys);
      expect(e.message, name).not.toContain(keys[name] as string);
    }
  });
});
