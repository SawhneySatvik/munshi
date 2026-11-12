// The orders screen's data (server only), read by core's viewOrders in the page's ONE
// transaction: the requests waiting with their lines priced as confirming would price them now (order.request_lines
// cells), the agent's order.confirm drafts with every cell they cite, the board by step (order.board) and each card's
// lines, total, advance and measurements (order.lines, measurement.values), and each card's PayPal (sandbox): what the
// order still needs (order.due) where a link may be asked, its links and where each stands, and the drafts waiting on
// them, every amount a cited cell. Null while the shop cannot use orders.
import "server-only";
import { type CellRef, type Cell, type Session, viewOrders } from "@munshi/core";
import { type PaypalLinkRow, ordersPaypal } from "@munshi/core/paypal";
import type { Frame } from "../app-types";
import { PAYPAL } from "../i18n-paypal";
import type { Localized, SourceRef } from "../types";
import { type Minted, minted as mintedOf, mintedAs, page, refTo, textOf } from "./ops";
import { paypalMode } from "./paypal";
import { frameOf, lab } from "./sell";

export type RequestLine = { item: string; qty: SourceRef; price: SourceRef | null; amount: SourceRef | null };
export type WaitingRow = {
  id: string;
  code: string;
  channel: string;
  kind: string;
  at: string;
  lines: RequestLine[];
  total: SourceRef | null;
  priced: boolean;
  message: boolean;
};
export type DraftRow = { id: string; message: string | null; heard: boolean; refs: { path: string; item: string | null; ref: SourceRef }[]; customer: string; due: string | null };
export type LinkState = "asked" | "sent" | "paid" | "recorded" | "cancelled" | "failed";
export type OrderLinkView = {
  id: string;
  state: LinkState;
  mode: PaypalLinkRow["mode"];
  paypalId: string | null;
  payerUrl: string | null;
  amount: SourceRef | null;
  messaged: boolean;
  messageWaiting: boolean;
  /** PayPal's notices the books do not show yet, each recordable when in the shop's currency */
  unrecorded: { id: string; sameCurrency: boolean }[];
};
export type OrderPaypalView = {
  due: SourceRef | null;
  links: OrderLinkView[];
  drafts: { id: string; command: "paypal.request" | "customer.remind" | "payment.record"; amount: SourceRef | null }[];
};
export type CardRow = {
  id: string;
  code: SourceRef;
  codeText: string;
  kind: string;
  step: string;
  customer: string;
  due: SourceRef | null;
  trial: SourceRef | null;
  lines: { item: string; qty: SourceRef; price: SourceRef; quoted: boolean }[];
  total: SourceRef | null;
  advance: SourceRef | null;
  next: string[];
  measurements: { lineNo: number; points: { point: string; mm: SourceRef | null }[] }[];
  paypal: OrderPaypalView | null;
};
export type OrdersPage = Frame & {
  stitching: boolean;
  waiting: WaitingRow[];
  drafts: DraftRow[];
  cards: CardRow[];
  more: { code: string; step: string }[];
  customers: { id: string; name: string }[];
  /** PayPal on the board (sandbox): null where PayPal is not ready or the member may not read it */
  paypal: { mode: "sandbox" | "recorded"; canSend: boolean; canRecord: boolean } | null;
};

const isNull = (cell: Cell | undefined) => !cell || cell.kind === "null";

const stateOf = (l: PaypalLinkRow): LinkState =>
  l.status === "cancelled" || l.status === "cancel_queued"
    ? "cancelled"
    : l.status === "failed"
      ? "failed"
      : l.events.some((e) => e.recorded)
        ? "recorded"
        : l.events.length
          ? "paid"
          : l.status === "sent"
            ? "sent"
            : "asked";

export async function loadOrders(session: Session): Promise<OrdersPage | null> {
  return page(session, async (c) => {
    const v = await viewOrders(c, session);
    if (!v) return null;
    const minted: Minted[] = [];
    const names = new Map(v.customers.map((k) => [k.id, k.name]));

    const waiting = v.waiting.map((w): WaitingRow => {
      const base = { id: w.id, code: w.code, channel: w.channel, kind: w.kind, at: w.createdAt.toISOString(), message: w.lines === null };
      if (!w.lines) return { ...base, lines: [], total: null, priced: false };
      const m = mintedAs(w.lines, lab("waitingLabel"), ["item", "qty", "unit_price", "amount", "total"]);
      minted.push(m);
      const L = lab("waitingLabel");
      const priced = m.cells.length > 0 && m.cells.every((r) => !isNull(r.unit_price));
      return {
        ...base,
        lines: m.cells.map((r, i) => ({
          item: textOf(r.item),
          qty: refTo(m, i, "qty", L),
          price: isNull(r.unit_price) ? null : refTo(m, i, "unit_price", L),
          amount: isNull(r.amount) ? null : refTo(m, i, "amount", L),
        })),
        total: priced ? refTo(m, 0, "total", L) : null,
        priced,
      };
    });

    // A draft's cells: every one it cites, from the snapshots stored when it was proposed (re-checked at approval).
    const draftMinted = v.draftSnapshots.map((s) => mintedAs(s, lab("draftsHeading")));
    minted.push(...draftMinted);
    const drafts = v.drafts.map((d): DraftRow => {
      const p = (d.payload ?? {}) as { customerId?: string; dueOn?: string };
      return {
        id: d.id,
        message: d.message,
        heard: d.heard,
        customer: p.customerId ? (names.get(p.customerId) ?? "") : "",
        due: p.dueOn ?? null,
        refs: Object.entries(d.payloadRefs).map(([path, r]) => ({
          path,
          // A line's quantity is labelled with the line's item, as the catalogue names it.
          item: d.itemNames[Number(/^lines\[(\d+)\]\./.exec(path)?.[1] ?? -1)] || null,
          ref: { label: lab("draftsHeading"), snapshotId: r.snapshotId, row: r.row + 1, col: r.col },
        })),
      };
    });

    const board = mintedAs(v.board, lab("boardLabel"), ["step", "code", "kind", "due_on", "trial_on", "customer"]);
    minted.push(board);
    const B = lab("boardLabel");
    const cards = v.cards.map((card): CardRow => {
      const r = board.cells[card.row] ?? {};
      const lines = card.lines ? mintedAs(card.lines, lab("linesLabel"), ["line_no", "item", "qty", "unit_price", "priced_by", "amount", "total", "advance"]) : null;
      if (lines) minted.push(lines);
      const L = lab("linesLabel");
      const ms = card.measurements.map((x) => {
        const m = mintedAs(x.values, lab("measureLabel"), ["point", "mm"]);
        minted.push(m);
        return { lineNo: x.lineNo, points: m.cells.map((p, i) => ({ point: textOf(p.point), mm: isNull(p.mm) ? null : refTo(m, i, "mm", lab("measureLabel")) })) };
      });
      return {
        id: card.orderId,
        code: refTo(board, card.row, "code", B),
        codeText: textOf(r.code),
        kind: card.kind,
        step: card.step,
        customer: names.get(card.customerId) ?? "",
        due: isNull(r.due_on) ? null : refTo(board, card.row, "due_on", B),
        trial: isNull(r.trial_on) ? null : refTo(board, card.row, "trial_on", B),
        lines: lines ? lines.cells.map((l, i) => ({ item: textOf(l.item), qty: refTo(lines, i, "qty", L), price: refTo(lines, i, "unit_price", L), quoted: textOf(l.priced_by) === "quote" })) : [],
        total: lines?.cells[0] ? refTo(lines, 0, "total", L) : null,
        advance: lines?.cells[0] ? refTo(lines, 0, "advance", L) : null,
        next: card.next,
        measurements: ms,
        paypal: null,
      };
    });
    const more = board.cells.slice(v.cards.length).map((r) => ({ code: textOf(r.code), step: textOf(r.step) }));

    // PayPal, card by card: every amount is a cell of a stored snapshot (the link's or draft's figure, the order's due).
    const pp = await ordersPaypal(
      c,
      session.memberId,
      v.cards.map((card) => ({ orderId: card.orderId, customerId: card.customerId })),
    );
    if (pp) {
      const P: Localized = { en: PAYPAL.en.label, hi: PAYPAL.hi.label };
      const made = new Map<string, Minted>();
      const keep = (m: Minted) => {
        if (!made.has(m.id)) {
          made.set(m.id, m);
          minted.push(m);
        }
        return m;
      };
      for (const snap of pp.snapshots) keep(mintedOf(snap));
      const refOf = (r: CellRef | null) => {
        const m = r ? made.get(r.snapshotId) : undefined;
        return m && r ? refTo(m, r.row, r.col, P) : null;
      };
      for (const card of cards) {
        const o = pp.byOrder[card.id];
        if (!o) continue;
        card.paypal = {
          due: o.due ? refTo(keep(mintedOf(o.due)), 0, "due", P) : null,
          links: o.links.map((l) => ({
            id: l.id,
            state: stateOf(l),
            mode: l.mode,
            paypalId: l.paypalId,
            payerUrl: l.payerUrl,
            amount: refOf(l.figure),
            messaged: l.messaged,
            messageWaiting: l.messageWaiting,
            unrecorded: l.events.filter((e) => !e.recorded).map((e) => ({ id: e.id, sameCurrency: e.sameCurrency })),
          })),
          drafts: o.drafts.map((d) => ({ id: d.id, command: d.command, amount: refOf(d.figure) })),
        };
      }
    }
    return {
      ...frameOf(v.viewer, minted),
      stitching: v.stitching,
      waiting,
      drafts,
      cards,
      more,
      customers: v.customers,
      paypal: pp ? { mode: paypalMode(), canSend: pp.canSend, canRecord: pp.canRecord } : null,
    };
  });
}
