import { z } from "zod";
import { USES_RESPONSES } from "../config.ts";
import { viaAnthropic } from "./anthropic.ts";
import { DEFAULT_FIXTURES_DIR, parseMode, viaFixture } from "./fixtures.ts";
import { aliasOf, onList, openaiClient, resolveBinding, told, withRetry, type Deps } from "./client.ts";
import { missingSetting, notice } from "../notice.ts";
import { ModelError } from "./redact.ts";
import { type GenerateRequest, type GenerateResult, type Message, type ToolCall, usageOf } from "./types.ts";

export type Raw = Omit<GenerateResult, "json">;

const RAW_SHAPE = z.object({
  provider: z.string(), model: z.string(), latencyMs: z.number(), text: z.string(),
  toolCalls: z.array(z.object({ callId: z.string(), name: z.string(), arguments: z.unknown() })),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable(),
}) as unknown as z.ZodType<Raw>;

// No `strict`: Meta's structured-output doc says output is always schema-constrained, and strict:true 400s unless every
// key is required with additionalProperties:false (meta-docs-structured-output.txt, "Enforce strict mode").
export function jsonSchemaOf(s: NonNullable<GenerateRequest["schema"]>): Record<string, unknown> {
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
        ...(req.schema ? { text: { format: { type: "json_schema" as const, name: req.schema.name, schema: jsonSchemaOf(req.schema) } } } : {}),
      }, { signal: req.signal }),
    d,
    req.signal,
  );
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of r.output) {
    if (item.type === "message") for (const c of item.content) if (c.type === "output_text") text += c.text;
    if (item.type === "function_call") toolCalls.push({ callId: item.call_id, name: item.name, arguments: parseArgs(item.arguments) });
  }
  return { provider, model, latencyMs: Date.now() - t0, text, toolCalls, usage: usageOf(r.usage?.input_tokens, r.usage?.output_tokens) };
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
        ...(req.schema ? { response_format: { type: "json_schema" as const, json_schema: { name: req.schema.name, schema: jsonSchemaOf(req.schema) } } } : {}),
      }, { signal: req.signal }),
    d,
    req.signal,
  );
  const msg = r.choices[0]?.message;
  const toolCalls: ToolCall[] = [];
  for (const c of msg?.tool_calls ?? []) if (c.type === "function") toolCalls.push({ callId: c.id, name: c.function.name, arguments: parseArgs(c.function.arguments) });
  return { provider, model, latencyMs: Date.now() - t0, text: msg?.content ?? "", toolCalls, usage: usageOf(r.usage?.prompt_tokens, r.usage?.completion_tokens) };
}

// What moves a live call to the chain's next binding: the provider is busy or down (429, 5xx, after withRetry's own
// retries), it did not answer within its role's timeout, or this deployment has no key for it (skipped loudly: the
// warning names the key, never its value). The run's own budget running out is not one: the run is over.
const fallsBack = (e: unknown, signal?: AbortSignal) => {
  if (!(e instanceof ModelError) || signal?.aborted) return false;
  if (e.code === "no_key") {
    const name = missingSetting(e.message);
    notice("model.key_skipped", name ? { names: [name] } : {});
  }
  return e.code === "timeout" || e.code === "no_key" || (e.status !== undefined && (e.status === 429 || e.status >= 500));
};

/** What a generate fixture is keyed by (fixtureKey of this): the role and the signal are not part of it. */
export const generateKeyed = (req: GenerateRequest, { provider, model }: { provider: Raw["provider"]; model: string }) =>
  ({ kind: "generate", provider, model, messages: req.messages, tools: req.tools, schema: req.schema && { name: req.schema.name, json: jsonSchemaOf(req.schema) } });

async function once(req: GenerateRequest, b: { provider: Raw["provider"]; model: string; alias?: string }, mode: ReturnType<typeof parseMode>, d: Deps): Promise<GenerateResult> {
  const { provider, model } = b;
  const raw = await viaFixture<Raw>(mode, d.fixturesDir ?? DEFAULT_FIXTURES_DIR, generateKeyed(req, { provider, model }), RAW_SHAPE, () =>
    (provider === "anthropic" ? viaAnthropic : USES_RESPONSES.has(provider) ? viaResponses : viaChat)(req, provider, model, d),
  );
  // The call happened (or was replayed): told before its reply is checked, since a reply off its schema was still billed.
  await told(d, { role: req.role, alias: aliasOf(b, req.role), provider, model, usage: raw.usage, replayed: mode === "recorded" });
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

/**
 * One model call. With a chain (Deps.chain), its first binding answers; in live mode only, a 429, a 5xx or a timeout
 * moves to the next, each further attempt first allowed again (Deps.allowAgain: core counts it), and `tried` lists the
 * aliases in order. Recorded mode never falls back: a missing fixture stays an error, so gates stay strict.
 */
export async function generate(req: GenerateRequest, d: Deps = {}): Promise<GenerateResult> {
  const mode = parseMode(d.mode ?? (d.env ?? process.env).MUNSHI_MODEL_MODE);
  if (!d.chain) return once(req, await onList(req.role, resolveBinding(req.role, d), d), mode, d);
  const chain = await d.chain(req.role);
  if (chain.length === 0) throw new ModelError(`no model is allowed for role ${req.role}`);
  const tries = mode === "live" ? chain : chain.slice(0, 1);
  const tried: string[] = [];
  // A binding skipped for a missing key made no call, so the next one uses the allowance already counted.
  let spent = false;
  for (const [i, b] of tries.entries()) {
    if (i > 0 && spent && d.allowAgain && !(await d.allowAgain(req.role))) throw new ModelError("AI is off for this shop, or its calls today are spent");
    tried.push(b.alias);
    try {
      return { ...(await once(req, b, mode, d)), alias: b.alias, tried };
    } catch (e) {
      if (i === tries.length - 1 || !fallsBack(e, req.signal)) throw e;
      spent = !(e instanceof ModelError && e.code === "no_key");
    }
  }
  throw new ModelError("no model answered");
}
