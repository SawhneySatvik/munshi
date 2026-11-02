// The PayPal sandbox panel a page shows (server only; D-079): the shop's links (newest first, capped), PayPal's
// notifications for each, the PayPal drafts waiting for a person, and, on an invoice, what its sale still owes. Every
// amount is a cell the page carries as a stored snapshot (the draft's figure, the invoice's open credit), so it renders
// as a source chip. Read in the page's one transaction. Null until the commands, the reads and the tables are all in
// place (the migrator's pending DDL).
import { type Session, storedSnapshots } from "@munshi/core";
import { invoiceOpenCredit, type PaypalLinkRow, paypalAuthority, paypalDrafts, paypalLinks, paypalReady } from "@munshi/core/paypal";
import type { Localized, Snapshot, SourceRef } from "../types";
import { minted, refTo } from "./ops";
import { paypalMode } from "./paypal";

export type PaypalEventView = { id: string; at: string; recorded: boolean; matchesLink: boolean; sameCurrency: boolean };
export type PaypalLinkView = {
  id: string;
  status: PaypalLinkRow["status"];
  live: boolean;
  mode: PaypalLinkRow["mode"];
  paypalId: string | null;
  payerUrl: string | null;
  at: string;
  events: PaypalEventView[];
};
export type PaypalDraftView = { id: string; command: "paypal.request" | "paypal.cancel" | "payment.record"; amount: SourceRef | null };
export type PaypalPanel = {
  mode: "sandbox" | "recorded";
  canSend: boolean;
  canRecord: boolean;
  links: Record<string, PaypalLinkView[]>;
  drafts: Record<string, PaypalDraftView[]>;
  // Keys (customers, or the invoice) with a live link or a link draft waiting: no second "Send PayPal link" for them.
  busy: string[];
  // On an invoice: what its sale still owes on credit (null: nothing, reversed, or no customer; no link is offered).
  open: SourceRef | null;
  // More links than the panel shows (it shows the newest PAYPAL_PAGE).
  more: boolean;
  snapshots: Snapshot[];
};

const LABEL: Localized = { en: "PayPal sandbox", hi: "PayPal sandbox" };

const view = (l: PaypalLinkRow): PaypalLinkView => ({
  id: l.id,
  status: l.status,
  live: l.live,
  mode: l.mode,
  paypalId: l.paypalId,
  payerUrl: l.payerUrl,
  at: l.sentAt ?? l.createdAt,
  events: l.events.map((e) => ({ id: e.id, at: e.receivedAt, recorded: e.recorded, matchesLink: e.matchesLink, sameCurrency: e.sameCurrency })),
});

type Client = Parameters<typeof paypalReady>[0];
const push = <T>(into: Record<string, T[]>, key: string, v: T) => {
  into[key] = [...(into[key] ?? []), v];
};

/** The panel, keyed by customer (the credit book) or by invoice (filter.invoiceId), in the caller's transaction. */
export async function paypalPanel(c: Client, session: Session, filter: { invoiceId?: string }): Promise<PaypalPanel | null> {
  if (!(await paypalReady(c))) return null;
  const owed = filter.invoiceId ? await invoiceOpenCredit(c, filter.invoiceId) : null;
  const keyOf = (r: { invoiceId: string | null; customerId: string }) => (filter.invoiceId ? (r.invoiceId ?? "") : r.customerId);
  const { links: rows, more } = await paypalLinks(c, filter);
  const links: Record<string, PaypalLinkView[]> = {};
  const busyCustomers = new Set<string>();
  for (const l of rows) {
    push(links, keyOf(l), view(l));
    if (l.live) busyCustomers.add(l.customerId);
  }
  const waiting = (await paypalDrafts(c)).filter((d) => !filter.invoiceId || d.invoiceId === filter.invoiceId || (owed && d.customerId === owed.customerId));
  for (const d of waiting) if (d.command === "paypal.request") busyCustomers.add(d.customerId);
  const stored = await storedSnapshots(c, [...waiting.flatMap((d) => (d.figure ? [d.figure.snapshotId] : [])), ...(owed ? [owed.snapshotId] : [])]);
  const made = new Map(stored.map((s) => [s.id, minted(s)]));
  const refOf = (r: { snapshotId: string; row: number; col: string } | null) => {
    const m = r && made.get(r.snapshotId);
    return m && r ? refTo(m, r.row, r.col, LABEL) : null;
  };
  const drafts: Record<string, PaypalDraftView[]> = {};
  for (const d of waiting) push(drafts, keyOf(d) || (filter.invoiceId ?? ""), { id: d.id, command: d.command, amount: refOf(d.figure) });
  const busy = filter.invoiceId ? (owed && busyCustomers.has(owed.customerId) ? [filter.invoiceId] : []) : [...busyCustomers];
  return {
    mode: paypalMode(),
    ...(await paypalAuthority(c, session.memberId)),
    links,
    drafts,
    busy,
    open: owed ? refOf(owed.open) : null,
    more,
    snapshots: [...made.values()].map((m) => m.snapshot),
  };
}
