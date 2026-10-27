import { z } from "zod";
import { binding, parseEdition, USES_RESPONSES } from "../config.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, viaFixture } from "./fixtures.ts";
import { openaiClient, withRetry, type Deps } from "./client.ts";
import { ModelError } from "./redact.ts";
import type { GenerateRequest, GenerateResult, Message, ToolCall } from "./types.ts";

type Raw = Omit<GenerateResult, "json">;

function jsonSchemaOf(s: NonNullable<GenerateRequest["schema"]>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(s.zod) as Record<string, unknown>;
  return rest;
}

function parseArgs(raw: string | null | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ModelError("tool call arguments were not valid JSON");
  }
}

// Responses API shapes follow Meta's captured docs (tool-calling, structured-output); for other providers on this path: UNVERIFIED.
async function viaResponses(req: GenerateRequest, provider: Raw["provider"], model: string, d: Deps): Promise<Raw> {
  const client = openaiClient(provider, req.role, d);
  const input = req.messages.map((m: Message) =>
    m.imageUrl
      ? { type: "message" as const, role: m.role as "user", content: [{ type: "input_text" as const, text: m.content }, { type: "input_image" as const, image_url: m.imageUrl, detail: "auto" as const }] }
      : { type: "message" as const, role: m.role, content: m.content },
  );
  const t0 = Date.now();
  const r = await withRetry(
    () =>
      client.responses.create({
        model,
        input,
        ...(req.tools ? { tools: req.tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })) } : {}),
        ...(req.schema ? { text: { format: { type: "json_schema" as const, name: req.schema.name, schema: jsonSchemaOf(req.schema), strict: true } } } : {}),
      }),
    d,
  );
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of r.output) {
    if (item.type === "message") for (const c of item.content) if (c.type === "output_text") text += c.text;
    if (item.type === "function_call") toolCalls.push({ callId: item.call_id, name: item.name, arguments: parseArgs(item.arguments) });
  }
  return { provider, model, latencyMs: Date.now() - t0, text, toolCalls, usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 } };
}

// Chat Completions shapes follow Meta's captured docs for meta; for baseten/nebius/gemini/openrouter: UNVERIFIED (assumed OpenAI-standard).
async function viaChat(req: GenerateRequest, provider: Raw["provider"], model: string, d: Deps): Promise<Raw> {
  const client = openaiClient(provider, req.role, d);
  const messages = req.messages.map((m) =>
    m.imageUrl
      ? { role: "user" as const, content: [{ type: "text" as const, text: m.content }, { type: "image_url" as const, image_url: { url: m.imageUrl } }] }
      : { role: m.role, content: m.content },
  );
  const t0 = Date.now();
  const r = await withRetry(
    () =>
      client.chat.completions.create({
        model,
        messages,
        ...(req.tools ? { tools: req.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
        ...(req.schema ? { response_format: { type: "json_schema" as const, json_schema: { name: req.schema.name, schema: jsonSchemaOf(req.schema), strict: true } } } : {}),
      }),
    d,
  );
  const msg = r.choices[0]?.message;
  const toolCalls: ToolCall[] = [];
  for (const c of msg?.tool_calls ?? []) if (c.type === "function") toolCalls.push({ callId: c.id, name: c.function.name, arguments: parseArgs(c.function.arguments) });
  return { provider, model, latencyMs: Date.now() - t0, text: msg?.content ?? "", toolCalls, usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 } };
}

export async function generate(req: GenerateRequest, d: Deps = {}): Promise<GenerateResult> {
  const { provider, model } = binding(req.role, parseEdition(d.edition ?? (d.env ?? process.env)["MUNSHI_EDITION"]));
  const mode = parseMode(d.mode ?? (d.env ?? process.env)["MUNSHI_MODEL_MODE"]);
  const keyed = { kind: "generate", provider, model, messages: req.messages, tools: req.tools, schema: req.schema && { name: req.schema.name, json: jsonSchemaOf(req.schema) } };
  const raw = await viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, keyed, () =>
    (USES_RESPONSES.has(provider) ? viaResponses : viaChat)(req, provider, model, d),
  );
  // A pure tool-call turn has no text to validate; the tool arguments are the output.
  if (!req.schema || (raw.toolCalls.length > 0 && raw.text.trim() === "")) return raw;
  // Validated after replay too, so a bad fixture is refused exactly like a bad live answer.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    throw new ModelError("model output was not valid JSON");
  }
  const ok = req.schema.zod.safeParse(parsed);
  if (!ok.success) throw new ModelError(`model output failed schema "${req.schema.name}"`);
  return { ...raw, json: ok.data };
}
