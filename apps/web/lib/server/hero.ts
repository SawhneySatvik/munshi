// The hero chain on screen (server only): a question (typed or spoken), a shelf photo and a bill photo each start an
// agent run through the app's port (agent-port.ts), and what the agent returns is turned into page data whose every
// figure is a SourceRef into a snapshot that run minted, read back as stored. Model words are shown only where the
// agent's own checks passed them: an answer segment that fails renderSegment is "Cannot verify"; a phrase or a bill's
// printed text is shown as the model's reading, never as a figure. Drafts the photos leave are read from
// approval.draft, each figure from its payload ref and only while that cell holds the very number the draft carries.
import {
  ask,
  askByVoice,
  type BillResult,
  type CheckedSegment,
  countShelf,
  readBill,
  type Reply,
  renderSegment,
  type ShelfResult,
} from "@munshi/agent";
import { CANNOT_VERIFY, type Cell, type CellRef, CELL_COLUMNS, type CellRow, CoreError, cellFromRow, renderCell, type Session } from "@munshi/core";
import type { AnswerPart, AskTurn, BillOutcome, BillReadLine, Box, CountDraft, PhotoDraft, ShelfLine, ShelfOutcome, Waiting } from "../hero-types";
import { type HeroDict, heroLabel } from "../i18n-hero";
import type { Column, Snapshot, SourceRef, Supplier } from "../types";
import { agentDeps, endRun, recordedMode, startRun } from "./agent-port";
import { asOfDate, cellValue, type Client, me, readOnly, suppliers } from "./ledger";

// The source drawer's title, the chip's plain name, and the columns shown, for every read an agent run can mint.
const VIEW: Record<string, { title: keyof HeroDict; label: keyof HeroDict; columns: string[]; simulatedSupplier?: true }> = {
  "sales.by_day": { title: "titleSalesByDay", label: "labelCounterSales", columns: ["day", "bills", "total", "cash", "upi", "card", "on_credit"] },
  "sales.by_item": { title: "titleSalesByItem", label: "labelCounterSales", columns: ["item", "sold", "revenue", "bills"] },
  "items.list": { title: "titleItems", label: "labelStockLedger", columns: ["item", "category", "on_hand"] },
  "stock.on_hand": { title: "titleOnHand", label: "labelStockLedger", columns: ["item", "on_hand"] },
  "stock.below_reorder": { title: "titleLow", label: "labelStockLedger", columns: ["item", "on_hand", "sold_28d", "days_cover", "suggested", "supplier"] },
  "purchases.last_price": {
    title: "titleLastPrice",
    label: "labelEarlierBills",
    columns: ["item", "supplier", "bill_no", "bill_date", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "purchases.price_history": {
    title: "titlePriceHistory",
    label: "labelEarlierBills",
    columns: ["item", "bill_date", "bill_no", "supplier", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
  "bills.recent": { title: "titleBillsRecent", label: "labelPurchaseBills", columns: ["bill_no", "bill_date", "supplier", "lines", "total"], simulatedSupplier: true },
  "credit.balances": { title: "titleBalances", label: "labelCreditBook", columns: ["customer", "balance", "overdue", "oldest_due_on"] },
  "credit.balance": { title: "titleBalance", label: "labelCreditBook", columns: ["customer", "balance"] },
  "count.shelf": { title: "titleCountShelf", label: "labelShelfPhoto", columns: ["item", "counted", "counted_at"] },
  "bill.lines": {
    title: "titleBillLines",
    label: "labelReadOnBill",
    columns: ["line_no", "bill_no", "bill_date", "item_text", "item", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
};

/** The stored snapshots, in the order asked, as the drawer shows them (the page shows only what snap holds). */
export async function storedSnapshots(c: Client, ids: string[]): Promise<Snapshot[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { rows: snaps } = await c.query<{ id: string; query_name: string; created_at: Date }>(
    "select id::text, query_name, created_at from snap.snapshot where id = any($1::uuid[])",
    [unique],
  );
  const { rows: cells } = await c.query<CellRow & { snapshot_id: string; row_no: number; col: string }>(
    `select snapshot_id::text, row_no, col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = any($1::uuid[])`,
    [unique],
  );
  return unique.map((id) => {
    const s = snaps.find((x) => x.id === id);
    if (!s) throw new Error("hero: a snapshot this run minted is not readable");
    const rows: Snapshot["rows"] = [];
    for (const r of cells.filter((x) => x.snapshot_id === id)) rows[r.row_no] = { ...(rows[r.row_no] ?? {}), [r.col]: cellValue(cellFromRow(r)) };
    const dense = Array.from(rows, (row) => row ?? {});
    const view = VIEW[s.query_name];
    const first = dense[0] ?? {};
    const keys = view?.columns ?? Object.keys(first).filter((k) => k !== "id" && !k.endsWith("_id"));
    const columns: Column[] = keys.map((key) => {
      const v = first[key];
      return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
    });
    return {
      id,
      query: s.query_name,
      readAt: s.created_at.toISOString(),
      title: view ? heroLabel(view.title) : { en: s.query_name, hi: s.query_name },
      ...(view?.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows: dense,
    };
  });
}

const labelOf = (snapshots: Snapshot[], snapshotId: string) => heroLabel(VIEW[snapshots.find((s) => s.id === snapshotId)?.query ?? ""]?.label ?? "labelStockLedger");
/** A core ref (row 0-based) as the screen's SourceRef (row 1-based, as the drawer shows it). */
const toRef = (snapshots: Snapshot[], r: CellRef): SourceRef => ({ label: labelOf(snapshots, r.snapshotId), snapshotId: r.snapshotId, row: r.row + 1, col: r.col });

const HANDLE = /⟦([1-9][0-9]{0,2})⟧/g;

// One checked segment as parts: the model's words between handles, each handle the cell it cites. A segment the agent's
// own renderer refuses (a rule broken, a ref that is an id or no name) is one "Cannot verify" part.
export function partsOf(seg: CheckedSegment, snapshots: Snapshot[]): AnswerPart[] {
  if (renderSegment(seg) === CANNOT_VERIFY) return [{ t: "cannot" }];
  const text = seg.text.normalize("NFKC").replace(/\p{Cf}/gu, "");
  const parts: AnswerPart[] = [];
  let at = 0;
  for (const m of text.matchAll(HANDLE)) {
    if (m.index > at) parts.push({ t: "text", v: text.slice(at, m.index) });
    at = m.index + m[0].length;
    const k = Number(m[1]) - 1;
    const ref = seg.refs[k];
    const cell: Cell | undefined = seg.cells[k];
    if (!ref || !cell || cell.kind === "null") return [{ t: "cannot" }];
    parts.push(cell.kind === "text" ? { t: "name", v: renderCell(cell) } : { t: "ref", ref: toRef(snapshots, ref) });
  }
  if (at < text.length) parts.push({ t: "text", v: text.slice(at) });
  return parts;
}

async function turnOf(session: Session, runId: string, via: AskTurn["via"], words: string | null, reply: Reply): Promise<AskTurn> {
  const base = { id: runId, at: new Date().toISOString(), via, words, recorded: recordedMode() };
  if (reply.kind === "abstain") return { ...base, reply: { kind: "abstain", missing: [...reply.missing] }, snapshots: [] };
  const ids = reply.segments.flatMap((s) => s.refs.map((r) => r.snapshotId));
  const snapshots = await readOnly(session, (c) => storedSnapshots(c, ids));
  return { ...base, reply: { kind: "answer", desk: reply.specialist, segments: reply.segments.map((s) => partsOf(s, snapshots)) }, snapshots };
}

/** A typed question, or a spoken one (WAV bytes), asked of the books as of the shop's business date. */
export async function askBooks(session: Session, input: { via: "text"; question: string } | { via: "voice"; wav: Uint8Array }): Promise<AskTurn> {
  const asOf = await readOnly(session, async (c) => asOfDate(c, (await me(c, session)).timeZone));
  const run = await startRun(session, "question");
  try {
    const o = { port: run.port, asOf, deps: agentDeps("ask") };
    if (input.via === "text") return await turnOf(session, run.runId, "text", input.question, await ask(input.question, o));
    const heard = await askByVoice(input.wav, o);
    return await turnOf(session, run.runId, "voice", heard.transcript, heard.reply);
  } finally {
    await endRun(run);
  }
}

// ---- the drafts a photo leaves -------------------------------------------------------------------------------------

type DraftRow = { id: string; command_type: string; payload: Record<string, unknown>; payload_refs: Record<string, CellRef>; status: PhotoDraft["status"] };

const num = (v: unknown) => (typeof v === "number" ? String(v) : null);

/**
 * Photo drafts by id, or every stock.count / purchase.record draft still waiting, with the snapshots their figures point
 * into. A figure is shown from its payload ref only while the stored cell holds the payload's very number; otherwise
 * null, and the card says "Cannot verify".
 */
export async function photoDrafts(session: Session, which: { ids: string[] } | { waiting: "stock.count" | "purchase.record" }): Promise<Waiting> {
  return readOnly(session, async (c) => {
    const { rows } =
      "ids" in which
        ? await c.query<DraftRow>(
            "select id::text, command_type, payload, payload_refs, status from approval.draft where id = any($1::uuid[]) order by created_at",
            [which.ids],
          )
        : await c.query<DraftRow>(
            "select id::text, command_type, payload, payload_refs, status from approval.draft where command_type = $1 and status = 'proposed' and run_id is not null order by created_at",
            [which.waiting],
          );
    const drafts = rows.filter((d) => d.command_type === "stock.count" || d.command_type === "purchase.record");
    if (!drafts.length) return { drafts: [], snapshots: [] };
    const snapshots = await storedSnapshots(c, drafts.flatMap((d) => Object.values(d.payload_refs).map((r) => r.snapshotId)));
    const m = await me(c, session);
    const firms = await suppliers(c);
    const itemIds = drafts.flatMap((d) =>
      d.command_type === "stock.count" ? [String(d.payload.itemId)] : ((d.payload.lines as { itemId: string }[] | undefined) ?? []).map((l) => l.itemId),
    );
    const items = new Map(
      (await c.query<{ id: string; name: string }>("select id::text, name from books.item where id = any($1::uuid[])", [itemIds.filter((i) => /^[0-9a-f-]{36}$/.test(i))])).rows.map(
        (i) => [i.id, i.name],
      ),
    );
    const { rows: stamps } = await c.query<{ draft_id: string; at: Date; by: string }>(
      `select distinct on (a.entity_id) a.entity_id::text as draft_id, a.created_at as at, m.name as by
         from audit.audit_log a join ops.member m on m.tenant_id = a.tenant_id and m.id = a.actor_id
        where a.entity = 'approval.draft' and a.entity_id = any($1::uuid[]) and a.action in ('draft.executed', 'draft.rejected', 'draft.stale')
        order by a.entity_id, a.seq desc`,
      [drafts.map((d) => d.id)],
    );
    // A payload figure's ref, if its stored cell holds exactly that number.
    const held = (d: DraftRow, at: string): SourceRef | null => {
      const r = d.payload_refs[at];
      const want = num(at.split(/[.[\]]+/).filter(Boolean).reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], d.payload));
      const cell = r && snapshots.find((s) => s.id === r.snapshotId)?.rows[r.row]?.[r.col];
      const have = cell?.t === "qty" ? String(cell.milli) : cell?.t === "money" ? String(cell.minor) : cell?.t === "int" ? String(cell.v) : null;
      return r && want !== null && have === want ? toRef(snapshots, r) : null;
    };
    const out: PhotoDraft[] = drafts.map((d) => {
      const stamp = stamps.find((s) => s.draft_id === d.id);
      const base = { id: d.id, status: d.status, decision: stamp ? { by: stamp.by, at: stamp.at.toISOString() } : null, canDecide: m.mayRun.has(d.command_type) };
      if (d.command_type === "stock.count") {
        return { ...base, command: "stock.count", itemId: String(d.payload.itemId), item: items.get(String(d.payload.itemId)) ?? "", counted: held(d, "countedQtyMilli"), expected: held(d, "expectedQtyMilli") };
      }
      const lines = (d.payload.lines as { itemId: string }[]).map((l, i) => ({
        item: items.get(l.itemId) ?? "",
        qty: held(d, `lines[${i}].qtyMilli`),
        cost: held(d, `lines[${i}].unitCostMinor`),
      }));
      // The bill's number and date are the read bill's own cells (row 0 of its bill.lines snapshot); core refused the
      // draft unless the payload's equal them.
      const bill = Object.values(d.payload_refs)[0];
      const billSnap = bill && snapshots.find((s) => s.id === bill.snapshotId);
      const no = billSnap?.rows[0]?.bill_no;
      const date = billSnap?.rows[0]?.bill_date;
      const supplier: Supplier = firms.get(String(d.payload.supplierId)) ?? { name: "", simulated: true };
      return {
        ...base,
        command: "purchase.record",
        supplier,
        billNo: no?.t === "text" && no.v === d.payload.billNo ? no.v : "",
        billDate: billSnap && date?.t === "date" && date.v === d.payload.billDate ? toRef(snapshots, { snapshotId: billSnap.id, row: 0, col: "bill_date" }) : null,
        lines,
      };
    });
    return { drafts: out, snapshots };
  });
}

// ---- a shelf photo -------------------------------------------------------------------------------------------------

const RECORD = /\d+<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g;

/** The boxes in a segment model's stored response, and the photo size they are given in. */
export function boxesOf(raw: string): { boxes: Box[]; size: { w: number; h: number } | null } {
  const boxes: Box[] = [];
  let size: { w: number; h: number } | null = null;
  for (const m of raw.matchAll(RECORD)) {
    const [x1, y1, x2, y2, w, h] = m.slice(1).map(Number) as [number, number, number, number, number, number];
    boxes.push({ x1, y1, x2, y2 });
    size ??= { w, h };
  }
  return { boxes, size };
}

/** Counts a shelf photo: each counted item against the books, SAM's boxes, and the stock.count drafts for the gaps. */
export async function countShelfPhoto(session: Session, photo: Uint8Array): Promise<{ result: ShelfOutcome; snapshots: Snapshot[] }> {
  const run = await startRun(session, "photo");
  let r: ShelfResult;
  try {
    r = await countShelf(photo, { port: run.port, deps: agentDeps("shelf") });
  } finally {
    await endRun(run);
  }
  if (r.kind === "refused") return { result: { kind: "refused", why: r.why }, snapshots: [] };
  const counted = r;
  const drafts = await photoDrafts(session, { ids: counted.counts.flatMap((x) => (x.draftId ? [x.draftId] : [])) });
  const { snapshots, names, raws } = await readOnly(session, async (c) => {
    const snapshots = await storedSnapshots(c, counted.counts.flatMap((x) => [x.counted.snapshotId, x.onHand.snapshotId]));
    const ids = [...counted.counts.map((x) => x.itemId), ...counted.uncounted.map((x) => x.itemId)];
    const names = new Map((await c.query<{ id: string; name: string }>("select id::text, name from books.item where id = any($1::uuid[])", [ids])).rows.map((i) => [i.id, i.name]));
    const raws = new Map(
      (await c.query<{ id: string; raw: string }>("select id::text, raw from ops.shelf_count where id = any($1::uuid[])", [counted.counts.map((x) => x.countId)])).rows.map((x) => [x.id, x.raw]),
    );
    return { snapshots, names, raws };
  });
  const lines: ShelfLine[] = counted.counts.map((x) => ({
    itemId: x.itemId,
    item: names.get(x.itemId) ?? "",
    counted: toRef(snapshots, x.counted),
    onHand: toRef(snapshots, x.onHand),
    gap: x.gap,
    ...boxesOf(raws.get(x.countId) ?? ""),
    draft: (drafts.drafts.find((d) => d.id === x.draftId) as CountDraft | undefined) ?? null,
  }));
  return {
    result: { kind: "counted", lines, uncounted: counted.uncounted.map((u) => ({ item: names.get(u.itemId) ?? "", why: u.why })), unrecognised: counted.unrecognised },
    snapshots: [...snapshots, ...drafts.snapshots],
  };
}

// ---- a bill photo --------------------------------------------------------------------------------------------------

const intOf = (s: Snapshot, row: number, col: string) => {
  const v = s.rows[row]?.[col];
  return v?.t === "int" ? v.v : null;
};
const placeOf = (s: Snapshot, row: number, p: "qty" | "cost"): Box | null => {
  const [x1, y1, x2, y2] = ["x0", "y0", "x1", "y1"].map((k) => intOf(s, row, `${p}_${k}`));
  return x1 != null && y1 != null && x2 != null && y2 != null ? { x1, y1, x2, y2 } : null;
};
const textAt = (s: Snapshot, row: number, col: string) => {
  const v = s.rows[row]?.[col];
  return v?.t === "text" ? v.v : null;
};

/** The suppliers a bill can be from, for the picker. */
export async function billSuppliers(session: Session): Promise<Array<{ id: string } & Supplier>> {
  return readOnly(session, async (c) => [...(await suppliers(c))].map(([id, s]) => ({ id, ...s })));
}

/** Reads a bill photo for the supplier the person named: its lines as cells, price rises, and the purchase.record draft. */
export async function readBillPhoto(session: Session, photo: Uint8Array, supplierId: string): Promise<{ result: BillOutcome; snapshots: Snapshot[] }> {
  const run = await startRun(session, "photo");
  let r: BillResult;
  try {
    r = await readBill(photo, { port: run.port, deps: agentDeps("bill"), supplierId });
  } catch (err) {
    // Core refuses a purchase.record draft for a bill this supplier's books already hold (MS-12), and readBill lets
    // that through: the screen says the bill is already in the books and opens it. The bill as read is this run's
    // evidence row; the recorded one is the live purchase with its supplier and number.
    if (!(err instanceof CoreError && err.code === "conflict" && err.fields?.includes("billNo"))) throw err;
    const known = await readOnly(session, async (c) => {
      const { rows } = await c.query<{ bill_no: string; purchase_id: string | null }>(
        `select br.bill_no, (select p.id::text from books.purchase p where p.supplier_id = br.supplier_id and p.bill_no = br.bill_no and p.reverses_id is null limit 1) as purchase_id
           from ops.bill_read br where br.run_id = $1 order by br.created_at desc limit 1`,
        [run.runId],
      );
      return rows[0];
    });
    return { result: { kind: "recorded", billNo: known?.bill_no ?? "", billId: known?.purchase_id ?? null }, snapshots: [] };
  } finally {
    await endRun(run);
  }
  if (r.kind === "refused") return { result: { kind: "refused", why: r.why }, snapshots: [] };
  const read = r;
  const drafts = await photoDrafts(session, { ids: read.draftId ? [read.draftId] : [] });
  const snapshots = await readOnly(session, (c) => storedSnapshots(c, [read.snapshotId, ...read.priceRises.map((p) => p.lastCost.snapshotId)]));
  const bill = snapshots[0] as Snapshot;
  const lines: BillReadLine[] = read.lines.map(({ row }) => {
    const rise = read.priceRises.find((p) => p.row === row);
    return {
      printed: textAt(bill, row, "item_text") ?? "",
      item: textAt(bill, row, "item"),
      qty: toRef(snapshots, { snapshotId: bill.id, row, col: "qty" }),
      cost: toRef(snapshots, { snapshotId: bill.id, row, col: "unit_cost" }),
      rise: rise ? { was: toRef(snapshots, rise.lastCost) } : null,
      qtyAt: placeOf(bill, row, "qty"),
      costAt: placeOf(bill, row, "cost"),
    };
  });
  const date = bill.rows[0]?.bill_date;
  return {
    result: {
      kind: "read",
      billNo: textAt(bill, 0, "bill_no") ?? "",
      billDate: date?.t === "date" ? toRef(snapshots, { snapshotId: bill.id, row: 0, col: "bill_date" }) : null,
      lines,
      draft: (drafts.drafts[0] as PhotoDraft | undefined)?.command === "purchase.record" ? (drafts.drafts[0] as Extract<PhotoDraft, { command: "purchase.record" }>) : null,
      why: read.why,
    },
    snapshots: [...snapshots, ...drafts.snapshots],
  };
}
