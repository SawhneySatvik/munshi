// For the pure injection and cross-tenant suites: an in-memory inbox port at the system boundary (a message's words, the
// cells its reads return, what was proposed and stored, whether the run was tainted) and a fake transport that answers
// each model call with the next hand-written turn and keeps every request as the provider would receive it, so a test
// can read exactly what a model was shown. Nothing touches the network or a fixture. Everything that needs the database
// (RLS, core's readings of spans, the drafts' checks) is in db/test/v2/core/agent.
import type { Cell } from "@munshi/core/read";
import type { DraftProposal, InboxPort, InboxWords, TraceEvent } from "../../src/port.ts";
import type { Deps } from "@munshi/ai";
import { env, json, noSleep, responsesBody } from "../helpers.ts";
import type { Turn } from "../script.ts";

export function memoryInbox(words: InboxWords, reads: Record<string, Record<string, Cell>[]> = {}) {
  const snaps = new Map<string, Record<string, Cell>[]>();
  const events: TraceEvent[] = [];
  const proposed: DraftProposal[] = [];
  const stored: { spans: unknown[]; words: string[] } = { spans: [], words: [] };
  const log: string[] = []; // the order of what the run did: taint, message, …
  let n = 0;
  const port: InboxPort = {
    runId: "00000000-0000-4000-8000-0000000000ff",
    async read(name) {
      const rows = reads[name];
      if (!rows) throw new Error("no such read in this world");
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
      snaps.set(id, rows);
      return { snapshotId: id, rows };
    },
    resolve: async (r) => snaps.get(r.snapshotId)?.[r.row]?.[r.col] ?? null,
    async propose(d) {
      proposed.push(d);
      return "00000000-0000-4000-8000-0000000000d0";
    },
    finding: async () => null,
    trace: (e) => void events.push(e),
    taint: async () => void log.push("taint"),
    async message() {
      log.push("message");
      return words;
    },
    saveTranscript: async () => void log.push("transcript"),
    async recordExtracts(_m, spans) {
      stored.spans.push(...spans);
      return spans.map(() => ({ refusal: "unreadable" }));
    },
    async writeCopy(_c, body) {
      stored.words.push(body);
      return "00000000-0000-4000-8000-0000000000c0";
    },
    async writeReply(body) {
      stored.words.push(body);
      return "00000000-0000-4000-8000-0000000000c1";
    },
  };
  return { port, events, proposed, stored, log };
}

/** Deps whose transport answers each call with the next turn and keeps the requests; `shown()` is every text sent. */
export function capture(turns: Turn[]) {
  const sent: string[] = [];
  const queue = [...turns];
  const f = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(String(init?.body ?? ""));
    const t = queue.shift();
    if (!t) throw new Error("the model was asked for more turns than the test wrote");
    const text = "json" in t ? JSON.stringify(t.json) : "text" in t ? t.text : "";
    const output =
      "tools" in t
        ? t.tools.map((c, i) => ({ type: "function_call", id: `fc${i}`, call_id: `call_${i}`, name: c.name, arguments: JSON.stringify(c.args), status: "completed" }))
        : [{ type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }];
    return json(200, responsesBody({ output }));
  }) as typeof fetch;
  const deps: Deps = { mode: "live", edition: "meta", env, fetch: f, sleep: noSleep };
  return { deps, sent, left: () => queue.length };
}
