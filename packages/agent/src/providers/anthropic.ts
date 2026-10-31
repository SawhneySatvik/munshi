// Anthropic's Messages API over plain fetch (no SDK: the install is offline). Shapes from Anthropic's public API docs:
// POST /v1/messages with x-api-key and anthropic-version; system text is a top-level field; tools carry input_schema; a
// JSON answer is a forced tool whose input is the answer (there is no response_format here).
import { ROLE_TIMEOUT_MS } from "../config.ts";
import { apiKey, baseUrl, withRetry, type Deps } from "./client.ts";
import { jsonSchemaOf, type Raw } from "./generate.ts";
import { ModelError, redact } from "./redact.ts";
import type { GenerateRequest, Message, ToolCall } from "./types.ts";

export const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string } };

function imageBlock(url: string): Block {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  return { type: "image", source: m ? { type: "base64", media_type: m[1] as string, data: m[2] as string } : { type: "url", url } };
}

/** The request body: system messages joined into `system`, an image as its own block before the text. */
export function anthropicBody(req: GenerateRequest, model: string): Record<string, unknown> {
  const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const messages = req.messages
    .filter((m): m is Message & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.imageUrl ? [imageBlock(m.imageUrl), { type: "text", text: m.content }] : m.content }));
  const tools = (req.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  if (req.schema) tools.push({ name: req.schema.name, description: "Give the answer in this shape.", input_schema: jsonSchemaOf(req.schema) });
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(system ? { system } : {}),
    messages,
    ...(tools.length ? { tools } : {}),
    // A schema alone forces its tool; with real tools beside it, any tool (the schema's is the answer).
    ...(req.schema ? { tool_choice: req.tools?.length ? { type: "any" } : { type: "tool", name: req.schema.name } } : {}),
  };
}

type Reply = {
  content?: ({ type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: string })[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

/** The reply: text blocks joined; the schema tool's input becomes the text (validated by generate like any JSON answer). */
export function fromAnthropic(r: Reply, schemaName: string | undefined): Pick<Raw, "text" | "toolCalls" | "usage"> {
  let text = "";
  let answer: string | undefined;
  const toolCalls: ToolCall[] = [];
  for (const b of r.content ?? []) {
    if (b.type === "text" && "text" in b) text += b.text;
    if (b.type === "tool_use" && "input" in b) {
      if (b.name === schemaName) answer = JSON.stringify(b.input);
      else toolCalls.push({ callId: b.id, name: b.name, arguments: b.input ?? {} });
    }
  }
  return { text: answer ?? text, toolCalls, usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 } };
}

export async function viaAnthropic(req: GenerateRequest, provider: Raw["provider"], model: string, d: Deps): Promise<Raw> {
  const env = d.env ?? process.env;
  const key = apiKey(provider, env);
  const doFetch = d.fetch ?? fetch;
  const body = JSON.stringify(anthropicBody(req, model));
  const t0 = Date.now();
  const r = await withRetry(async () => {
    const signal = req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(ROLE_TIMEOUT_MS[req.role])]) : AbortSignal.timeout(ROLE_TIMEOUT_MS[req.role]);
    let res: Response;
    try {
      res = await doFetch(`${baseUrl(provider)}/messages`, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body,
        signal,
      });
    } catch (e) {
      // The role's own timeout (not the caller's budget): the chain may move on, as for the SDK's timeout.
      if ((e as { name?: unknown })?.name === "TimeoutError" && !req.signal?.aborted) throw new ModelError("model call timed out", undefined, "timeout", env);
      throw e;
    }
    if (!res.ok) {
      const text = redact((await res.text()).slice(0, 300), env);
      let code: string | undefined;
      try {
        const j = JSON.parse(text) as { error?: { type?: unknown } };
        if (typeof j.error?.type === "string") code = j.error.type;
      } catch { /* body was not JSON */ }
      throw Object.assign(new Error(`anthropic call failed (${res.status}): ${text}`), { status: res.status, code });
    }
    return (await res.json()) as Reply;
  }, d, req.signal);
  return { provider, model, latencyMs: Date.now() - t0, ...fromAnthropic(r, req.schema?.name) };
}
