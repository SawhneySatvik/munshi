// Bill reading (MS-8). The vision model (role `vision`, no tools: quarantined) copies a supplier's bill off a photo:
// its number and date, and per item line the text, the quantity and the unit price as printed, each figure with its
// place on the page (0–1000 grid). Plain code turns the printed figures into whole milli-units and paise; core stores
// them (port.recordBill), matching each line's text to a catalogue item by exact name or alias — never by a model — and
// they come back as cells of bill.lines. The draft is a purchase.record whose every number is a bill cell; a line that
// matched no item stays out of it. A unit price above the last paid (purchases.last_price) is flagged with both cells.
import type { CellRef } from "@munshi/core/read";
import { z } from "zod";
import type { BillReadRecord } from "./port.ts";
import { dataUrl, look, mint, num, type PhotoOptions, ref, stillType, traced, txt } from "./photo.ts";
import { sha256Hex } from "./providers/fixtures.ts";

const Place = z.array(z.number().int()).length(4);
const Read = z.object({
  billNo: z.string().nullable(),
  billDate: z.string().nullable(),
  lines: z
    .array(z.object({ text: z.string(), qty: z.string(), qtyAt: Place.nullable(), rate: z.string(), rateAt: Place.nullable() }))
    .max(60),
});

const READ_BILL = [
  "You read one photo of a supplier's bill to a small shop, and copy what is printed. Never compute, total or correct anything.",
  "Give the bill's number and its date (as YYYY-MM-DD), or null for either you cannot read.",
  "Give every item line, top to bottom: the item's description exactly as printed; its quantity as printed; its unit price (rate) as printed, without a currency sign; and where the quantity and the unit price each are printed on the page, as a box [x_min, y_min, x_max, y_max] on a 0-1000 grid with (0, 0) at the top-left, or null for a box you cannot place.",
  "Leave out totals, taxes, the header and the footer.",
].join("\n");

export type PriceRise = { row: number; itemId: string; billCost: CellRef; lastCost: CellRef };
export type BillResult =
  | {
      kind: "read";
      billId: string;
      /** the bill.lines snapshot: one row a line, in page order */
      snapshotId: string;
      lines: { row: number; itemId: string | null }[];
      priceRises: PriceRise[];
      draftId: string | null;
      /** why there is no draft */
      why: "nothing_matched" | "no_bill_no" | "too_long" | null;
    }
  /** The supplier's bill with this number is already in the books (core refused the draft): nothing is drafted. */
  | { kind: "alreadyRecorded"; billNo: string; /** the recorded purchase, if its bill row can be found (bills.recent, 31 days to the bill's date) */ purchaseId: string | null }
  | { kind: "refused"; why: "not_a_still" | "model_error" | "tool_call" | "unreadable" | "unplaced" | "refused" };

// A printed figure as a whole number of 10^-places units ("8.50" at 2 → 850), or null if it is not a plain decimal
// (digit-group commas, spaces and a rupee sign aside). The shop's currency has two minor digits (INR).
export function printed(s: string, places: number): number | null {
  const m = /^(\d{1,9})(?:\.(\d+))?$/.exec(s.replace(/[,\s₹]/g, ""));
  if (!m || (m[2]?.length ?? 0) > places) return null;
  return Number(m[1]) * 10 ** places + Number((m[2] ?? "").padEnd(places, "0") || "0");
}

// A bill draft cites the bill's number and date, and each item's current on-hand and any last price it rose above:
// with at most 50 cited cells, a bill of more matched items than this is not drafted.
const MAX_DRAFT_ITEMS = 24;

export async function readBill(photo: Uint8Array, o: PhotoOptions & { supplierId: string }): Promise<BillResult> {
  const mime = stillType(photo);
  const refuse = async (why: Extract<BillResult, { kind: "refused" }>["why"]): Promise<BillResult> => {
    await traced(o, "abstain", why);
    return { kind: "refused", why };
  };
  if (!mime) return refuse("not_a_still");

  const seen = await look(o, {
    messages: [
      { role: "system", content: READ_BILL },
      { role: "user", content: "The bill:", imageUrl: dataUrl(mime, photo) },
    ],
    schema: { name: "bill", zod: Read },
  });
  if (seen === "tool_call" || seen === "model_error") return refuse(seen);
  const bill = seen.json as z.infer<typeof Read>;

  const lines: BillReadRecord["lines"] = [];
  for (const l of bill.lines) {
    const qtyMilli = printed(l.qty, 3);
    const unitCostMinor = printed(l.rate, 2);
    if (qtyMilli === null || qtyMilli === 0 || unitCostMinor === null || !l.text.trim()) return refuse("unreadable");
    // A figure with no place on the page cannot be shown where it was read: the whole bill is refused.
    if (!l.qtyAt || !l.rateAt) return refuse("unplaced");
    lines.push({ text: l.text, qtyMilli, qtyAt: l.qtyAt as [number, number, number, number], unitCostMinor, unitCostAt: l.rateAt as [number, number, number, number] });
  }
  if (lines.length === 0) return refuse("unreadable");
  const billDate = bill.billDate !== null && z.iso.date().safeParse(bill.billDate).success ? bill.billDate : null;

  let billId: string;
  try {
    billId = await o.port.recordBill({ supplierId: o.supplierId, photoSha256: sha256Hex(photo), model: seen.model, billNo: bill.billNo?.trim() || null, billDate, lines });
  } catch {
    return refuse("refused");
  }
  await traced(o, "evidence", "bill_read", [billId]);
  return draft(o, billId);
}

async function draft(o: PhotoOptions & { supplierId: string }, billId: string): Promise<BillResult> {
  const read = await mint(o, "bill.lines", { bill_id: billId });
  const at = (row: number, col: string) => ref(read.snapshotId, row, col);
  const lines = read.rows.map((r, row) => ({ row, itemId: txt(r.item_id) }));
  const matched = lines.filter((l): l is { row: number; itemId: string } => l.itemId !== null);

  const basedOn: CellRef[] = [];
  const priceRises: PriceRise[] = [];
  for (const itemId of new Set(matched.map((l) => l.itemId))) {
    const held = await mint(o, "stock.on_hand", { item_id: itemId });
    basedOn.push(ref(held.snapshotId, 0, "on_hand"));
    const last = await mint(o, "purchases.last_price", { item_id: itemId });
    const paid = last.rows[0]?.unit_cost;
    for (const l of matched.filter((m) => m.itemId === itemId)) {
      const cost = read.rows[l.row]?.unit_cost;
      const rose = cost?.kind === "money" && paid?.kind === "money" && cost.currency === paid.currency && Number(cost.num) > Number(paid.num);
      if (rose) priceRises.push({ row: l.row, itemId, billCost: at(l.row, "unit_cost"), lastCost: ref(last.snapshotId, 0, "unit_cost") });
    }
  }
  basedOn.push(...new Map(priceRises.map((p) => [p.lastCost.snapshotId, p.lastCost])).values());
  const result = { kind: "read" as const, billId, snapshotId: read.snapshotId, lines, priceRises };

  const first = read.rows[0];
  const why = matched.length === 0 ? "nothing_matched" : !txt(first?.bill_no) || first?.bill_date?.kind !== "date" ? "no_bill_no" : matched.length > MAX_DRAFT_ITEMS ? "too_long" : null;
  if (why) return { ...result, draftId: null, why };

  const payloadRefs: Record<string, CellRef> = {};
  const payloadLines = matched.map((l, n) => {
    payloadRefs[`lines[${n}].qtyMilli`] = at(l.row, "qty");
    payloadRefs[`lines[${n}].unitCostMinor`] = at(l.row, "unit_cost");
    return { itemId: l.itemId, qtyMilli: num(read.rows[l.row]?.qty), unitCostMinor: num(read.rows[l.row]?.unit_cost) };
  });
  const t0 = (o.now ?? Date.now)();
  const billNo = txt(first?.bill_no) as string;
  const billDate = first?.bill_date?.kind === "date" ? first.bill_date.day : null;
  let draftId: string;
  try {
    draftId = await o.port.propose({
      command: "purchase.record",
      payload: { supplierId: o.supplierId, billNo, billDate, lines: payloadLines },
      basedOn: [at(0, "bill_no"), at(0, "bill_date"), ...basedOn],
      payloadRefs,
    });
  } catch (err) {
    // Core's CoreError('conflict', fields: ['billNo']): this supplier's number is already a purchase. Matched by shape,
    // as the agent imports no core writer.
    const e = err as { code?: unknown; fields?: unknown };
    if (e.code !== "conflict" || !Array.isArray(e.fields) || !e.fields.includes("billNo")) throw err;
    return { kind: "alreadyRecorded", billNo, purchaseId: await recordedPurchase(o, billNo, billDate) };
  }
  await traced(o, "propose", "purchase.record", [draftId], t0);
  return { ...result, draftId, why: null };
}

// The purchase behind a bill the books already hold, from a bills.recent snapshot minted for this run (untraced: it is
// not one of the flow's fixed labels); null when the read does not show it.
async function recordedPurchase(o: PhotoOptions & { supplierId: string }, billNo: string, billDate: string | null): Promise<string | null> {
  if (!billDate) return null;
  try {
    const recent = await o.port.read("bills.recent", { days: 31, as_of: billDate });
    const row = recent.rows.find((r) => txt(r.supplier_id) === o.supplierId && txt(r.bill_no) === billNo);
    return txt(row?.purchase_id);
  } catch {
    return null;
  }
}
