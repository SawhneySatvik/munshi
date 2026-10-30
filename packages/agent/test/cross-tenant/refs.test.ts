// BP-EVAL-1, the cross-tenant suite's pure half: a ref the run cannot resolve (another shop's snapshot: under RLS it
// resolves to nothing) is "Cannot verify", never a figure; and the copy writer turns a model's ref into a cell only of
// this run's own reads, so a ref to anything else (another shop's snapshot included) points nowhere and the copy
// abstains. The db half (RLS itself, core refusing a foreign ref token or cell) is db/test/v2/core/agent.
import { CANNOT_VERIFY, type Cell, type CellRef } from "@munshi/core/read";
import { expect, it } from "vitest";
import { checkAnswer, renderReply } from "../../src/answer.ts";
import { writeCampaignCopy } from "../../src/copy.ts";
import { capture, memoryInbox } from "../injection/lib.ts";

const OURS = "00000000-0000-4000-8000-00000000a001";
const THEIRS = "00000000-0000-4000-8000-00000000b001"; // another shop's snapshot: this shop's RLS returns no row for it
const cells: Record<string, Record<string, Cell>[]> = { [OURS]: [{ balance: { kind: "money", num: "30000", currency: "INR" } }] };
const resolve = async (r: CellRef) => cells[r.snapshotId]?.[r.row]?.[r.col] ?? null;

it("XT-PURE a ref to another shop's snapshot is not this run's and resolves to nothing: the answer abstains and renders as Cannot verify", async () => {
  const theirs: CellRef = { snapshotId: THEIRS, row: 0, col: "balance" };
  const checked = await checkAnswer({ segments: [{ text: "Baaki ⟦1⟧ hai.", refs: [theirs] }] }, new Map([[OURS, null]]), resolve);
  expect(checked).toEqual({
    ok: false,
    failures: [
      { segment: 0, rule: "not_this_run", ref: 0 },
      { segment: 0, rule: "unresolved", ref: 0 },
    ],
  });
  const [shown] = renderReply({ kind: "abstain", specialist: null, missing: ["not_this_run", "unresolved"] });
  expect(shown?.startsWith(`${CANNOT_VERIFY}:`)).toBe(true);
  expect(shown).not.toMatch(/\p{Nd}/u);
  // This shop's own cell, in scope, passes.
  expect(await checkAnswer({ segments: [{ text: "Baaki ⟦1⟧ hai.", refs: [{ snapshotId: OURS, row: 0, col: "balance" }] }] }, new Map([[OURS, null]]), resolve)).toMatchObject({ ok: true });
});

it("XT-PURE the copy writer maps a model's ref only onto this run's reads: a read number it never minted points nowhere, and the copy abstains with nothing stored", async () => {
  const m = memoryInbox(
    { kind: "text", text: null, transcript: null },
    {
      "campaign.audience": [{ customer_id: { kind: "text", txt: "00000000-0000-4000-8000-00000000a002" } }],
      "offer.detail": [{ amount_off: { kind: "money", num: "2000", currency: "INR" } }],
    },
  );
  // Read 9 is no read of this run (it might be another shop's snapshot the model saw named somewhere): it points nowhere.
  const model = capture([{ json: { segments: [{ text: "Is hafte ⟦1⟧ ki chhoot.", refs: [{ read: 9, row: 0, col: "amount_off" }] }] } }]);
  const result = await writeCampaignCopy(
    { campaignId: "00000000-0000-4000-8000-00000000a003", offerId: "00000000-0000-4000-8000-00000000a004", brief: "Offer" },
    { port: m.port, deps: model.deps },
  );
  expect(result).toMatchObject({ kind: "abstain", missing: expect.arrayContaining(["not_this_run", "unresolved"]) });
  expect(m.stored.words).toEqual([]);
});
