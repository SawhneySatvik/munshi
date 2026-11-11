// The PayPal desk (server only): one row per customer who owes the shop or has a PayPal link, read in the page's one
// transaction from what the credit book, the brief and the PayPal panel already read. Every figure is a ref to a stored
// cell: the balance, the overdue amount and the date it fell due (credit.balances, minted now), the days late (the
// overdue finding's own watcher cell), the link's amount (the cell the link was drafted for), the overdue total (the
// brief's credit.overdue_total). How late a row is, and its PayPal state, are decided here by comparing cells and
// statuses, never by adding them: there is no total per bucket, because no named read stores one. Null for a member
// who sees no PayPal surface (paypalPanel's rule: counter staff), so the page answers 404.
import "server-only";
import { addDays, type Cell, type Session, storedSnapshots, viewCredit, viewHome } from "@munshi/core";
import { paypalLinks } from "@munshi/core/paypal";
import { PAYPAL_DESK } from "../i18n-paypal-desk";
import type { DeskBucket, DeskRow, DeskState, PaypalDesk } from "../paypal-desk";
import type { Localized, SourceRef } from "../types";
import { frame, type Minted, mintedAs, page, refTo, rowOf, textOf } from "./ops";
import { type PaypalDraftView, type PaypalLinkView, paypalPanel } from "./paypal-panel";

const both = (key: "balanceLabel" | "findingLabel" | "totalLabel" | "linkLabel"): Localized => ({ en: PAYPAL_DESK.en[key], hi: PAYPAL_DESK.hi[key] });

const isPositive = (cell: Cell | undefined) => cell?.kind === "money" && BigInt(cell.num) > 0n;

/** How late: the oldest unpaid credit's due date (a date cell) against today's cut-offs; only compared. */
function bucketOf(late: boolean, since: Cell | undefined, today: string, owes: boolean): DeskBucket {
  if (!owes) return "clear";
  if (!late || since?.kind !== "date") return "not_due";
  if (since.day >= addDays(today, -30)) return "month";
  if (since.day >= addDays(today, -60)) return "two";
  if (since.day >= addDays(today, -90)) return "three";
  return "older";
}

/** A customer's PayPal state: a link draft waiting comes first, then their newest link's. */
function stateOf(link: PaypalLinkView | undefined, drafts: PaypalDraftView[]): DeskState {
  if (drafts.some((d) => d.command === "paypal.request")) return "draft";
  if (!link) return "none";
  if (link.events.some((e) => !e.recorded && e.sameCurrency)) return "paid";
  if (link.events.some((e) => e.recorded)) return "recorded";
  if (link.live) return "live";
  return link.status === "failed" ? "failed" : "cancelled";
}

export async function loadPaypalDesk(session: Session): Promise<PaypalDesk | null> {
  const read = await page(session, async (c) => {
    const panel = await paypalPanel(c, session, {});
    if (!panel) return null;
    const v = await viewCredit(c, session);
    const home = await viewHome(c, session);
    const { links } = await paypalLinks(c, {});
    const figures = await storedSnapshots(c, [...new Set(links.map((l) => l.figure.snapshotId))]);
    return { panel, v, home, links, figures };
  });
  if (!read) return null;
  const { panel, v, home, links, figures } = read;
  const floor = frame(v.viewer);
  const balances = mintedAs(v.balances, both("balanceLabel"));
  const names = new Map(v.customers.map((k) => [k.id, k.name]));
  const shown: Minted[] = [balances];

  // The overdue findings (the watcher's stored rows), by customer: their days-late cell and the finding a reminder
  // is drafted from.
  const byId = new Map(home.snapshots.map((s) => [s.id, s]));
  const found = new Map<string, Minted>();
  const findingOf = new Map<string, { id: string; days: SourceRef }>();
  for (const f of home.findings) {
    if (f.kind !== "overdue_credit") continue;
    const s = byId.get(f.snapshotId);
    if (!s) continue;
    const m = found.get(s.id) ?? mintedAs(s, both("findingLabel"), ["customer", "overdue", "oldest_due_on", "days_overdue"]);
    found.set(s.id, m);
    const customerId = textOf(m.cells[f.snapshotRow]?.customer_id);
    if (customerId) findingOf.set(customerId, { id: f.id, days: refTo(m, f.snapshotRow, "days_overdue", both("findingLabel")) });
  }
  shown.push(...found.values());

  let total: PaypalDesk["total"] = null;
  const totalSnap = home.brief?.totalId ? byId.get(home.brief.totalId) : undefined;
  if (totalSnap?.rows[0]) {
    const m = mintedAs(totalSnap, both("totalLabel"), ["customers", "overdue"]);
    shown.push(m);
    total = { overdue: refTo(m, 0, "overdue", both("totalLabel")), customers: refTo(m, 0, "customers", both("totalLabel")) };
  }

  // Each link's amount: the stored cell it was drafted for.
  const figureSnaps = new Map(figures.map((s) => [s.id, mintedAs(s, both("linkLabel"))]));
  shown.push(...figureSnaps.values());
  const linkFigure = new Map<string, SourceRef>();
  for (const l of links) {
    const m = figureSnaps.get(l.figure.snapshotId);
    if (m?.cells[l.figure.row]?.[l.figure.col]) linkFigure.set(l.id, refTo(m, l.figure.row, l.figure.col, both("linkLabel")));
  }

  // The reminders a person decided or still has to, since the brief (the tray's credit_due reminders): the newest per
  // customer, sent with its decision's time.
  const reminders = new Map<string, DeskRow["reminder"]>();
  for (const d of home.tray) {
    if (d.command !== "customer.remind" || d.payload.template !== "credit_due") continue;
    const id = String(d.payload.customerId ?? "");
    if (d.status === "proposed") reminders.set(id, { status: "waiting" });
    else if (d.status === "executed" && reminders.get(id)?.status !== "waiting") reminders.set(id, { status: "sent", at: home.stamps.get(d.id)?.at ?? null });
  }

  const canRemind = floor.may.has("customer.remind");
  const ids = [...new Set([...balances.cells.map((r) => textOf(r.customer_id)), ...Object.keys(panel.links), ...Object.keys(panel.drafts)])].filter(Boolean);
  const rows: DeskRow[] = ids.map((id) => {
    const at = rowOf(balances, "customer_id", id);
    const cells = at >= 0 ? balances.cells[at] : undefined;
    const late = isPositive(cells?.overdue);
    const owes = isPositive(cells?.balance);
    const link = panel.links[id]?.[0];
    const drafts = (panel.drafts[id] ?? []).map((d) => ({ ...d, canDecide: d.command === "payment.record" ? panel.canRecord : panel.canSend }));
    const state = stateOf(link, drafts);
    const waitingLink = drafts.find((d) => d.command === "paypal.request");
    const finding = late ? findingOf.get(id) : undefined;
    const reminder = reminders.get(id) ?? null;
    return {
      customer: { id, name: names.get(id) ?? "" },
      balance: cells ? refTo(balances, at, "balance", both("balanceLabel")) : null,
      overdue: cells ? refTo(balances, at, "overdue", both("balanceLabel")) : null,
      since: cells && late ? refTo(balances, at, "oldest_due_on", both("balanceLabel")) : null,
      days: finding?.days ?? null,
      late,
      bucket: bucketOf(late, cells?.oldest_due_on, v.today, owes),
      state,
      link: link ?? null,
      linkAmount: waitingLink ? waitingLink.amount : link ? (linkFigure.get(link.id) ?? null) : null,
      drafts,
      unrecorded: link?.events.find((e) => !e.recorded && e.sameCurrency)?.id ?? null,
      reminder,
      findingId: finding?.id ?? null,
      canLink: panel.canSend && owes && !panel.busy.includes(id),
      // No reminder to a customer PayPal says has paid: the move then is recording it.
      canRemind: canRemind && !!finding && reminder?.status !== "waiting" && state !== "paid",
    };
  });
  return {
    member: floor.member,
    shop: floor.shop,
    mode: panel.mode,
    canSend: panel.canSend,
    canRecord: panel.canRecord,
    rows,
    total,
    more: panel.more,
    // One snapshot per id: the desk's titles over the panel's.
    snapshots: [...new Map([...panel.snapshots, ...shown.map((m) => m.snapshot)].map((s) => [s.id, s])).values()],
  };
}
