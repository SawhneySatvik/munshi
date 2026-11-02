// W1-A, the tick's wiring: an authorized tick runs the back office with the brief's narrator built on the tick's own jobs
// pool (lib/server/agent-port.ts briefNarrator), and what that narrator answers is what the back office gets for the
// brief. The jobs, the back office and the narrator's model are stand-ins here (no database opens); AGENTS4 runs the
// real narrator through core's writeBrief on the demo kirana. Red-proof: db/test/v2/sabotage/agents-wired.ts.
import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../app/api/internal/tick/route";
import { state } from "./app-state";

const calls = vi.hoisted(() => ({ narrators: [] as unknown[], narrated: [] as unknown[] }));
const SAID = { outcome: "answered", segments: [{ text: "Munshi's line for the brief.", refs: [] }], modelCalls: 1 };

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  return {
    ...real,
    briefNarrator: (pool: unknown) => {
      calls.narrators.push(pool);
      return async () => SAID;
    },
  };
});
vi.mock("@munshi/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@munshi/core")>();
  return {
    ...real,
    runDueJobs: async () => [],
    // The back office as core runs it, cut to the brief: it asks the narrator it was given for a brief's lines.
    runBackOffice: async (pool: unknown, _now: Date, opts: { narrate?: (runId: string, ids: string[], at: { tenantId: string; asOf: string }) => Promise<unknown> }) => {
      calls.narrated.push({ pool, said: await opts.narrate?.("run", ["finding"], { tenantId: "tenant", asOf: "2026-10-27" }) });
      return [];
    },
  };
});

afterEach(() => {
  state.tick = undefined;
  calls.narrators.length = 0;
  calls.narrated.length = 0;
});

test("AGENTS9 an authorized tick runs the back office with the brief's narrator", async () => {
  state.tick = { cronSecret: "tick-secret-for-test", jobsDatabaseUrl: "postgres://munshi_jobs:none@127.0.0.1:9/none" };
  const res = await POST(new Request("http://localhost/api/internal/tick", { method: "POST", headers: { authorization: "Bearer tick-secret-for-test" } }));
  expect(res.status).toBe(200);
  // The narrator is built on the tick's own jobs pool, and its answer is what the back office got for the brief.
  expect(calls.narrators).toHaveLength(1);
  expect(calls.narrated).toEqual([{ pool: calls.narrators[0], said: SAID }]);
});
