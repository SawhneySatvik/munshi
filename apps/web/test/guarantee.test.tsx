// The guarantee's second clause on the owner home: every figure shown traces to a stored snapshot cell. Rendered from
// the books as the server builds the page, a digit may appear only inside a source chip (a ref that resolved), in a
// name read from the books, in a <time>, in the drawer's stored cells, or in a layout counter; anything else fails.
import { cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Lang, OwnerHome } from "../lib/types";
import { ANSWERS, type Home, homeFor, openHome } from "./home-db";
import { countRefs, DIGIT, fakeMatchMedia, renderHome, unsourced } from "./render";

// Chips the answer key implies: two per shelf gap, two per price rise, three on the one overdue card, three per expiring
// lot, two per short settlement, and the drafted reorder's quantity.
const PER_KIND: Record<string, number> = { shrinkage: 2, price_creep: 2, expiry: 3, short_settlement: 2 };
const EXPECTED_CHIPS =
  ANSWERS.reduce((n, a) => n + (PER_KIND[a.kind] ?? 0), 0) + (ANSWERS.some((a) => a.kind === "overdue_credit") ? 3 : 0) + 1;

let h: Home;
let data: OwnerHome;
beforeAll(async () => {
  h = await openHome();
  data = await homeFor(h.k.owner);
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("no figure on the home renders without a SourceRef", () => {
  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: every digit sits in a chip, a name, a time or a stored cell, and every chip is one ref`, () => {
      renderHome(data, lang);
      const chips = document.querySelectorAll(".pair");
      console.log(`${lang}: ${chips.length} chips, ${countRefs(data)} refs, ${EXPECTED_CHIPS} expected from the answer key`);
      expect(EXPECTED_CHIPS).toBe(15);
      expect(chips.length).toBe(EXPECTED_CHIPS);
      expect(countRefs(data)).toBe(EXPECTED_CHIPS);
      for (const chip of chips) expect(chip.querySelector(".amt")?.textContent ?? "").toMatch(DIGIT);
      expect(unsourced(document.body)).toEqual([]);
    });
  }

  test("a ref that lands on no cell renders Cannot verify and no chip", () => {
    const broken: OwnerHome = structuredClone(data);
    const gap = broken.findings.find((f) => f.kind === "shelf_gap");
    if (gap?.kind !== "shelf_gap") throw new Error("the brief holds a shelf gap");
    gap.books = { ...gap.books, row: 99 };
    renderHome(broken);
    const line = screen.getAllByText(/Books say/)[0] as HTMLElement;
    expect(line.textContent).toBe("Books say Cannot verify");
    expect(within(line).queryByRole("button")).toBeNull();
  });

  test("a draft whose payload ref does not hold the quantity it orders shows Cannot verify, not the payload", async () => {
    // Core refuses such a draft, so it is written straight into the table (as the superuser, with the draft's own triggers
    // off: they refuse anyone but the app): the demo draft's evidence and ref, ordering 48 packs where the cited cell
    // holds the gap's 6.
    const admin = await h.db.admin.connect();
    let made: { id: string }[];
    try {
      await admin.query("begin");
      await admin.query("set local session_replication_role = replica");
      ({ rows: made } = await admin.query<{ id: string }>(
        `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, proposed_by, run_id, created_txid)
         select tenant_id, command, jsonb_set(payload, '{lines,0,qtyMilli}', '48000'), based_on, payload_refs, source, proposed_by, run_id, txid_current()
           from approval.draft where id = $1 returning id`,
        [h.draftId],
      ));
      await admin.query("commit");
    } finally {
      admin.release();
    }
    const odd = made[0]?.id;
    const now = await homeFor(h.k.owner);
    const card = now.drafts.find((x) => x.id === odd);
    expect(card?.lines[0]?.qty).toBeNull();
    renderHome(now);
    const what = document.querySelectorAll(".pending-what")[1] as HTMLElement;
    expect(what.textContent).toContain("Cannot verify");
    expect(what.textContent).not.toContain("48");
  });

  test("the UPI line says Cannot verify and carries no digit", () => {
    renderHome(data);
    const line = document.querySelector(".unverified");
    expect(line?.textContent).toContain("Cannot verify");
    expect(line?.textContent).not.toMatch(DIGIT);
  });
});
