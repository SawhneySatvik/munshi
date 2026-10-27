// The hero tests' model turns. Normally the app runs as it ships: MUNSHI_MODEL_MODE unset is `recorded`, and every
// model call replays a fixture under apps/web/fixtures/<flow>/ (nothing touches the network; a request with no fixture
// is a model error, and the flow abstains or refuses). With MUNSHI_WEB_FIXTURES=write the same tests rewrite those
// fixtures from the turns written in them: the agent runs in `record` mode against a stand-in transport that answers
// each call with the next turn, so every fixture key is computed by the real adapter path from the real request (the
// kirana seed as of AS_OF). Rewrite after any change to a prompt, a read or the seed:
//   MUNSHI_WEB_FIXTURES=write node_modules/.bin/vitest run test/hero-*.test.tsx
// These are synthetic turns written for the demo, not a model's output; the screens label them "Recorded response".
import { mkdirSync, rmSync } from "node:fs";
import type { Deps } from "@munshi/agent";

export type Turn = { tools: { name: string; args: unknown }[] } | { text: string } | { json: unknown } | { transcript: string };

export const WRITING = process.env.MUNSHI_WEB_FIXTURES === "write";

/**
 * The turns the next model calls get, in order (write mode only); what is left after a flow must be nothing. A call
 * with no turn written runs as shipped (recorded), so a test of a question with no recorded response means the same in
 * both modes. Each hero test mocks agent-port's agentDeps with `depsFor`.
 */
export const script: { turns: Turn[] } = { turns: [] };

/** Write mode starts a flow's fixture directory empty, so no stale fixture survives a rewrite. */
export function prepare(dir: string): void {
  if (!WRITING) return;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const said = (t: Turn) => ("text" in t ? t.text : "json" in t ? JSON.stringify(t.json) : "");

// One stand-in response in the wire format of the endpoint asked: Meta's speech-to-text, Chat Completions (narrate's
// host), or the Responses API (every other role).
function answer(url: string, t: Turn, n: number): Response {
  if (url.endsWith("/asr/transcribe")) {
    if (!("transcript" in t)) throw new Error("the voice model was asked, but the next turn is not a transcript");
    return reply({ transcript: t.transcript });
  }
  if (url.endsWith("/chat/completions")) {
    return reply({
      id: `c${n}`,
      object: "chat.completion",
      created: 0,
      model: "stand-in",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: said(t) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  const output =
    "tools" in t
      ? t.tools.map((c, i) => ({ type: "function_call", id: `fc${n}_${i}`, call_id: `call_${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args), status: "completed" }))
      : [{ type: "message", id: `m${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: said(t), annotations: [] }] }];
  return reply({
    id: `r${n}`,
    object: "response",
    created_at: 0,
    model: "stand-in",
    status: "completed",
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    output,
  });
}

/** The agent's deps in write mode: `record` through the stand-in transport, into the flow's fixture directory. */
export function writingDeps(dir: string): Deps {
  let n = 0;
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const t = script.turns.shift();
    if (!t) throw new Error("no turn written for this model call"); // the flow sees a model error, as with no fixture
    return answer(url, t, n++);
  }) as typeof globalThis.fetch;
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", META_MODEL_API_KEY: "fixture-writer", BASETEN_API_KEY: "fixture-writer" };
  return { mode: "record", edition: "meta", env, fixturesDir: dir, fetch, sleep: async () => {} };
}

/**
 * Write mode only: the OpenAI SDK refuses to build a client where `window`, `document` and `navigator` all exist (it
 * takes jsdom for a browser), so the flows that write fixtures run with `navigator` hidden. Replay never builds one.
 */
export function hideNavigatorWhileWriting(stub: (name: string, value: unknown) => void): void {
  if (WRITING) stub("navigator", undefined);
}

/** agentDeps as a hero test runs it: the stand-in transport while turns are written (write mode), else as shipped. */
export const depsFor = (shipped: Deps, dir: string): Deps => (WRITING && script.turns.length ? writingDeps(dir) : shipped);
