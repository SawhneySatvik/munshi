// The owner home, read from the books (server only). Every figure on it is a ref into a stored snapshot cell: the
// watchers' findings point at their snapshot rows, the overdue-credit card at its credit.overdue_total snapshot, and a
// draft's quantity at its payload ref (the cell core checked holds it). The snapshots' rows travel with the page so the source drawer shows the very
// row. All of it is read by core's viewHome in one transaction under the signed-in member; the only write is minting the
// brief's credit.overdue_total once per business date (a snapshot, through core's mint).
import { EXPLAINED_KINDS, PAYPAL_FIX_KINDS, RECIPE_KINDS, RECIPE_READS } from "@munshi/agent";
import { paypalReady } from "@munshi/core/paypal";
import { paypalMode } from "./paypal";
import { type Cell, type CellRef, type Checklist, gettingStartedIn, type HomeView, parseRef, type Session, spendBanner, type StoredSnapshot, type TrayDraft, viewHome, WATCHERS, withPage } from "@munshi/core";
import { DICT, type Dict, fillText } from "../i18n";
import { AGENTS } from "../i18n-agents";
import type { CellValue, Column, Draft, Finding, Lang, Localized, MessagePart, OwnerHome, PaypalMode, Snapshot, SourceRef, TrayCard, WordPart } from "../types";
import { appPool } from "./db";
import { named } from "./ledger";

// The drawer's title and columns for each read the home shows: ids stay out, and every column a chip on the home points
// at is in (the drawer highlights it).
const DRAWER: Record<string, { title: keyof Dict; columns: string[]; simulatedSupplier?: boolean }> = {
  "watch.shrinkage": { title: "titleShrinkage", columns: ["item", "expected", "counted", "missing"] },
  "watch.price_creep": { title: "titlePriceCreep", columns: ["item", "baseline_cost", "latest_cost"], simulatedSupplier: true },
  "watch.expiry": { title: "titleExpiry", columns: ["item", "days_left", "remaining", "at_risk_value"] },
  "credit.overdue_total": { title: "titleOverdue", columns: ["customers", "overdue", "credit_days"] },
  "watch.short_settlement": { title: "titleShortSettlement", columns: ["business_date", "received", "settled", "short"] },
};
const KIND_ORDER = ["shrinkage", "price_creep", "overdue_credit", "expiry", "short_settlement"];
// The brief ranks findings by rupees at stake, read from the watcher's own money cell for the kind (the stored column, never
// computed): shrinkage `loss`, expiry `at_risk_value`, short settlement `short`; the overdue card's own `overdue` cell in its
// credit.overdue_total snapshot. price_creep has no such column (a per-unit cost and a percentage; the stake would need
// quantity x rise, a number no cell holds), so it ranks after every finding that has one.

// A line whose number has no source in the books: there is no bank statement import, so Munshi cannot say what the bank
// received.
const UNVERIFIED = [
  {
    what: { en: "UPI received yesterday", hi: "कल आया UPI भुगतान" },
    reason: { en: "the bank statement has not been imported", hi: "बैंक स्टेटमेंट अभी नहीं आया" },
  },
];

const label = (key: keyof Dict, slots: Record<Lang, Record<string, string>> = { en: {}, hi: {} }): Localized => ({
  en: fillText(DICT.en[key], slots.en),
  hi: fillText(DICT.hi[key], slots.hi),
});

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
const supplierName = (name: string, simulated: boolean) => (simulated ? name.replace(/\s*\(simulated\)$/, "") : name);

function safe(num: string): number {
  const n = Number(num);
  if (!Number.isSafeInteger(n)) throw new Error("home: a stored figure is out of range");
  return n;
}

function cellValue(cell: Cell): CellValue {
  switch (cell.kind) {
    case "integer":
      return { t: "int", v: safe(cell.num) };
    case "money":
      return { t: "money", minor: safe(cell.num), currency: cell.currency };
    case "quantity":
      return { t: "qty", milli: safe(cell.num), unit: cell.unit };
    case "text":
      return { t: "text", v: cell.txt };
    case "date":
      return { t: "date", v: cell.day };
    case "timestamp":
      return { t: "time", v: cell.at };
    case "null":
      return { t: "null" };
  }
}

export async function loadHome(session: Session): Promise<OwnerHome> {
  const { v, paypal, spend } = await withPage(await appPool(), session, async (c) => ({
    v: await viewHome(c, session),
    paypal: await paypalReady(c),
    spend: await spendBanner(c),
  }));
  return { ...homeOf(v, paypal ? paypalMode() : null), ...(spend ? { spendState: spend } : {}) };
}

/** The home and a real shop's Getting started (onboarding), in the page's one transaction. */
export async function loadHomeAndStart(session: Session): Promise<{ data: OwnerHome; start: Checklist | null }> {
  // The AI budget's banner: from most of this month's budget, for the office's roles, from a minted cell.
  const { v, start, paypal, spend } = await withPage(await appPool(), session, async (c) => ({
    v: await viewHome(c, session),
    start: await gettingStartedIn(c, session.tenantId),
    paypal: await paypalReady(c),
    spend: await spendBanner(c),
  }));
  return { data: { ...homeOf(v, paypal ? paypalMode() : null), ...(spend ? { spendState: spend } : {}) }, start };
}

/**
 * The home as the screen shows it, from core's viewHome (the suppliers page reads the same view in its own page).
 * `paypal`: PayPal is wired (paypalReady), in this mode, so overdue udhaar's fix may also be a PayPal link, for a member
 * who may propose one; null: not wired.
 */
export function homeOf(v: HomeView, paypal: PaypalMode | null = null): OwnerHome {
  const { viewer: me, brief, findings, drafts } = v;
  const byId = new Map(v.snapshots.map((s) => [s.id, s]));
  const cell = (snapshotId: string, row: number, col: string): Cell | undefined => byId.get(snapshotId)?.rows[row]?.[col];
  const text = (snapshotId: string, row: number, col: string) => {
    const c = cell(snapshotId, row, col);
    return c?.kind === "text" ? c.txt : "";
  };
  const suppliers = new Map([...v.suppliers].map(([id, s]) => [id, { name: supplierName(s.name, s.simulated), simulated: s.simulated }]));
  const ref = (l: Localized, snapshotId: string, row: number, col: string): SourceRef => ({ label: l, snapshotId, row: row + 1, col });
  const shown: { finding: Finding; stake: bigint | null }[] = [];
  const stakeOf = (snapshotId: string, row: number, col: string) => {
    const c = cell(snapshotId, row, col);
    return c?.kind === "money" ? BigInt(c.num) : null; // compared, never added or multiplied
  };
  let overdueShown = false;
  // A row's moves (Why?, Draft the fix, Snooze, Dismiss): the overdue card stands for every overdue customer's finding.
  const overdueIds = findings.filter((f) => f.kind === "overdue_credit").map((f) => f.id);
  const quiet = me.member.role === "owner" || me.member.role === "manager";
  // A finding shows only to a role that may read its watcher (core's viewHome); its fix only where the member may make
  // every read the recipe makes (staff are not offered a reorder, which reads the last bill).
  // Why? and a fix hand the finding's whole row to a model or a draft: offered only to a member who sees it whole
  // (counter staff see a stock finding in quantities, never its cost: core's map).
  const whole = (kind: string) => v.whole.has(WATCHERS.find((w) => w.kind === kind)?.query ?? "");
  const fixable = (kind: string) => RECIPE_KINDS.includes(kind) && (RECIPE_READS[kind] ?? []).every((q) => v.reads.has(q));
  const moves = (kind: string, ids: string[]) => {
    const fix = fixable(kind) && whole(kind);
    // A PayPal link (sandbox) beside the reminder: offered only where the member's role holds paypal.request.
    const link = fix && paypal && PAYPAL_FIX_KINDS.includes(kind) && me.mayRun.has("paypal.request");
    return { ids, why: EXPLAINED_KINDS.includes(kind) && whole(kind), fix, quiet, ...(link && paypal ? { paypal } : {}) };
  };
  const ordered = [...findings].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const f of ordered) {
    const [s, r] = [f.snapshotId, f.snapshotRow];
    switch (f.kind) {
      case "shrinkage":
        shown.push({
          stake: stakeOf(s, r, "loss"),
          finding: {
            kind: "shelf_gap",
            id: f.id,
            ...moves(f.kind, [f.id]),
            item: text(s, r, "item"),
            books: ref(label("labelStockLedger"), s, r, "expected"),
            shelf: ref(label("labelStockCount"), s, r, "counted"),
          },
        });
        break;
      case "price_creep": {
        const supplier = suppliers.get(text(s, r, "supplier_id")) ?? { name: "", simulated: true };
        shown.push({
          stake: null,
          finding: {
            kind: "price_rise",
            id: f.id,
            ...moves(f.kind, [f.id]),
            item: text(s, r, "item"),
            supplier,
            was: ref(label("labelEarlierBills"), s, r, "baseline_cost"),
            now: ref(label("labelSupplierBill", { en: { supplier: possessive(supplier.name) }, hi: { supplier: supplier.name } }), s, r, "latest_cost"),
          },
        });
        break;
      }
      case "overdue_credit": // one card for all overdue customers, its figures from the brief's credit.overdue_total
        if (overdueShown || !brief?.totalId) break;
        overdueShown = true;
        shown.push({
          stake: stakeOf(brief.totalId, 0, "overdue"),
          finding: {
            kind: "overdue_credit",
            id: f.id,
            ...moves(f.kind, overdueIds),
            card: "overdue_credit",
            customers: ref(label("labelCreditBook"), brief.totalId, 0, "customers"),
            owed: ref(label("labelCreditBook"), brief.totalId, 0, "overdue"),
            days: ref(label("labelCreditBook"), brief.totalId, 0, "credit_days"),
          },
        });
        break;
      case "expiry": {
        const m = moves(f.kind, [f.id]);
        shown.push({
          stake: stakeOf(s, r, "at_risk_value"),
          finding: {
            kind: "expiry",
            id: f.id,
            ...m,
            // Its fix is "Offer it": to one of the shop's recipients (simulated, every one), the person's pick.
            ...(m.fix ? { offer: v.recipients } : {}),
            item: text(s, r, "item"),
            left: ref(label("labelStockLedger"), s, r, "remaining"),
            days: ref(label("labelPurchaseBill"), s, r, "days_left"),
            // The value at risk is the office's (core cut it from a counter member's row): no figure without its cell.
            value: cell(s, r, "at_risk_value") ? ref(label("labelStockLedger"), s, r, "at_risk_value") : null,
          },
        });
        break;
      }
      case "short_settlement":
        shown.push({
          stake: stakeOf(s, r, "short"),
          finding: {
            kind: "short_settlement",
            id: f.id,
            ...moves(f.kind, [f.id]),
            day: ref(label("labelUpiSettlement"), s, r, "business_date"),
            short: ref(label("labelUpiSettlement"), s, r, "short"),
          },
        });
        break;
    }
  }
  // Most rupees first, those with no money cell last; the sort is stable, so ties keep the kind order above.
  shown.sort((a, b) => (a.stake === b.stake ? 0 : a.stake === null ? 1 : b.stake === null ? -1 : a.stake > b.stake ? -1 : 1));

  const cards: Draft[] = drafts.map((d) => ({
    id: d.id,
    command: "reorder.place",
    status: d.status as Draft["status"],
    lines: d.payload.lines.map((line, i) => ({
      item: v.items.get(line.itemId) ?? "",
      qty: qtyRef(d.payloadRefs[`lines[${i}].qtyMilli`], line.qtyMilli, cell, byId, ref),
    })),
    supplier: suppliers.get(d.payload.supplierId) ?? { name: "", simulated: true },
    decision: v.stamps.get(d.id) ?? null,
    canDecide: me.mayRun.has("reorder.place"),
  }));

  // The agents' other drafts: a figure is shown from the cell the draft cites (a reminder's figure, a lapse's value left,
  // each figure of a reply's stored words), never from the payload's text.
  const agentLabel = (key: "labelCreditBalance" | "labelPackageBalance" | "labelReplyFigure" | "labelInvoiceOpen"): Localized => ({ en: AGENTS.en[key], hi: AGENTS.hi[key] });
  const cited = (r: CellRef | null | undefined, l: Localized) => (r ? ref(l, r.snapshotId, r.row, r.col) : null);
  const tray: TrayCard[] = v.tray.flatMap((d): TrayCard[] => {
    if (d.status === "superseded") return [];
    const template =
      d.payload.template === "credit_due" || d.payload.template === "package_expiring" || d.payload.template === "paypal_link" ? d.payload.template : null;
    // A PayPal link's amount is the cell its draft cites (payload.figure), as a reminder's is: a balance, or a bill's open
    // credit (an invoice's link).
    const figure =
      d.command === "customer.remind" || d.command === "paypal.request"
        ? cited(
            typeof d.payload.figure === "string" ? parseRef(d.payload.figure) : null,
            agentLabel(template === "package_expiring" ? "labelPackageBalance" : d.paypalPurpose === "invoice" ? "labelInvoiceOpen" : "labelCreditBalance"),
          )
        : d.command === "package.expire"
          ? cited(
              d.basedOn.find((r) => r.col === "value_left" && byId.get(r.snapshotId)?.query === "package.balance"),
              agentLabel("labelPackageBalance"),
            )
          : null;
    return [
      {
        id: d.id,
        command: d.command,
        status: d.status,
        customer: d.customer,
        template,
        figure,
        words: d.command === "message.reply" && d.body !== null ? wordsOf(d.body, agentLabel("labelReplyFigure"), ref) : null,
        // A PayPal link's message: its words as its approval writes them, from the very link it names; the amount its cell.
        ...(template === "paypal_link" ? { paypalMessage: d.paypalMessage && figure ? messageOf(d.paypalMessage, figure) : null } : {}),
        ...(d.paypalPurpose ? { paypalPurpose: d.paypalPurpose } : {}),
        ...(paypal && (d.command === "paypal.request" || template === "paypal_link") ? { paypalMode: paypal } : {}),
        gift: d.command === "surplus.give" ? giftOf(d, cell, byId, ref) : null,
        decision: v.stamps.get(d.id) ?? null,
        canDecide: me.mayRun.has(d.command),
      },
    ];
  });

  const snapshots: Snapshot[] = v.snapshots.map((s) => {
    const view = DRAWER[s.query];
    const rows = s.rows.map((row) => named(Object.fromEntries(Object.entries(row).map(([col, c]) => [col, cellValue(c)])), s.names));
    const first = rows[0] ?? {};
    // A column core cut for this member's role (an office figure) is not in the row, and not in the drawer either.
    const columns: Column[] = (view?.columns ?? Object.keys(first)).filter((key) => !rows.length || key in first).map((key) => {
      const c = first[key];
      return { key, numeric: c?.t === "int" || c?.t === "money" || c?.t === "qty" };
    });
    return {
      id: s.id,
      query: s.query,
      readAt: s.readAt,
      title: view ? label(view.title) : { en: s.query, hi: s.query },
      ...(view?.simulatedSupplier ? { simulatedSupplier: true } : {}),
      columns,
      rows,
    };
  });

  const synthetic = /\s*\(synthetic\)$/;
  return {
    shop: { name: me.tenantName.replace(synthetic, ""), synthetic: synthetic.test(me.tenantName) },
    member: me.member as OwnerHome["member"],
    briefAt: brief ? brief.startedAt.toISOString() : null,
    snapshots,
    findings: shown.map((x) => x.finding),
    // The bank's side of UPI is the settlements' (the office's): not a line for counter staff.
    unverified: v.reads.has("settlements.reconcile") ? UNVERIFIED : [],
    drafts: cards,
    tray,
  };
}

const TOKEN = /⟨snap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}·\d{1,6}·[a-z_][a-z0-9_]{0,62}⟩/g;

/** Stored words as text and figures: each ref token is the cell it names. */
function wordsOf(body: string, l: Localized, ref: (l: Localized, snapshotId: string, row: number, col: string) => SourceRef): WordPart[] {
  const parts: WordPart[] = [];
  let at = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ t: "text", v: body.slice(at, m.index) });
    at = m.index + m[0].length;
    const r = parseRef(m[0]) as CellRef;
    parts.push({ t: "ref", ref: ref(l, r.snapshotId, r.row, r.col) });
  }
  if (at < body.length) parts.push({ t: "text", v: body.slice(at) });
  return parts;
}

/** A PayPal link message's words: the template's own words, the shop and the link as names, each {amount} the cell. */
function messageOf(m: { template: string; shop: string; where: string }, figure: SourceRef): MessagePart[] {
  return m.template
    .split(/(\{shop\}|\{amount\}|\{link\})/)
    .filter((part) => part !== "")
    .map((part): MessagePart => (part === "{amount}" ? { t: "ref", ref: figure } : part === "{shop}" ? { t: "name", v: m.shop } : part === "{link}" ? { t: "name", v: m.where } : { t: "text", v: part }));
}

// A gift's item and recipient are text cells it cites, each from a row of the very lot, item or recipient its payload
// names: the item from a watch.expiry or surplus.lot row whose lot_id is the payload's lotId, or a stock.on_hand row whose
// item_id is its itemId; the recipient from a surplus.recipients row whose id is its recipientId. No such row: null, and
// the card says "Cannot verify". Its quantity is shown from its payload ref only while that stored cell holds the very
// quantity the draft gives.
const OF_ITEM: Record<string, [col: string, key: "lotId" | "itemId"]> = {
  "watch.expiry": ["lot_id", "lotId"],
  "surplus.lot": ["lot_id", "lotId"],
  "stock.on_hand": ["item_id", "itemId"],
};
function giftOf(
  d: TrayDraft,
  cell: (snapshotId: string, row: number, col: string) => Cell | undefined,
  byId: Map<string, StoredSnapshot>,
  ref: (l: Localized, snapshotId: string, row: number, col: string) => SourceRef,
): NonNullable<TrayCard["gift"]> {
  const text = (r: CellRef, col: string) => {
    const c = cell(r.snapshotId, r.row, col);
    return c?.kind === "text" ? c.txt : null;
  };
  const named = (col: string, own: (r: CellRef, query: string) => boolean) => {
    const r = d.basedOn.find((x) => x.col === col && own(x, byId.get(x.snapshotId)?.query ?? ""));
    return r ? text(r, col) : null;
  };
  const item = named("item", (r, query) => {
    const bind = OF_ITEM[query];
    return !!bind && text(r, bind[0]) === d.payload[bind[1]];
  });
  const recipient = named("name", (r, query) => query === "surplus.recipients" && text(r, "id") === d.payload.recipientId);
  const r = d.payloadRefs.qtyMilli;
  const v = r && cell(r.snapshotId, r.row, r.col);
  const qty = r && v?.kind === "quantity" && v.num === String(d.payload.qtyMilli) ? ref(label("labelStockLedger"), r.snapshotId, r.row, r.col) : null;
  return { item, recipient, qty };
}

// A reorder line's quantity is shown from its payload ref (the cell core checked holds it when the draft was proposed),
// and only while that stored cell still holds the very quantity the draft would order; otherwise null, and the card says
// "Cannot verify" rather than print the payload.
function qtyRef(
  r: CellRef | undefined,
  qtyMilli: number,
  cell: (snapshotId: string, row: number, col: string) => Cell | undefined,
  byId: Map<string, StoredSnapshot>,
  ref: (l: Localized, snapshotId: string, row: number, col: string) => SourceRef,
): SourceRef | null {
  const v = r && cell(r.snapshotId, r.row, r.col);
  if (!r || v?.kind !== "quantity" || v.num !== String(qtyMilli)) return null;
  return ref(label(byId.get(r.snapshotId)?.query === "watch.shrinkage" ? "labelStockCount" : "labelStockLedger"), r.snapshotId, r.row, r.col);
}
