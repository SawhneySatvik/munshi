// The run's loop on its own: routing, the read budget (8 reads), the time budget, refused tool calls, and what reaches a
// trace. The port is an in-memory stand-in at the system boundary; everything that needs the database (RLS, real
// snapshots, other runs, other tenants) is in db/test/a1-agent.test.ts. Model turns are hand-written and replayed from
// packages/agent/fixtures/run (see script.ts).
import type { Cell } from "@munshi/core/read";
import { beforeAll, describe, expect, it } from "vitest";
import { renderReply } from "../src/answer.ts";
import type { AgentPort, TraceEvent } from "../src/port.ts";
import { ask, TRACE_LABELS } from "../src/run.ts";
import { TOOLS, toolSpec } from "../src/tools.ts";
import { prepare, scripted, type Turn } from "./script.ts";

const SUITE = "run";
beforeAll(() => prepare(SUITE));

const AS_OF = "2026-10-27";
const ITEM = "9a1b2c3d-0000-4000-8000-000000000001";
const SUPPLIER = "9a1b2c3d-0000-4000-8000-000000000002";
const t = (txt: string): Cell => ({ kind: "text", txt });
const WORLD: Record<string, Record<string, Cell>[]> = {
  "items.list": [{ item_id: t(ITEM), item: t("Glucose biscuits 70 g"), category: t("biscuits"), on_hand: { kind: "quantity", num: "18000", unit: "pack" } }],
  "bills.recent": [
    { purchase_id: t("9a1b2c3d-0000-4000-8000-000000000003"), bill_no: t("GT-1013"), bill_date: { kind: "date", day: "2026-10-21" }, supplier_id: t(SUPPLIER), supplier: t("Gupta Traders (simulated)"), total: { kind: "money", num: "1200000", currency: "INR" }, lines: { kind: "integer", num: "14" } },
  ],
};

function memoryPort(clock?: { t: number }) {
  const snaps = new Map<string, Record<string, Cell>[]>();
  const events: TraceEvent[] = [];
  let reads = 0;
  const port: AgentPort = {
    async read(name) {
      const rows = WORLD[name];
      if (!rows) throw new Error("no such read in this world");
      const id = `00000000-0000-4000-8000-${String(++reads).padStart(12, "0")}`;
      snaps.set(id, rows);
      if (clock) clock.t += 30_000;
      return { snapshotId: id, rows };
    },
    async resolve(r) {
      return snaps.get(r.snapshotId)?.[r.row]?.[r.col] ?? null;
    },
    async propose() {
      throw new Error("no drafts in this suite");
    },
    async finding() {
      return null;
    },
    trace(e) {
      events.push(e);
    },
  };
  return { port, events, reads: () => reads };
}

const route = (desk: string): Turn => ({ json: { desk } });
const call = (name: string, args: unknown = {}): Turn => ({ tools: [{ name, args }] });
const say = (...segments: { text: string; refs: { read: number; row: number; col: string }[] }[]): Turn => ({ json: { segments } });

describe("the run", () => {
  it("a desk makes at most 8 reads; then narrate answers from what it read", async () => {
    const m = memoryPort();
    const s = scripted(SUITE, [route("stock"), ...Array.from({ length: 8 }, () => call("items_list")), say({ text: "⟦1⟧ is running low.", refs: [{ read: 8, row: 0, col: "item" }] })]);
    const reply = await ask("Which items should I reorder this week?", { port: m.port, asOf: AS_OF, deps: s.deps });
    expect(s.left()).toBe(0);
    expect(m.reads()).toBe(8);
    expect(m.events.filter((e) => e.kind === "model" && e.label === "reason")).toHaveLength(8);
    expect(m.events.some((e) => e.kind === "budget" && e.label === "tool_calls")).toBe(true);
    expect(renderReply(reply)).toEqual(["Glucose biscuits 70 g is running low."]);
  });

  it("the time budget stops the loop between reads", async () => {
    const clock = { t: 0 };
    const m = memoryPort(clock);
    const s = scripted(SUITE, [route("stock"), call("bills_recent", { days: 7 }), call("bills_recent", { days: 3 }), say()]);
    const reply = await ask("What did I buy recently?", { port: m.port, asOf: AS_OF, deps: s.deps, now: () => clock.t });
    expect(s.left()).toBe(0);
    expect(m.reads()).toBe(2); // 30 s a read against a 45 s budget: the third turn never starts
    expect(m.events.some((e) => e.kind === "budget" && e.label === "time")).toBe(true);
    expect(reply).toEqual({ kind: "abstain", specialist: "stock", missing: ["no_answer"] });
  });

  it("an unknown tool, an unknown id and bad arguments are refused, and no model text reaches a trace", async () => {
    const m = memoryPort();
    const question = "What did Ramesh pay for butter?";
    const s = scripted(SUITE, [
      route("stock"),
      call("Ramesh_K_owes_1200"),
      call("purchases_last_price", { item_id: "item:9" }),
      call("purchases_price_history", { item_id: "item:1", days: 500 }),
      { text: "Ramesh K. — nothing found" },
      say(),
    ]);
    const reply = await ask(question, { port: m.port, asOf: AS_OF, deps: s.deps });
    expect(s.left()).toBe(0);
    expect(m.reads()).toBe(0);
    expect(m.events.filter((e) => e.kind === "read").map((e) => e.label)).toEqual(["unknown_tool", "unknown_id", "bad_params"]);
    expect(reply).toMatchObject({ kind: "abstain", missing: ["no_answer"] });
    const all = JSON.stringify(m.events);
    for (const untrusted of ["Ramesh", "butter", "nothing found", "item:9"]) expect(all, untrusted).not.toContain(untrusted);
    for (const e of m.events) for (const label of e.label.split(",")) expect(TRACE_LABELS.has(label), label).toBe(true);
  });

  it("a question outside the books abstains, and a model that does not answer degrades to an abstention", async () => {
    const off = scripted(SUITE, [route("none")]);
    expect(await ask("Write me a poem about the monsoon.", { port: memoryPort().port, asOf: AS_OF, deps: off.deps })).toEqual({
      kind: "abstain",
      specialist: null,
      missing: ["out_of_scope"],
    });
    const silent = scripted(SUITE, []); // no fixture recorded for this question
    expect(await ask("A question nobody recorded", { port: memoryPort().port, asOf: AS_OF, deps: silent.deps })).toEqual({
      kind: "abstain",
      specialist: null,
      missing: ["model_error"],
    });
  });

  it("no tool takes a tenant: the port is already bound to one", () => {
    expect(TOOLS.length).toBe(9);
    for (const tool of TOOLS) expect(JSON.stringify(toolSpec(tool)).toLowerCase(), tool.name).not.toContain("tenant");
  });
});
