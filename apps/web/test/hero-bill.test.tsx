// Reading a supplier's bill from a photo on /bills, on the demo shop's books and a recorded model response
// (hero-script.ts). The photo is the committed synthetic bill (packages/agent/fixtures/media/bill.png: Gupta Traders'
// GT-1050, three lines). Each line shows as printed with its figures read on the bill (cells placed on the page), the
// item it matched by exact name or alias (never a model's guess), a price above the last bill flagged with both cells,
// and the purchase.record draft, which writes the books only when a member allowed to record purchases approves it.
import { readFileSync } from "node:fs";
import { allow } from "@munshi/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readBillAction } from "../app/app/bills/photo-actions";
import { decidePhotoDraft } from "../app/app/hero-actions";
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
  for (const d of await rows<{ id: string }>(h, "select id::text from approval.draft where command = 'purchase.record' and status = 'proposed'")) {
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
    expect(lines.map((tr) => tr.querySelector("[data-printed]")?.textContent)).toEqual(["Glucose biscuits 70 g", "Butter 100 g", "Masala oats 40 g"]);
    expect(lines.map((tr) => tr.querySelector(".matched")?.textContent)).toEqual([
      "Your item: Glucose biscuits 70 g",
      "Your item: Butter 100 g",
      "Not in your catalogue: left out of the draft",
    ]);
    expect(lines.map((tr) => [...tr.querySelectorAll(".bk-fig .amt")].map((a) => a.textContent))).toEqual([
      ["48", "₹8.50"],
      ["12", "₹62"],
      ["10 units", "₹18"],
    ]);
    expect(within(lines[0] as HTMLElement).getAllByRole("button", { name: /source: Read on the bill/ })).toHaveLength(2);
    // Butter's ₹62 is above the ₹60 last paid: flagged on its line only, with the last price as a cell.
    expect(lines.map((tr) => tr.querySelectorAll(".bk-rise").length)).toEqual([0, 1, 0]);
    expect(out.querySelectorAll(".fig-box")).toHaveLength(6); // every figure placed on the photo
    const draft = within(out).getByRole("region", { name: "Record the bill" });
    const drafted = draft.querySelector(".pending-lines") as HTMLElement;
    expect([...drafted.querySelectorAll(".amt, [data-name]")].map((e) => e.textContent)).toEqual(["48", "Glucose biscuits 70 g", "₹8.50", "12", "Butter 100 g", "₹62"]);
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
    const before = await rows<{ runs: string; drafts: string }>(h, "select (select count(*) from ai.run)::text as runs, (select count(*) from approval.draft)::text as drafts");
    const again = await read(gupta, false);
    expect(again.result.kind === "again" && again.result.drafts.map((d) => d.id)).toEqual([first.result.draft.id]);
    expect(await rows(h, "select (select count(*) from ai.run)::text as runs, (select count(*) from approval.draft)::text as drafts")).toEqual(before);
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

  test("the recorded bill flags exactly one price rise, butter, citing the last price paid", async () => {
    const r = await read();
    if (r.result.kind !== "read") throw new Error("read");
    expect(r.result.lines.filter((l) => l.rise).map((l) => l.item)).toEqual(["Butter 100 g"]); // matched by its exact name, no alias taught
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
    script.turns = []; // write mode queued a turn for this call; "again" asks no model
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
      `select p.id::text, p.created_by::text, (select string_agg(i.name || ' ' || pl.qty_milli || ' @ ' || pl.unit_cost_minor, '; ' order by pl.line_no) from books.purchase_line pl join lateral (select r.name from books.item_revision r where r.tenant_id = pl.tenant_id and r.item_id = pl.item_id order by r.effective_from desc, r.created_at desc, r.id desc limit 1) i on true where pl.purchase_id = p.id) as lines
         from books.purchase p where p.supplier_id = $1 and p.bill_no = 'GT-1050'`,
      [gupta],
    );
    expect(bought).toEqual({ id: done.billId, created_by: h.k.owner.memberId, lines: "Glucose biscuits 70 g 48000 @ 850; Butter 100 g 12000 @ 6200" });
  });

  test("a bill the books already hold is said so, with a link to it; nothing is drafted", async () => {
    const drafts = await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft where command = 'purchase.record'");
    const [recorded] = await rows<{ id: string }>(h, "select id::text from books.purchase where supplier_id = $1 and bill_no = 'GT-1050'", [gupta]);
    await page(h.k.owner);
    if (WRITING) script.turns = [reading()];
    fireEvent.change(screen.getByRole("combobox", { name: "Supplier on the bill" }), { target: { value: gupta } });
    fireEvent.change(screen.getByLabelText("Take or choose a photo"), { target: { files: [new File([BILL], "bill.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Read this bill" }));
    const known = await screen.findByText(/is already in your books/, {}, { timeout: 30_000 });
    expect(known.textContent).toBe("Bill GT-1050 from this supplier is already in your books, so nothing was drafted.");
    expect(screen.getByRole("link", { name: "Open the bill" }).getAttribute("href")).toBe(`/app/bills/${recorded?.id}`);
    expect(document.querySelector(".bill-photo .ops-error")).toBeNull(); // said, not an error
    expect(await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft where command = 'purchase.record'")).toEqual(drafts);
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
    const [run] = await rows<{ id: string }>(h, "select id::text from ai.run where trigger = 'photo' order by started_at desc limit 1");
    const all = JSON.stringify(await rows(h, "select kind, label, ids from ai.trace where run_id = $1", [run?.id]));
    expect(all).toContain("bill_read");
    for (const word of ["GT-1050", "Butter", "Masala", "Glucose", "8.50", "2026-10-27"]) expect(all.includes(word), word).toBe(false);
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

// ---- a PDF bill (W2-C) ---------------------------------------------------------------------------------------------
// A PDF goes to the document reader (Sarvam Vision) instead of the image reader; the reason model then names, for each
// figure, the block of the page that holds it, and code takes the figure from that block's text and its place from the
// block. The PDF is made here (one A4 page of Courier text, synthetic): Gupta Traders' GT-1077, two lines.
const PDF_LINES: [number, number, string][] = [
  [72, 770, "Gupta Traders (simulated)  Bill No. GT-1077  Date 2026-10-27"],
  [72, 700, "Glucose biscuits 70 g"],
  [360, 700, "24"],
  [460, 700, "8.50"],
  [72, 670, "Butter 100 g"],
  [360, 670, "6"],
  [460, 670, "60.00"],
];

/** A one-page PDF of the lines above, built byte for byte (its cross-reference offsets counted here). */
function pdfBill(): Uint8Array {
  const text = PDF_LINES.map(([x, y, s]) => `BT /F1 12 Tf ${x} ${y} Td (${s}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  let out = "%PDF-1.4\n";
  const at: number[] = [];
  objects.forEach((o, i) => {
    at.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
const PDF = pdfBill();

// The page as the document reader gives it (its parse JSON: each block's text and its box in the page's points, top-left
// origin), and the reason model's reading: each figure the block it is in and its text there.
const pdfPage = () => ({
  width: 595,
  height: 842,
  blocks: PDF_LINES.map(([x, y, s]) => ({ text: s, bbox: [x, 842 - y - 10, x + s.length * 7, 842 - y + 2] })),
});
const pdfReading = (): Turn => ({
  json: {
    billNo: { block: 1, text: "GT-1077" },
    billDate: { block: 1, text: "2026-10-27" },
    lines: [
      { item: { block: 2, text: "Glucose biscuits 70 g" }, qty: { block: 3, text: "24" }, rate: { block: 4, text: "8.50" } },
      { item: { block: 5, text: "Butter 100 g" }, qty: { block: 6, text: "6" }, rate: { block: 7, text: "60.00" } },
    ],
  },
});

const books = () =>
  rows<{ purchases: string; lines: string; moves: string }>(
    h,
    "select (select count(*) from books.purchase)::text as purchases, (select count(*) from books.purchase_line)::text as lines, (select count(*) from books.stock_move)::text as moves",
  );

test("PDFBILL1 a PDF reads to a purchase draft, each figure read on its page; the books change only once it is approved", async () => {
  signInAs(h.k.owner);
  await clearWaiting();
  const before = await books();
  if (WRITING) script.turns = [{ document: [pdfPage()] }, pdfReading()];
  const r = await readBillAction(null, photoForm(gupta, PDF, "application/pdf"));
  if (!r || !("result" in r) || r.result.kind !== "read") throw new Error(`expected a reading, got ${JSON.stringify(r)}`);
  expect(r.recorded).toBe(true);
  expect(r.result.billNo).toBe("GT-1077");
  expect(r.result.lines.map((l) => [l.printed, l.item, ...[l.qty, l.cost].map((ref) => resolveCell(r.snapshots, ref))])).toEqual([
    ["Glucose biscuits 70 g", "Glucose biscuits 70 g", { t: "qty", milli: 24_000, unit: "pack" }, { t: "money", minor: 850, currency: "INR" }],
    ["Butter 100 g", "Butter 100 g", { t: "qty", milli: 6_000, unit: "pack" }, { t: "money", minor: 6000, currency: "INR" }],
  ]);
  // Each figure is placed where its block is on the page (0–1000 grid).
  expect(r.result.lines.map((l) => [l.qtyAt, l.costAt])).toEqual([
    [{ x1: 605, y1: 157, x2: 629, y2: 171 }, { x1: 773, y1: 157, x2: 820, y2: 171 }],
    [{ x1: 605, y1: 192, x2: 617, y2: 207 }, { x1: 773, y1: 192, x2: 832, y2: 207 }],
  ]);
  const draft = r.result.draft;
  if (!draft) throw new Error("a draft");
  // Read and drafted: the books are as they were.
  expect(await books()).toEqual(before);
  const [read] = await rows<{ model: string }>(h, "select model from ops.bill_read order by created_at desc limit 1");
  expect(read?.model).toBe("sarvam-vision:muse-spark-1.3");
  const [run] = await rows<{ id: string; tainted: boolean }>(h, "select id::text, tainted from ai.run where trigger = 'photo' order by started_at desc limit 1");
  expect(run?.tainted).toBe(true); // it read a supplier's text
  const labels = (await rows<{ label: string }>(h, "select label from ai.trace where run_id = $1 order by seq", [run?.id])).map((x) => x.label);
  expect(labels.slice(0, 2)).toEqual(["document", "reason"]);
  for (const word of ["GT-1077", "Butter", "Glucose", "8.50", "60.00"]) expect(JSON.stringify(labels).includes(word), word).toBe(false);

  const done = await decidePhotoDraft(null, formOf({ draft: draft.id, verdict: "approved" }));
  if (!done || !("draft" in done)) throw new Error(`expected a decision, got ${JSON.stringify(done)}`);
  expect(done.draft.status).toBe("executed");
  const after = await books();
  expect([Number(after[0]?.purchases) - Number(before[0]?.purchases), Number(after[0]?.lines) - Number(before[0]?.lines)]).toEqual([1, 2]);
  const [bought] = await rows<{ created_by: string; lines: string }>(
    h,
    `select p.created_by::text, (select string_agg(pl.qty_milli || ' @ ' || pl.unit_cost_minor, '; ' order by pl.line_no) from books.purchase_line pl where pl.purchase_id = p.id) as lines
       from books.purchase p where p.supplier_id = $1 and p.bill_no = 'GT-1077'`,
    [gupta],
  );
  expect(bought).toEqual({ created_by: h.k.owner.memberId, lines: "24000 @ 850; 6000 @ 6000" });
});

test("PDFBILL2 the bill photo picker takes a PDF", async () => {
  await page(h.k.owner);
  expect(screen.getByLabelText("Take or choose a photo").getAttribute("accept")).toBe("image/png,image/jpeg,application/pdf");
});

// Last in the file: it spends the shop's media calls for the day.
test("MEDIACAP1 once the shop's media calls are spent, a bill photo and a PDF bill are refused as ai_off: no read, nothing stored", async () => {
  signInAs(h.k.owner);
  await clearWaiting();
  while ((await allow(h.db.app, h.k.tenantId, "segment", "on")).ok) {} // spend today's media calls
  const reads = await rows<{ n: string }>(h, "select count(*)::text as n from ops.bill_read");
  for (const [bytes, type] of [[BILL, "image/png"], [PDF, "application/pdf"]] as const) {
    const r = await readBillAction(null, photoForm(gupta, new Uint8Array(bytes), type));
    expect(r && "result" in r && r.result, type).toEqual({ kind: "refused", why: "ai_off" });
  }
  expect(await rows<{ n: string }>(h, "select count(*)::text as n from ops.bill_read")).toEqual(reads);
});
