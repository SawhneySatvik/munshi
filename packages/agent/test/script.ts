// Hand-written model turns, replayed from recorded fixtures. Tests run with MUNSHI_MODEL_MODE semantics `recorded`: the
// fixture files under packages/agent/fixtures/<suite>/ are replayed and nothing touches the network. To (re)write them
// from the turns written in a test, run that test with MUNSHI_AGENT_FIXTURES=write: the same run goes through `record`
// mode with a placeholder key and a fake transport that answers each call with the next hand-written turn, so the
// fixture keys are computed by the real adapter path. Once a Meta key exists, record real turns with
// MUNSHI_MODEL_MODE=record through the app instead.
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Deps } from "../src/providers/client.ts";
import { json, noSleep, responsesBody } from "./helpers.ts";

export type Turn = { tools: { name: string; args: unknown }[] } | { text: string } | { json: unknown } | { transcript: string };

export const WRITING = process.env.MUNSHI_AGENT_FIXTURES === "write";

export const fixturesDir = (suite: string) => fileURLToPath(new URL(`../fixtures/${suite}`, import.meta.url));

/** Write mode starts the suite's fixture directory empty, so no stale fixture survives a rewrite. */
export function prepare(suite: string): void {
  if (!WRITING) return;
  rmSync(fixturesDir(suite), { recursive: true, force: true });
  mkdirSync(fixturesDir(suite), { recursive: true });
}

const text = (t: Turn) => ("text" in t ? t.text : "json" in t ? JSON.stringify(t.json) : "");

function body(url: string, t: Turn, n: number) {
  if (url.endsWith("/asr/transcribe")) {
    if (!("transcript" in t)) throw new Error("the voice model was asked, but the next turn is not a transcript");
    return { sessionId: `s${n}`, transcript: t.transcript };
  }
  if (url.endsWith("/chat/completions")) {
    return {
      id: `c${n}`,
      object: "chat.completion",
      created: 0,
      model: "scripted",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: text(t) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }
  const output =
    "tools" in t
      ? t.tools.map((c, i) => ({ type: "function_call", id: `fc${n}_${i}`, call_id: `call_${n}_${i}`, name: c.name, arguments: JSON.stringify(c.args), status: "completed" }))
      : [{ type: "message", id: `m${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: text(t), annotations: [] }] }];
  return responsesBody({ output });
}

/** Deps for one scripted run; `left()` is how many hand-written turns were not asked for (write mode only). */
export function scripted(suite: string, turns: Turn[]): { deps: Deps; left: () => number } {
  const queue = [...turns];
  if (!WRITING) {
    const offline = (() => {
      throw new Error("a recorded test reached the network");
    }) as unknown as typeof fetch;
    return { deps: { mode: "recorded", edition: "meta", env: {}, fixturesDir: fixturesDir(suite), fetch: offline }, left: () => 0 };
  }
  let n = 0;
  const fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const t = queue.shift();
    if (!t) throw new Error("the model was asked for more turns than the test wrote");
    return json(200, body(url, t, n++));
  }) as typeof globalThis.fetch;
  const env = { META_MODEL_API_KEY: "fixture-writer-key", BASETEN_API_KEY: "fixture-writer-key" } as NodeJS.ProcessEnv;
  return { deps: { mode: "record", edition: "meta", env, fixturesDir: fixturesDir(suite), fetch, sleep: noSleep }, left: () => queue.length };
}
