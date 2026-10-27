// The cite-or-abstain rules on their own, against a resolver over a fixed set of cells (the database-backed versions,
// with RLS and real runs, are db/test/a1-agent.test.ts).
import type { Cell, CellRef } from "@munshi/core/read";
import { describe, expect, it } from "vitest";
import { type Answer, checkAnswer, freeDigit, renderReply, renderSegment } from "../src/answer.ts";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const cells = new Map<string, Cell>([
  [`${S1}:0:item`, { kind: "text", txt: "Glucose biscuits 70 g" }],
  [`${S1}:0:total`, { kind: "money", num: "653900", currency: "INR" }],
  [`${S1}:0:sold`, { kind: "quantity", num: "24000", unit: "pack" }],
  [`${S2}:3:overdue`, { kind: "money", num: "120000", currency: "INR" }],
  [`${S2}:4:overdue`, { kind: "money", num: "65000", currency: "INR" }],
]);
const resolve = async (r: CellRef) => cells.get(`${r.snapshotId}:${r.row}:${r.col}`) ?? null;
const scope = new Map<string, number | null>([
  [S1, null], // minted in this run: any row
  [S2, 3], // the finding asked about: its row only
]);
const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
const one = (text: string, refs: CellRef[]): Answer => ({ segments: [{ text, refs }] });
const rules = async (a: Answer) => {
  const r = await checkAnswer(a, scope, resolve);
  return r.ok ? [] : r.failures.map((f) => f.rule);
};

describe("cite or abstain", () => {
  it("a cited answer passes and renders every number from its cell", async () => {
    const a = one("⟦1⟧ sold ⟦2⟧ packs, ⟦3⟧ in all; ⟦4⟧ is overdue.", [ref(S1, 0, "item"), ref(S1, 0, "sold"), ref(S1, 0, "total"), ref(S2, 3, "overdue")]);
    const r = await checkAnswer(a, scope, resolve);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments.map((seg) => renderSegment(seg))).toEqual(["Glucose biscuits 70 g sold 24 packs, ₹6,539 in all; ₹1,200 is overdue."]);
    expect(renderReply({ kind: "answer", specialist: "sales", segments: r.segments })).toHaveLength(1);
  });

  it("a free digit fails the answer, in any script, and so does a percent sign", async () => {
    for (const text of ["Sales were 6539 rupees.", "बिक्री ६५३९ रुपये", "about ½ of it", "up ⟦1⟧, or 7%", "⟦1⟧ and ⟦0⟧", "₹⟦1⟧2"]) {
      expect(freeDigit(text), text).toBe(true);
      expect(await rules(one(text, [ref(S1, 0, "total")])), text).toContain("free_digit");
    }
    expect(freeDigit("⟦1⟧ sold ⟦12⟧ — nothing else")).toBe(false);
  });

  it("a handle with no ref fails", async () => {
    expect(await rules(one("⟦1⟧ and ⟦2⟧", [ref(S1, 0, "total")]))).toEqual(["unknown_handle"]);
  });

  it("a ref outside the run's scope fails, and an admitted snapshot admits only its own row", async () => {
    const other = "33333333-3333-4333-8333-333333333333";
    expect(await rules(one("⟦1⟧", [ref(other, 0, "total")]))).toEqual(["not_this_run", "unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S2, 4, "overdue")]))).toEqual(["not_this_run"]); // resolves, but not the admitted row
    expect(await rules(one("⟦1⟧", [ref(S2, 3, "overdue")]))).toEqual([]);
  });

  it("a ref that does not resolve fails, and so does a malformed one", async () => {
    expect(await rules(one("⟦1⟧", [ref(S1, 9, "total")]))).toEqual(["unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S1, 0, "Total; drop")]))).toEqual(["unresolved"]);
    expect(await rules(one("⟦1⟧", [ref(S1, -1, "total")]))).toEqual(["unresolved"]);
  });

  it("the renderer refuses a free digit even if it is handed one, and an abstention names what is missing", () => {
    expect(renderSegment({ text: "Sales were 6539.", refs: [], cells: [] })).toBe("Cannot verify");
    expect(renderReply({ kind: "abstain", specialist: "sales", missing: ["free_digit", "unresolved"] })).toEqual([
      "Cannot verify: a number without a source; a source that does not exist.",
    ]);
  });
});
