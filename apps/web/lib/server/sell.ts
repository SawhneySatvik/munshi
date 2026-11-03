// The selling screens' data (server only): offers, packages, loyalty, invoices and customers, each read by its
// core view in the page's ONE transaction (page()), as plain data whose every figure is a ref into a snapshot cell the
// view minted. A screen whose capability the shop cannot use reads as null, and its page answers 404. Names, codes and
// states come beside the figures and are never figures; a stored cell is compared (in effect, ended), never computed with.
import {
  type Cell,
  type Session,
  type StoredSnapshot,
  type Viewer,
  viewCustomer,
  viewCustomers,
  viewInvoice,
  viewInvoices,
  viewLoyalty,
  viewOffers,
  viewPackages,
} from "@munshi/core";
import type { Frame } from "../app-types";
import { APP, type AppDict } from "../i18n-app";
import type { Localized, SourceRef } from "../types";
import { formKey } from "./form-key";
import { frame, type Minted, mintedAs, page, refTo, textOf } from "./ops";
import { type PaypalPanel, paypalPanel } from "./paypal-panel";

/** A Localized from the capability screens' dictionary. */
export const lab = (key: keyof AppDict): Localized => ({ en: APP.en[key], hi: APP.hi[key] });

/** The page's frame: the member, the shop, the snapshots its figures point into, the commands the role holds and a key. */
export function frameOf(v: Viewer, minted: Minted[]): Frame {
  const f = frame(v);
  return { member: f.member, shop: f.shop, snapshots: minted.map((m) => m.snapshot), may: [...f.may], formKey: formKey() };
}

const isNull = (cell: Cell | undefined) => !cell || cell.kind === "null";
const isOne = (cell: Cell | undefined) => cell?.kind === "integer" && cell.num === "1";
const at = (cell: Cell | undefined) => (cell?.kind === "timestamp" ? cell.at : null);
/** A ref to a cell, or null when the cell is empty (a cap not set, an amount the kind does not take). */
const refOr = (m: Minted, row: number, col: string, label: Localized): SourceRef | null => (isNull(m.cells[row]?.[col]) ? null : refTo(m, row, col, label));

// ---- offers ------------------------------------------------------------------------------------------------------

export type OfferRow = {
  id: string;
  name: string;
  code: string | null;
  scope: string;
  category: string;
  percent: boolean;
  off: SourceRef;
  minSpend: SourceRef | null;
  cap: SourceRef | null;
  perCustomer: SourceRef | null;
  used: SourceRef;
  state: "live" | "ended" | "later";
  published: boolean;
  endsAt: string | null;
};
export type OffersPage = Frame & { offers: OfferRow[]; categories: string[] };

export async function loadOffers(session: Session): Promise<OffersPage | null> {
  return page(session, async (c) => {
    const v = await viewOffers(c, session);
    if (!v) return null;
    const m = mintedAs(v.offers, lab("offerLabel"), ["name", "code", "percent_bp", "amount_off", "min_spend", "max_redemptions", "redemptions", "starts_at", "ends_at", "ended_at"]);
    const label = lab("offerLabel");
    const now = Date.now();
    const offers = m.cells.map((r, i): OfferRow => {
      const percent = textOf(r.kind) === "percent_off";
      const ended = !isNull(r.ended_at) && Date.parse(at(r.ended_at) as string) <= now;
      return {
        id: textOf(r.offer_id),
        name: textOf(r.name),
        code: isNull(r.code) ? null : textOf(r.code),
        scope: textOf(r.scope),
        category: textOf(r.category),
        percent,
        off: refTo(m, i, percent ? "percent_bp" : "amount_off", label),
        minSpend: refOr(m, i, "min_spend", label),
        cap: refOr(m, i, "max_redemptions", label),
        perCustomer: refOr(m, i, "per_customer_limit", label),
        used: refTo(m, i, "redemptions", label),
        state: isOne(r.in_effect) ? "live" : ended || Date.parse(at(r.ends_at) ?? "") <= now ? "ended" : "later",
        published: isOne(r.published),
        endsAt: at(r.ends_at),
      };
    });
    return { ...frameOf(v.viewer, [m]), offers, categories: v.categories };
  });
}

// ---- packages ----------------------------------------------------------------------------------------------------

export type PlanRow = { id: string; name: string; price: SourceRef; days: SourceRef; lines: { service: string; sessions: SourceRef }[] };
export type HoldingRow = { id: string; customer: string; plan: string; sessions: SourceRef; value: SourceRef; expires: SourceRef };
export type BalanceRow = { itemId: string; service: string; left: SourceRef; any: boolean };
export type PackagesPage = Frame & {
  plans: PlanRow[];
  holdings: HoldingRow[];
  open: { id: string; customer: string; plan: string; rows: BalanceRow[] } | null;
  shops: { id: string; name: string }[];
  services: { id: string; name: string }[];
};

const textIn = (s: StoredSnapshot, row: number, col: string) => textOf(s.rows[row]?.[col]);

export async function loadPackages(session: Session, holdingId: string | null): Promise<PackagesPage | null> {
  return page(session, async (c) => {
    const v = await viewPackages(c, session, holdingId);
    if (!v) return null;
    const plans = mintedAs(v.plans, lab("planLabel"), ["package", "price", "validity_days", "service", "sessions"]);
    const holdings = mintedAs(v.holdings, lab("holdingLabel"), ["customer", "package", "sold_on", "expires_on", "sessions_left", "value_left"]);
    const planRows: PlanRow[] = [];
    for (const [i, r] of plans.cells.entries()) {
      const id = textOf(r.plan_id);
      let plan = planRows.find((p) => p.id === id);
      if (!plan) {
        plan = { id, name: textOf(r.package), price: refTo(plans, i, "price", lab("planLabel")), days: refTo(plans, i, "validity_days", lab("planLabel")), lines: [] };
        planRows.push(plan);
      }
      plan.lines.push({ service: textOf(r.service), sessions: refTo(plans, i, "sessions", lab("planLabel")) });
    }
    const names = v.holdings.names;
    const holdingRows = holdings.cells.map((r, i): HoldingRow => ({
      id: textOf(r.holding_id),
      customer: names[textOf(r.customer_id)] ?? "",
      plan: textOf(r.package),
      sessions: refTo(holdings, i, "sessions_left", lab("holdingLabel")),
      value: refTo(holdings, i, "value_left", lab("holdingLabel")),
      expires: refTo(holdings, i, "expires_on", lab("holdingLabel")),
    }));
    const minted = [plans, holdings];
    let open: PackagesPage["open"] = null;
    if (v.balance) {
      const b = mintedAs(v.balance, lab("balanceLabel"), ["item", "sessions_left", "value_left", "expires_on"]);
      minted.push(b);
      const held = holdingRows.find((h) => h.id === holdingId);
      open = {
        id: holdingId as string,
        customer: held?.customer ?? "",
        plan: held?.plan ?? "",
        rows: b.cells.map((r, i) => ({
          itemId: textOf(r.item_id),
          service: textIn(v.balance as StoredSnapshot, i, "item"),
          left: refTo(b, i, "sessions_left", lab("balanceLabel")),
          any: r.sessions_left?.kind === "integer" && BigInt(r.sessions_left.num) > 0n,
        })),
      };
    }
    return {
      ...frameOf(v.viewer, minted),
      plans: planRows,
      holdings: holdingRows,
      open,
      shops: v.shops.map((s) => ({ id: s.id, name: s.name })),
      services: v.services,
    };
  });
}

// ---- loyalty -----------------------------------------------------------------------------------------------------

export type LoyaltyPage = Frame & {
  rule: { earn: SourceRef; value: SourceRef; min: SourceRef; since: string | null } | null;
  holders: { id: string; name: string; points: SourceRef }[];
};

export async function loadLoyalty(session: Session): Promise<LoyaltyPage | null> {
  return page(session, async (c) => {
    const v = await viewLoyalty(c, session);
    if (!v) return null;
    const rule = mintedAs(v.rule, lab("ruleLabel"), ["earn_per_100", "point_value", "min_redeem", "effective_from"]);
    const balances = mintedAs(v.balances, lab("pointsLabel"), ["customer", "points"]);
    const names = v.balances.names;
    return {
      ...frameOf(v.viewer, [rule, balances]),
      rule: rule.cells[0]
        ? {
            earn: refTo(rule, 0, "earn_per_100", lab("ruleLabel")),
            value: refTo(rule, 0, "point_value", lab("ruleLabel")),
            min: refTo(rule, 0, "min_redeem", lab("ruleLabel")),
            since: at(rule.cells[0].effective_from),
          }
        : null,
      holders: balances.cells.map((r, i) => ({ id: textOf(r.customer_id), name: names[textOf(r.customer_id)] ?? "", points: refTo(balances, i, "points", lab("pointsLabel")) })),
    };
  });
}

// ---- customers ---------------------------------------------------------------------------------------------------

export type CustomersPage = Frame & {
  credit: boolean;
  loyalty: boolean;
  customers: { id: string; name: string; owes: SourceRef | null; points: SourceRef | null }[];
};

export async function loadCustomers(session: Session): Promise<CustomersPage | null> {
  return page(session, async (c) => {
    const v = await viewCustomers(c, session);
    if (!v) return null;
    const balances = v.balances ? mintedAs(v.balances, lab("creditLabel"), ["customer", "balance", "overdue", "oldest_due_on"]) : null;
    const points = v.points ? mintedAs(v.points, lab("pointsLabel"), ["customer", "points"]) : null;
    const rowIn = (m: Minted | null, id: string) => (m ? m.cells.findIndex((r) => textOf(r.customer_id) === id) : -1);
    return {
      ...frameOf(v.viewer, [balances, points].filter((m): m is Minted => m !== null)),
      credit: balances !== null,
      loyalty: points !== null,
      customers: v.customers.map((k) => {
        const b = rowIn(balances, k.id);
        const p = rowIn(points, k.id);
        return {
          id: k.id,
          name: k.name,
          owes: balances && b >= 0 ? refTo(balances, b, "balance", lab("creditLabel")) : null,
          points: points && p >= 0 ? refTo(points, p, "points", lab("pointsLabel")) : null,
        };
      }),
    };
  });
}

export type CustomerPage = Frame & {
  customer: { id: string; name: string };
  owes: SourceRef | null;
  points: { n: SourceRef; worth: SourceRef } | null;
  holdings: HoldingRow[] | null;
};

export async function loadCustomer(session: Session, customerId: string): Promise<CustomerPage | null> {
  return page(session, async (c) => {
    const v = await viewCustomer(c, session, customerId);
    if (!v) return null;
    const credit = v.credit ? mintedAs(v.credit, lab("creditLabel"), ["customer", "balance"]) : null;
    const points = v.points ? mintedAs(v.points, lab("pointsLabel"), ["customer", "points", "value", "min_redeem"]) : null;
    const holdings = v.holdings ? mintedAs(v.holdings, lab("holdingLabel"), ["package", "sold_on", "expires_on", "sessions_left", "value_left"]) : null;
    return {
      ...frameOf(v.viewer, [credit, points, holdings].filter((m): m is Minted => m !== null)),
      customer: v.customer,
      owes: credit?.cells[0] ? refTo(credit, 0, "balance", lab("creditLabel")) : null,
      points: points?.cells[0] ? { n: refTo(points, 0, "points", lab("pointsLabel")), worth: refTo(points, 0, "value", lab("pointsLabel")) } : null,
      holdings: holdings
        ? holdings.cells.map((r, i) => ({
            id: textOf(r.holding_id),
            customer: v.customer.name,
            plan: textOf(r.package),
            sessions: refTo(holdings, i, "sessions_left", lab("holdingLabel")),
            value: refTo(holdings, i, "value_left", lab("holdingLabel")),
            expires: refTo(holdings, i, "expires_on", lab("holdingLabel")),
          }))
        : null,
    };
  });
}

// ---- invoices ----------------------------------------------------------------------------------------------------

export type InvoiceRow = { id: string; kind: string; series: string; fy: string; number: SourceRef; issuedAt: string | null; total: SourceRef; cgst: SourceRef; sgst: SourceRef };
export type InvoicesPage = Frame & {
  shops: { id: string; name: string; series: string | null }[];
  shopId: string;
  month: string;
  registration: { scheme: string; gstin: string | null; stateCode: string; effectiveFrom: string } | null;
  invoices: InvoiceRow[];
  summary: { rate: SourceRef; lines: SourceRef; taxable: SourceRef; cgst: SourceRef; sgst: SourceRef; total: SourceRef }[];
};

export async function loadInvoices(session: Session, shopId: string | null, month: string | null): Promise<InvoicesPage | null> {
  return page(session, async (c) => {
    const v = await viewInvoices(c, session, shopId, month);
    if (!v) return null;
    const list = mintedAs(v.invoices, lab("invoicesLabel"), ["kind", "series", "fy", "number", "issued_at", "taxable", "cgst", "sgst", "total"]);
    const sum = mintedAs(v.summary, lab("summaryLabel"), ["rate_bp", "lines", "taxable", "cgst", "sgst", "total"]);
    const L = lab("invoicesLabel");
    const S = lab("summaryLabel");
    return {
      ...frameOf(v.viewer, [list, sum]),
      shops: v.shops.map((s) => ({ id: s.id, name: s.name, series: s.series })),
      shopId: v.shopId,
      month: v.month,
      registration: v.registration,
      invoices: list.cells.map((r, i) => ({
        id: textOf(r.invoice_id),
        kind: textOf(r.kind),
        series: textOf(r.series),
        fy: textOf(r.fy),
        number: refTo(list, i, "number", L),
        issuedAt: at(r.issued_at),
        total: refTo(list, i, "total", L),
        cgst: refTo(list, i, "cgst", L),
        sgst: refTo(list, i, "sgst", L),
      })),
      summary: sum.cells.map((_, i) => ({
        rate: refTo(sum, i, "rate_bp", S),
        lines: refTo(sum, i, "lines", S),
        taxable: refTo(sum, i, "taxable", S),
        cgst: refTo(sum, i, "cgst", S),
        sgst: refTo(sum, i, "sgst", S),
        total: refTo(sum, i, "total", S),
      })),
    };
  });
}

export type InvoicePage = Frame & {
  id: string;
  kind: string;
  series: string;
  fy: string;
  gstin: string;
  buyerGstin: string;
  issuedAt: string | null;
  number: SourceRef | null;
  shop: string;
  customer: string | null;
  saleId: string;
  originalId: string | null;
  creditNoteId: string | null;
  reversed: boolean;
  lines: { description: string; qty: SourceRef; taxable: SourceRef; rate: SourceRef; cgst: SourceRef; sgst: SourceRef; total: SourceRef }[];
  totals: { taxable: SourceRef; cgst: SourceRef; sgst: SourceRef; total: SourceRef } | null;
  /** PayPal sandbox for an invoice sold on credit to a customer: links are offered only for what its sale still owes on
   *  credit (invoice.open_credit, positive), never the invoice's total, and never for a reversed sale or a credit note. */
  paypal?: PaypalPanel | null;
};

export async function loadInvoice(session: Session, invoiceId: string): Promise<InvoicePage | null> {
  return page(session, async (c) => {
    const v = await viewInvoice(c, session, invoiceId);
    if (!v) return null;
    const d = mintedAs(v.detail, lab("invoiceLabel"), ["line_no", "description", "hsn_sac", "qty", "taxable", "rate_bp", "cgst", "sgst", "line_total", "number"]);
    const L = lab("invoiceLabel");
    const first = d.cells[0];
    const paypal = v.customer && textOf(first?.kind) !== "credit_note" && !v.saleReversed ? await paypalPanel(c, session, { invoiceId }) : null;
    const f = frameOf(v.viewer, [d]);
    return {
      ...f,
      snapshots: [...f.snapshots, ...(paypal?.snapshots ?? [])],
      id: invoiceId,
      kind: textOf(first?.kind),
      series: textOf(first?.series),
      fy: textOf(first?.fy),
      gstin: textOf(first?.seller_gstin),
      buyerGstin: textOf(first?.buyer_gstin),
      issuedAt: at(first?.issued_at),
      number: first ? refTo(d, 0, "number", L) : null,
      shop: v.shop?.name ?? "",
      customer: v.customer?.name ?? null,
      saleId: textOf(first?.sale_id),
      originalId: isNull(first?.original_invoice_id) ? null : textOf(first?.original_invoice_id),
      creditNoteId: v.creditNoteId,
      reversed: v.saleReversed,
      lines: d.cells.map((r, i) => ({
        description: textOf(r.description),
        qty: refTo(d, i, "qty", L),
        taxable: refTo(d, i, "taxable", L),
        rate: refTo(d, i, "rate_bp", L),
        cgst: refTo(d, i, "cgst", L),
        sgst: refTo(d, i, "sgst", L),
        total: refTo(d, i, "line_total", L),
      })),
      totals: first
        ? { taxable: refTo(d, 0, "invoice_taxable", L), cgst: refTo(d, 0, "invoice_cgst", L), sgst: refTo(d, 0, "invoice_sgst", L), total: refTo(d, 0, "invoice_total", L) }
        : null,
      paypal,
    };
  });
}
