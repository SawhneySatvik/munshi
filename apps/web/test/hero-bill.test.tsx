// Reading a supplier's bill from a photo on /bills, on the demo shop's books and a recorded model response
// (hero-script.ts). The photo is the committed synthetic bill (packages/agent/fixtures/media/bill.png: Gupta Traders'
// GT-1050, three lines). Each line shows as printed with its figures read on the bill (cells placed on the page), the
// item it matched by exact name or alias (never a model's guess), a price above the last bill flagged with both cells,
// and the purchase.record draft, which writes the books only when a member allowed to record purchases approves it.
import { readFileSync } from "node:fs";
import { runCommand } from "@munshi/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readBillAction } from "../app/bills/photo-actions";
import { decidePhotoDraft } from "../app/hero-actions";
import { BillPhoto } from "../components/BillPhoto";
import { BillsView } from "../components/books/BillsView";
import { LangProvider } from "../components/LangProvider";
import type { BillDraft, BillState } from "../lib/hero-types";
import { fixturesDir } from "../lib/server/agent-port";
import { loadBills } from "../lib/server/bills";
import { billSuppliers, photoDrafts } from "../lib/server/hero";
import { resolveCell } from "../lib/snapshot";
import { hideNavigatorWhileWriting, prepare, script, type Turn, WRITING } from "./hero-script";
import { type Home, openHome, rows, signInAs } from "./home-db";
import { formOf } from "./ops-db";
import { fakeMatchMedia, unsourced } from "./render";

vi.mock("../lib/server/agent-port", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/server/agent-port")>();
  const { depsFor } = await import("./hero-script");
  return { ...real, agentDeps: (flow: "ask" | "shelf" | "bill") => depsFor(real.agentDeps(flow), real.fixturesDir(flow)) };
});

const media = (name: string) => readFileSync(new URL(`../../../packages/agent/fixtures/media/${name}`, import.meta.url));
const BILL = media("bill.png");

// The bill as printed (bill.svg): each figure's text, right-aligned at x on its baseline y, in 20px Courier (12px a
// character), placed on the 0–1000 grid of the 800 × 1100 page.
function reading(): Turn {
  const svg = media("bill.svg").toString("utf8");
  const at = (x: number, y: number, text: string) => [
    Math.round(((x - text.length * 12) / 800) * 1000),
    Math.round(((y - 16) / 1100) * 1000),
    Math.round((x / 800) * 1000),
    Math.round(((y + 4) / 1100) * 1000),
  ];
  const cells = (col: number) =>
    [...svg.matchAll(new RegExp(`<text x="${col}" y="(\\d+)" font-size="20" text-anchor="end">([0-9.]+)</text>`, "g"))].map((m) => ({ y: Number(m[1]), text: m[2] as string }));
  const items = [...svg.matchAll(/<text x="100" y="(\d+)" font-size="20">([^<]+)<\/text>/g)].map((m) => m[2] as string);
  const qty = cells(520);
  const rate = cells(630);
  return {
    json: {
      billNo: "GT-1050",
      billDate: "2026-10-27",
      lines: items.map((text, i) => {
        const q = qty[i] as { y: number; text: string };
        const r = rate[i] as { y: number; text: string };
        return { text, qty: q.text, qtyAt: at(520, q.y, q.text), rate: r.text, rateAt: at(630, r.y, r.text) };
      }),
    },
  };
}

let h: Home;
let gupta: string;
beforeAll(async () => {
  prepare(fixturesDir("bill"));
  h = await openHome();
  gupta = h.k.suppliers.get("Gupta Traders (simulated)") as string;
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  Object.assign(URL, { createObjectURL: () => "blob:bill", revokeObjectURL: () => {} }); // jsdom has no object URLs
  hideNavigatorWhileWriting(vi.stubGlobal);
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(script.turns).toEqual([]);
});

/** Rejects every purchase draft still waiting: a repeat of a photo returns the draft it left, so a new reading needs none. */
async function clearWaiting() {
  signInAs(h.k.owner);
  for (const d of await rows<{ id: string }>(h, "select id::text from approval.draft where command_type = 'purchase.record' and status = 'proposed'")) {
    await decidePhotoDraft(null, formOf({ draft: d.id, verdict: "rejected" }));
  }
}

async function read(supplier = gupta, fresh = true): Promise<Extract<BillState, { result: unknown }>> {
  if (fresh) await clearWaiting();
  if (WRITING) script.turns = [reading()];
  const r = await readBillAction(null, photoForm(supplier));
  if (!r || !("result" in r)) throw new Error(`expected a reading, got ${JSON.stringify(r)}`);
  return r;
}
function photoForm(supplier: string, bytes: Uint8Array = BILL, type = "image/png"): FormData {
  const form = formOf({ supplier });
  form.set("photo", new Blob([bytes as BlobPart], { type }), "bill.png");
  return form;
}
async function page(who: Home["k"]["owner"]) {
  signInAs(who);
  const [data, suppliers, waiting] = await Promise.all([loadBills(who), billSuppliers(who), photoDrafts(who, { waiting: "purchase.record" })]);
  return render(
    <LangProvider initial="en">
      <BillsView data={data} photo={<BillPhoto suppliers={suppliers} waiting={waiting} recorded={true} />} />
    </LangProvider>,
  );
}

describe("reading a bill photo", () => {
  test("through the screen: each line as printed, its figures read on the bill, what it matched, the draft to approve", async () => {
    await page(h.k.owner);
    expect(document.querySelector('[data-slot="bill-photo"]')).not.toBeNull();
    if (WRITING) script.turns = [reading()];
    fireEvent.change(screen.getByRole("combobox", { name: "Supplier on the bill" }), { target: { value: gupta } });
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([BILL], "bill.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read this bill" }));
    const heading = await screen.findByText((_, el) => el?.tagName === "H3" && el.textContent === "Read on bill GT-1050", {}, { timeout: 30_000 });
    const out = heading.closest(".photo-out") as HTMLElement;
    expect(screen.getByText("Recorded response")).toBeTruthy();
    const lines = [...out.querySelectorAll(".bill-read tbody tr")];
    expect(lines.map((tr) => tr.querySelector("[data-printed]")?.textContent)).toEqual(["Glucose biscuits 70 g", "BUTTER 100G", "Masala oats 40 g"]);
    expect(lines.map((tr) => tr.querySelector(".matched")?.textContent)).toEqual([
      "Your item: Glucose biscuits 70 g",
      "Not in your catalogue: left out of the draft",
      "Not in your catalogue: left out of the draft",
    ]);
    expect(lines.map((tr) => [...tr.querySelectorAll(".bk-fig .amt")].map((a) => a.textContent))).toEqual([
      ["48", "₹8.50"],
      ["12 units", "₹62"], // matched no item: no unit of the shop's
      ["10 units", "₹18"],
    ]);
    expect(within(lines[0] as HTMLElement).getAllByRole("button", { name: /source: Read on the bill/ })).toHaveLength(2);
    expect(out.querySelectorAll(".fig-box")).toHaveLength(6); // every figure placed on the photo
    const draft = within(out).getByRole("region", { name: "Record the bill" });
    const drafted = draft.querySelector(".pending-lines") as HTMLElement;
    expect([...drafted.querySelectorAll(".amt, [data-name]")].map((e) => e.textContent)).toEqual(["48", "Glucose biscuits 70 g", "₹8.50"]);
    expect(within(draft).getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(unsourced(document.body)).toEqual([]);
    // The printed text is the model's reading, and says so beside the table.
    expect(out.querySelector("[data-printed-note]")?.textContent).toMatch(/not checked against your books/);
    // Choosing another photo clears this result: no old boxes over a new photo.
    fireEvent.change(screen.getByLabelText("Choose another photo"), { target: { files: [new File([BILL], "next.png", { type: "image/png" })] } });
    expect(document.querySelector(".bill-photo .photo-out")).toBeNull();
    expect(document.querySelector(".bill-photo .fig-box")).toBeNull();
  });

  test("the same photo for the same supplier sent again returns the draft it left waiting: no new run, no new draft", async () => {
    const first = await read();
    if (first.result.kind !== "read" || !first.result.draft) throw new Error("read");
    const before = await rows<{ runs: string; drafts: string }>(h, "select (select count(*) from ops.run)::text as runs, (select count(*) from approval.draft)::text as drafts");
    const again = await read(gupta, false);
    expect(again.result.kind === "again" && again.result.drafts.map((d) => d.id)).toEqual([first.result.draft.id]);
    expect(await rows(h, "select (select count(*) from ops.run)::text as runs, (select count(*) from approval.draft)::text as drafts")).toEqual(before);
    // A bill of the same photo for another supplier is a different bill: it is read, not returned.
    const other = [...(await billSuppliers(h.k.owner))].find((s) => s.id !== gupta);
    if (!other) throw new Error("a second supplier");
    expect((await read(other.id, false)).result.kind).not.toBe("again");
  });

  test("a refused reading in recorded mode says Recorded response, and so do the waiting drafts", async () => {
    await read(); // leaves a draft waiting
    await page(h.k.owner);
    expect(within(document.querySelector(".photo-waiting") as HTMLElement).getByText("Recorded response")).toBeTruthy();
    cleanup();
    await clearWaiting();
    vi.stubEnv("MUNSHI_EDITION", "paytm");
    try {
      await page(h.k.owner);
      expect(screen.queryByText("Recorded response")).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: "Supplier on the bill" }), { target: { value: gupta } });
      fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([new Uint8Array(BILL).slice(0, 64)], "other.png", { type: "image/png" })] } });
      fireEvent.click(screen.getByRole("button", { name: "Read this bill" }));
      await screen.findByText("Recorded response", {}, { timeout: 30_000 });
      expect(document.querySelector(".bill-photo .photo-status .ops-error")).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("a line the owner taught an alias for matches, and a price above the last bill is flagged with both cells", async () => {
    await runCommand(h.db.app, h.k.owner, "item.alias", { itemId: h.k.items.get("Butter 100 g"), alias: "BUTTER 100G" });
    const r = await read();
    if (r.result.kind !== "read") throw new Error("read");
    const butter = r.result.lines[1];
    expect(butter?.item).toBe("Butter 100 g");
    const was = butter?.rise && resolveCell(r.snapshots, butter.rise.was);
    const now = butter && resolveCell(r.snapshots, butter.cost);
    expect([was, now]).toEqual([
      { t: "money", minor: 6000, currency: "INR" }, // the seed's last butter bill (its price creep)
      { t: "money", minor: 6200, currency: "INR" },
    ]);
  });

  test("approving records the purchase under the owner, from the bill's cells; counter staff are refused", async () => {
    const r = await read(gupta, false); // the earlier reading's draft is still waiting: the same photo returns it
    if (r.result.kind !== "again") throw new Error("again");
    const draft = r.result.drafts[0] as BillDraft;
    expect(draft.lines.map((l) => [l.item, ...[l.qty, l.cost].map((ref) => ref && resolveCell(r.snapshots, ref))])).toEqual([
      ["Glucose biscuits 70 g", { t: "qty", milli: 48_000, unit: "pack" }, { t: "money", minor: 850, currency: "INR" }],
      ["Butter 100 g", { t: "qty", milli: 12_000, unit: "pack" }, { t: "money", minor: 6200, currency: "INR" }], // by its alias
    ]);
    signInAs(h.k.staff[0] as Home["k"]["owner"]);
    expect(await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }))).toEqual({ error: "refused" });
    signInAs(h.k.owner);
    const done = await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }));
    if (!done || !("draft" in done)) throw new Error(`expected a decision, got ${JSON.stringify(done)}`);
    expect(done.draft.status).toBe("executed");
    const [bought] = await rows<{ id: string; created_by: string; lines: string }>(
      h,
      `select p.id::text, p.created_by::text, (select string_agg(i.name || ' ' || pl.qty_milli || ' @ ' || pl.unit_cost_minor, '; ') from books.purchase_line pl join books.item i on i.id = pl.item_id where pl.purchase_id = p.id) as lines
         from books.purchase p where p.supplier_id = $1 and p.bill_no = 'GT-1050'`,
      [gupta],
    );
    expect(bought).toEqual({ id: done.billId, created_by: h.k.owner.memberId, lines: "Glucose biscuits 70 g 48000 @ 850; Butter 100 g 12000 @ 6200" });
  });

  test("a bill the books already hold is said so, with a link to it; nothing is drafted", async () => {
    const drafts = await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft where command_type = 'purchase.record'");
    const [recorded] = await rows<{ id: string }>(h, "select id::text from books.purchase where supplier_id = $1 and bill_no = 'GT-1050'", [gupta]);
    await page(h.k.owner);
    if (WRITING) script.turns = [reading()];
    fireEvent.change(screen.getByRole("combobox", { name: "Supplier on the bill" }), { target: { value: gupta } });
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([BILL], "bill.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read this bill" }));
    const known = await screen.findByText(/is already in your books/, {}, { timeout: 30_000 });
    expect(known.textContent).toBe("Bill GT-1050 from this supplier is already in your books, so nothing was drafted.");
    expect(screen.getByRole("link", { name: "Open the bill" }).getAttribute("href")).toBe(`/bills/${recorded?.id}`);
    expect(document.querySelector(".bill-photo .ops-error")).toBeNull(); // said, not an error
    expect(await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft where command_type = 'purchase.record'")).toEqual(drafts);
    // Said by the agent (readBill's alreadyRecorded), not thrown: the same through the action, with the purchase to open.
    const viaAction = await read(gupta, false);
    expect(viaAction.result).toEqual({ kind: "recorded", billNo: "GT-1050", billId: recorded?.id });
    // (A waiting draft of a bill recorded another way going stale on approval is core's gate: db/test/h2-bill-read.test.ts.)
  });

  test("no supplier, or a file that is not a still: refused before any model, nothing stored", async () => {
    signInAs(h.k.owner);
    const before = await rows<{ n: string }>(h, "select count(*)::text as n from ops.bill_read");
    expect(await readBillAction(null, photoForm(""))).toEqual({ error: "supplier" });
    const gif = await readBillAction(null, photoForm(gupta, new TextEncoder().encode("GIF89a"), "image/gif"));
    expect(gif && "result" in gif && gif.result).toEqual({ kind: "refused", why: "not_a_still" });
    expect(await rows<{ n: string }>(h, "select count(*)::text as n from ops.bill_read")).toEqual(before);
  });

  test("nothing printed on the bill reaches a trace", async () => {
    signInAs(h.k.owner);
    await read();
    const [run] = await rows<{ id: string }>(h, "select id::text from ops.run where trigger = 'photo' order by started_at desc limit 1");
    const all = JSON.stringify(await rows(h, "select kind, label, refs from ops.run_trace where run_id = $1", [run?.id]));
    expect(all).toContain("bill_read");
    for (const word of ["GT-1050", "BUTTER", "Masala", "Glucose", "8.50", "2026-10-27"]) expect(all.includes(word), word).toBe(false);
  });

  test("under the second edition (no models set up) the reading is refused, never an error", async () => {
    signInAs(h.k.owner);
    vi.stubEnv("MUNSHI_EDITION", "paytm");
    try {
      const r = await readBillAction(null, photoForm(gupta));
      expect(r && "result" in r && r.result).toEqual({ kind: "refused", why: "model_error" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
