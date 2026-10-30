// The orders screen's data (server only, BP-APP-4, BLUEPRINT §8.12), read by core's viewOrders in the page's ONE
// transaction: the requests waiting with their lines priced as confirming would price them now (order.request_lines
// cells), the agent's order.confirm drafts with every cell they cite, the board by step (order.board) and each card's
// lines, total, advance and measurements (order.lines, measurement.values). Null while the shop cannot use orders.
import { type Cell, type Session, viewOrders } from "@munshi/core";
import type { Frame } from "../app-types";
import type { SourceRef } from "../types";
import { type Minted, mintedAs, page, refTo, textOf } from "./ops";
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
export type DraftRow = { id: string; message: string | null; refs: { path: string; ref: SourceRef }[]; customer: string; due: string | null };
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
};
export type OrdersPage = Frame & {
  stitching: boolean;
  waiting: WaitingRow[];
  drafts: DraftRow[];
  cards: CardRow[];
  more: { code: string; step: string }[];
  customers: { id: string; name: string }[];
};

const isNull = (cell: Cell | undefined) => !cell || cell.kind === "null";

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
        customer: p.customerId ? (names.get(p.customerId) ?? "") : "",
        due: p.dueOn ?? null,
        refs: Object.entries(d.payloadRefs).map(([path, r]) => ({
          path,
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
      };
    });
    const more = board.cells.slice(v.cards.length).map((r) => ({ code: textOf(r.code), step: textOf(r.step) }));
    return { ...frameOf(v.viewer, minted), stitching: v.stitching, waiting, drafts, cards, more, customers: v.customers };
  });
}
