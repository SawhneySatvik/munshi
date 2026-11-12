// The hero chain on screen (server only): a question (typed or spoken), a shelf photo and a bill photo each start an
// agent run through the app's port (agent-port.ts), and what the agent returns is turned into page data whose every
// figure is a SourceRef into a snapshot that run minted, read back as stored. Model words are shown only where the
// agent's own checks passed them: an answer segment that fails renderSegment is "Cannot verify"; a phrase or a bill's
// printed text is shown as the model's reading, never as a figure. Drafts the photos leave are read by core's hero views
// from approval.draft, each figure from its payload ref and only while that cell holds the very number the draft carries.
import "server-only";
import { createHash } from "node:crypto";
import {
  ask,
  askByVoice,
  type BillResult,
  type CheckedSegment,
  type Choice,
  countShelf,
  type DraftFix,
  draftFix,
  explainCard,
  explainFinding,
  readBill,
  type Reply,
  renderSegment,
  type ShelfResult,
} from "@munshi/agent";
import { parseSegments } from "@munshi/ai";
import {
  CANNOT_VERIFY,
  CoreError,
  type Cell,
  type CellRef,
  findingFor,
  type PhotoDraftRow,
  refuseFeatureOff,
  renderCell,
  type Session,
  type StoredSnapshot,
  storedSnapshots,
  supplierList,
  viewAskDate,
  viewPhotoDrafts,
  viewShelfCounts,
  viewWaitingFor,
} from "@munshi/core";
import type { AnswerPart, AskTurn, BillDraft, BillOutcome, BillReadLine, Box, CountDraft, PhotoDraft, ShelfLine, ShelfOutcome, Waiting } from "../hero-types";
import { type HeroDict, heroLabel } from "../i18n-hero";
import type { Column, Snapshot, SourceRef, Supplier } from "../types";
import { agentDeps, inRun, recordedMode, startRun } from "./agent-port";
import { keepAnswer } from "./answers";
import { appPool } from "./db";
import { type Client, cellValue, named, page, suppliers } from "./ledger";

// The source drawer's title, the chip's plain name, and the columns shown, for every read an agent run can mint (a
// person's name stands beside their id: named(), from people.ts).
export const VIEW: Record<string, { title: keyof HeroDict; label: keyof HeroDict; columns: string[]; simulatedSupplier?: true }> = {
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
  "paypal.links": { title: "titlePaypalLinks", label: "labelPaypalLinks", columns: ["customer", "purpose", "state", "messaged", "amount"] },
  "count.shelf": { title: "titleCountShelf", label: "labelShelfPhoto", columns: ["item", "counted", "counted_at"] },
  "bill.lines": {
    title: "titleBillLines",
    label: "labelReadOnBill",
    columns: ["line_no", "bill_no", "bill_date", "item_text", "item", "qty", "unit_cost"],
    simulatedSupplier: true,
  },
};

/** The stored snapshots, in the order asked, as the drawer shows them (the page shows only what snap holds). */
function shown(ids: string[], stored: StoredSnapshot[]): Snapshot[] {
  return [...new Set(ids)].map((id) => {
    const s = stored.find((x) => x.id === id);
    if (!s) throw new Error("hero: a snapshot this run minted is not readable");
    const rows = s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, c]) => [col, cellValue(c)])), s.names));
    const view = VIEW[s.query];
    const first = rows[0] ?? {};
    const keys = view?.columns ?? Object.keys(first).filter((k) => k !== "id" && !k.endsWith("_id"));
    const columns: Column[] = keys.map((key) => {
      const v = first[key];
      return { key, numeric: v?.t === "int" || v?.t === "money" || v?.t === "qty" };
    });
    return {
      id,
      query: s.query,
      readAt: s.readAt,
      title: view ? heroLabel(view.title) : { en: s.query, hi: s.query },
      ...(view?.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows,
    };
  });
}

/** The stored snapshots a run minted, read in one transaction, as the drawer shows them. */
async function storedOf(session: Session, ids: string[]): Promise<Snapshot[]> {
  return ids.length ? shown(ids, await page(session, (c) => storedSnapshots(c, ids))) : [];
}

const labelOf = (snapshots: Snapshot[], snapshotId: string) => heroLabel(VIEW[snapshots.find((s) => s.id === snapshotId)?.query ?? ""]?.label ?? "labelStockLedger");
/** A core ref (row 0-based) as the screen's SourceRef (row 1-based, as the drawer shows it). */
const toRef = (snapshots: Snapshot[], r: CellRef): SourceRef => ({ label: labelOf(snapshots, r.snapshotId), snapshotId: r.snapshotId, row: r.row + 1, col: r.col });

const HANDLE = /⟦([1-9][0-9]{0,2})⟧/g;

/**
 * The person a ref to a customer_id or supplier_id cell stands for: the name core's view read from people.ts with the
 * snapshot (named()), or ERASED; null for any other ref, or a person the snapshot does not name. An answer cites the id
 * (a name is never a cell) and the screen shows the name.
 */
export function personName(snapshots: Snapshot[], ref: CellRef): string | null {
  const party = ref.col === "customer_id" ? "customer" : ref.col === "supplier_id" ? "supplier" : null;
  const v = party && snapshots.find((s) => s.id === ref.snapshotId)?.rows[ref.row]?.[party];
  return v && v.t === "text" && v.v ? v.v : null;
}

// One checked segment as parts: the model's words between handles, each handle the cell it cites; a person's id cell is
// shown as their name (personName). A segment the agent's own renderer refuses (a rule broken, a ref that is an id or no
// name) is one "Cannot verify" part.
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
    if (ref.col === "customer_id" || ref.col === "supplier_id") {
      const name = personName(snapshots, ref);
      if (!name) return [{ t: "cannot" }];
      parts.push({ t: "name", v: name });
      continue;
    }
    parts.push(cell.kind === "text" ? { t: "name", v: renderCell(cell) } : { t: "ref", ref: toRef(snapshots, ref) });
  }
  if (at < text.length) parts.push({ t: "text", v: text.slice(at) });
  return parts;
}

async function turnOf(session: Session, runId: string, via: AskTurn["via"], words: string | null, reply: Reply): Promise<AskTurn> {
  const base = { id: runId, at: new Date().toISOString(), via, words, recorded: recordedMode() };
  if (reply.kind === "abstain") return { ...base, reply: { kind: "abstain", missing: [...reply.missing] }, snapshots: [] };
  await keepAnswer(session, runId, reply); // what Read aloud reads back (speak.ts), never the client's copy
  const snapshots = await storedOf(session, reply.segments.flatMap((s) => s.refs.map((r) => r.snapshotId)));
  return { ...base, reply: { kind: "answer", desk: reply.specialist, segments: reply.segments.map((s) => partsOf(s, snapshots)) }, snapshots };
}

/** A typed question, or a spoken one (WAV bytes), asked of the books as of the shop's business date. */
export async function askBooks(session: Session, input: { via: "text"; question: string } | { via: "voice"; wav: Uint8Array }): Promise<AskTurn> {
  // A spoken question is the voice feature as well as Ask's (its run is a question's, which the database gates as ask).
  const asOf = await page(session, async (c) => {
    if (input.via === "voice") await refuseFeatureOff(c, "voice");
    return viewAskDate(c, session);
  });
  // Before the run starts: a question that cannot begin must not leave a run open for good.
  const deps = agentDeps("ask");
  const run = await startRun(session, "question");
  const o = { port: run.port, asOf, deps: run.deps(deps, "ask") };
  if (input.via === "text") {
    const reply = await inRun(run, () => ask(input.question, o));
    return turnOf(session, run.runId, "text", input.question, reply);
  }
  const heard = await inRun(run, () => askByVoice(input.wav, o));
  return turnOf(session, run.runId, "voice", heard.transcript, heard.reply);
}

/**
 * "Why?" on a finding: its desk explains it from the finding's own row and what it reads (explainFinding), cite or
 * abstain, shown as an Ask answer whose figures are cells. A closed, stale or unknown finding abstains in fixed words, and
 * so does one whose watcher the member's role may not read (core's findingFor): its row is never read.
 */
export async function whyFinding(session: Session, findingId: string): Promise<AskTurn> {
  const asOf = await page(session, (c) => viewAskDate(c, session));
  // Filed under the desk of the watcher that raised it (stock, sales, customers…); `ask` for a finding there is none of.
  const desk = (await findingFor(await appPool(), session, findingId))?.desk ?? "ask";
  const run = await startRun(session, "question", desk);
  const reply = await inRun(run, () => explainFinding(findingId, { port: run.port, asOf, deps: run.deps(agentDeps("finding"), "ask") }));
  return turnOf(session, run.runId, "text", null, reply);
}

/**
 * "Why?" on a card that stands for every open finding of a kind (Home's overdue card): the card's own figure explained
 * (explainCard), filed under the desk of the watcher that raised those findings.
 */
export async function whyCard(session: Session, kind: string, findingIds: string[]): Promise<AskTurn> {
  const asOf = await page(session, (c) => viewAskDate(c, session));
  const first = findingIds[0];
  const desk = (first && (await findingFor(await appPool(), session, first))?.desk) || "ask";
  const run = await startRun(session, "question", desk);
  const reply = await inRun(run, () => explainCard(kind, { port: run.port, asOf, deps: run.deps(agentDeps("finding"), "ask") }));
  return turnOf(session, run.runId, "text", null, reply);
}

// paypal_busy: a PayPal link refused because the customer has a live link, or a paid one the books do not show yet.
export type FixOutcome = { kind: "proposed"; draftId: string } | Extract<DraftFix, { kind: "none" }> | { kind: "none"; reason: "paypal_busy" } | { kind: "error" };

// A recipe run's desk where it is not the recipe desk: Offer it, on stock near its expiry, is the surplus desk's.
const RECIPE_DESK: Record<string, string> = { expiry: "surplus" };

/**
 * "Draft the fix" on a finding row: each finding it stands for gets its kind's recipe (draftFix: no model), in a run of
 * the recipe desk. A draft waits in the tray for a person; nothing here writes a book. Each finding is its own draft:
 * one that fails is an `error` outcome beside the others, so the caller can say which way each went.
 */
export async function fixFindings(session: Session, findingIds: string[], choice?: Choice): Promise<FixOutcome[]> {
  const asOf = await page(session, (c) => viewAskDate(c, session));
  const out: FixOutcome[] = [];
  for (const id of findingIds) {
    try {
      // Offer it (stock near its expiry, given to a recipient) is filed under its own desk, Tally's (lib/cast.ts).
      const kind = (await findingFor(await appPool(), session, id))?.kind;
      const run = await startRun(session, "recipe", kind ? RECIPE_DESK[kind] : undefined);
      const r = await inRun(run, async (): Promise<FixOutcome> => {
        try {
          const made = await draftFix(id, { port: run.port, asOf, deps: agentDeps("finding") }, choice);
          return made.kind === "proposed" ? { kind: "proposed", draftId: made.draftId } : made;
        } catch (err) {
          // A PayPal link core refuses: the customer has a live link, a link draft waiting, or a paid link the books do
          // not show yet. Said so on the card, the run ends well, and the others still get theirs.
          if (choice?.fix === "paypal" && err instanceof CoreError && err.code === "invalid" && (err.fields ?? []).includes("customerId")) return { kind: "none", reason: "paypal_busy" };
          throw err;
        }
      });
      out.push(r);
    } catch {
      out.push({ kind: "error" });
    }
  }
  return out;
}

// ---- the drafts a photo leaves -------------------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === "number" ? String(v) : null);

/**
 * Photo drafts by id, or every stock.count / purchase.record draft still waiting, with the snapshots their figures point
 * into. A figure is shown from its payload ref only while the stored cell holds the payload's very number; otherwise
 * null, and the card says "Cannot verify". `on`: the page's own transaction, when the page reads more than this.
 */
export async function photoDrafts(session: Session, which: { ids: string[] } | { waiting: "stock.count" | "purchase.record" }, on?: Client): Promise<Waiting> {
  const v = on ? await viewPhotoDrafts(on, session, which) : await page(session, (c) => viewPhotoDrafts(c, session, which));
  if (!v) return { drafts: [], snapshots: [] };
  const { drafts, items, stamps } = v;
  const snapshots = shown(
    drafts.flatMap((d) => Object.values(d.payloadRefs).map((r) => r.snapshotId)),
    v.snapshots,
  );
  const firms = suppliers(v.firms);
  // A payload figure's ref, if its stored cell holds exactly that number.
  const held = (d: PhotoDraftRow, at: string): SourceRef | null => {
    const r = d.payloadRefs[at];
    const want = num(at.split(/[.[\]]+/).filter(Boolean).reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], d.payload));
    const cell = r && snapshots.find((s) => s.id === r.snapshotId)?.rows[r.row]?.[r.col];
    const have = cell?.t === "qty" ? String(cell.milli) : cell?.t === "money" ? String(cell.minor) : cell?.t === "int" ? String(cell.v) : null;
    return r && want !== null && have === want ? toRef(snapshots, r) : null;
  };
  const out: PhotoDraft[] = drafts.map((d) => {
    const stamp = stamps.get(d.id);
    const base = { id: d.id, status: d.status as PhotoDraft["status"], decision: stamp ?? null, canDecide: v.viewer.mayRun.has(d.command) };
    if (d.command === "stock.count") {
      return { ...base, command: "stock.count", itemId: String(d.payload.itemId), item: items.get(String(d.payload.itemId)) ?? "", counted: held(d, "countedQtyMilli"), expected: held(d, "expectedQtyMilli") };
    }
    const lines = (d.payload.lines as { itemId: string }[]).map((l, i) => ({
      item: items.get(l.itemId) ?? "",
      qty: held(d, `lines[${i}].qtyMilli`),
      cost: held(d, `lines[${i}].unitCostMinor`),
    }));
    // The bill's number and date are the read bill's own cells (row 0 of its bill.lines snapshot); core refused the
    // draft unless the payload's equal them.
    const bill = Object.values(d.payloadRefs)[0];
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
}

// ---- a shelf photo -------------------------------------------------------------------------------------------------

/** The boxes in a segment model's stored response (parsed by the agent's own parser), and the photo size they are given in. */
export function boxesOf(raw: string): { boxes: Box[]; size: { w: number; h: number } | null } {
  const { matches, imageSize } = parseSegments(raw);
  return { boxes: matches.map((m) => m.box), size: imageSize && { w: imageSize.width, h: imageSize.height } };
}

/**
 * The drafts a photo with these very bytes already left waiting (matched on the photo's sha256 in the run's evidence
 * row, and for a bill its supplier): a repeat photo shows them instead of stacking another. Empty when none waits.
 */
async function waitingFor(session: Session, photo: Uint8Array, kind: { shelf: true } | { bill: string }): Promise<string[]> {
  const sha = createHash("sha256").update(photo).digest("hex");
  return page(session, (c) => viewWaitingFor(c, sha, kind));
}

/** Counts a shelf photo: each counted item against the books, SAM's boxes, and the stock.count drafts for the gaps. */
export async function countShelfPhoto(session: Session, photo: Uint8Array): Promise<{ result: ShelfOutcome; snapshots: Snapshot[] }> {
  const again = await waitingFor(session, photo, { shelf: true });
  if (again.length) {
    const waiting = await photoDrafts(session, { ids: again });
    return { result: { kind: "again", drafts: waiting.drafts.filter((d): d is CountDraft => d.command === "stock.count") }, snapshots: waiting.snapshots };
  }
  const run = await startRun(session, "photo", "shelf");
  const r: ShelfResult = await inRun(run, () => countShelf(photo, { port: run.port, deps: run.deps(agentDeps("shelf"), "shelf") }));
  if (r.kind === "refused") return { result: { kind: "refused", why: r.why }, snapshots: [] };
  const counted = r;
  const drafts = await photoDrafts(session, { ids: counted.counts.flatMap((x) => (x.draftId ? [x.draftId] : [])) });
  const snapshotIds = counted.counts.flatMap((x) => [x.counted.snapshotId, x.onHand.snapshotId]);
  const itemIds = [...counted.counts.map((x) => x.itemId), ...counted.uncounted.map((x) => x.itemId)];
  const found = await page(session, (c) => viewShelfCounts(c, snapshotIds, itemIds, counted.counts.map((x) => x.countId)));
  const { names, raws } = found;
  const snapshots = snapshotIds.length ? shown(snapshotIds, found.snapshots) : [];
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

/** The suppliers a bill can be from, for the picker. `on`: the page's own transaction. */
export async function billSuppliers(session: Session, on?: Client): Promise<Array<{ id: string } & Supplier>> {
  return [...suppliers(on ? await supplierList(on) : await page(session, (c) => supplierList(c)))].map(([id, s]) => ({ id, ...s }));
}

/** Reads a bill photo for the supplier the person named: its lines as cells, price rises, and the purchase.record draft. */
export async function readBillPhoto(session: Session, photo: Uint8Array, supplierId: string): Promise<{ result: BillOutcome; snapshots: Snapshot[] }> {
  const again = await waitingFor(session, photo, { bill: supplierId });
  if (again.length) {
    const waiting = await photoDrafts(session, { ids: again });
    return { result: { kind: "again", drafts: waiting.drafts.filter((d): d is BillDraft => d.command === "purchase.record") }, snapshots: waiting.snapshots };
  }
  const run = await startRun(session, "photo", "bills");
  const r: BillResult = await inRun(run, () => readBill(photo, { port: run.port, deps: run.deps(agentDeps("bill"), "bills"), supplierId }));
  if (r.kind === "alreadyRecorded") return { result: { kind: "recorded", billNo: r.billNo, billId: r.purchaseId }, snapshots: [] };
  if (r.kind === "refused") return { result: { kind: "refused", why: r.why }, snapshots: [] };
  const read = r;
  const drafts = await photoDrafts(session, { ids: read.draftId ? [read.draftId] : [] });
  const snapshots = await storedOf(session, [read.snapshotId, ...read.priceRises.map((p) => p.lastCost.snapshotId)]);
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
