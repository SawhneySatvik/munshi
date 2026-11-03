import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const KEY = "mk-test-SECRET-0123456789";
export const env = { META_MODEL_API_KEY: KEY, BASETEN_API_KEY: "bt-test-SECRET-0123456789", MUNSHI_MODEL_MODE: "live" } as NodeJS.ProcessEnv;
export const tmpFixtures = () => mkdtempSync(join(tmpdir(), "munshi-fx-"));
export const noSleep = async () => {};
export const wavBytes = () => new Uint8Array(readFileSync(new URL("../fixtures/smoke/hindi.wav", import.meta.url)));

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that serves queued responses in order and records each request. */
export function queueFetch(...responses: (Response | (() => Response))[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra request");
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return { f, calls };
}

export const responsesBody = (over: Record<string, unknown> = {}) => ({
  id: "resp_1", object: "response", created_at: 0, model: "muse-spark-1.3", status: "completed", error: null, incomplete_details: null,
  instructions: null, metadata: null, parallel_tool_calls: false, temperature: null, tool_choice: "auto", tools: [], top_p: null,
  usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "hello", annotations: [] }] }],
  ...over,
});
