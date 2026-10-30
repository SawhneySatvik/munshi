// The orders screen of BP-APP-4 (apps/web/lib/server/orders.ts shows it, BLUEPRINT §8.12): the requests waiting (a site
// cart priced as order.confirm would price it now, order.request_lines; an agent's order.confirm draft with every cell
// it cites), the board by step (order.board over ops.order_state), each card's lines, total and advance (order.lines),
// the next steps ref.order_flow allows, and a stitching line's measurements (measurement.values). In the page's one
// transaction, only while the shop can use orders.
import { can } from './capabilities.ts';
import type { CellRef } from './read.ts';
import type { Session } from './session.ts';
import { type Client, customerList, mint, read, type StoredSnapshot, storedSnapshots, type Viewer, viewer } from './views-common.ts';
import { shopList, type Shop } from './views-sell.ts';

// A board shows at most this many cards with their lines; the rest are listed by code and step only.
export const BOARD_CARDS = 40;
const WAITING = 20;

export type WaitingRequest = { id: string; code: string; channel: string; kind: string; createdAt: Date; contactId: string | null; lines: StoredSnapshot | null };
export type OrderDraft = {
  id: string;
  payload: unknown;
  payloadRefs: Record<string, CellRef>;
  basedOn: CellRef[];
  // The message the run read, while not erased: the customer's own words, which the screen quotes as theirs.
  message: string | null;
};
export type BoardCard = {
  orderId: string;
  row: number; // the card's row in the board snapshot
  kind: string;
  step: string;
  customerId: string;
  next: string[]; // the steps order.step may take it to now
  lines: StoredSnapshot | null; // order.lines
  measurements: { lineNo: number; values: StoredSnapshot }[];
};
export type OrdersView = {
  viewer: Viewer;
  stitching: boolean;
  shops: Shop[];
  waiting: WaitingRequest[];
  drafts: OrderDraft[];
  draftSnapshots: StoredSnapshot[];
  board: StoredSnapshot;
  cards: BoardCard[];
  customers: { id: string; name: string }[];
};

// The steps a person's order.step may move to (its own enum): delivered comes only with the sale, cancelled and
// rescheduled have their own commands.
const STEPPABLE = new Set(['packed', 'cutting', 'stitching', 'trial', 'ready', 'out_for_delivery']);

export async function viewOrders(c: Client, session: Session): Promise<OrdersView | null> {
  if (!(await can(c, session, 'orders'))) return null;
  const stitching = await can(c, session, 'stitching');
  const me = await viewer(c, session);

  const requests = await read<{ id: string; code: string; channel: string; kind: string; created_at: Date; contact_id: string | null; carted: boolean }>(
    c,
    `select id::text, code, channel, kind, created_at, contact_id::text, lines is not null as carted
       from ops.order_request where state in ('new', 'drafted') and expires_at > now() order by created_at, id limit ${WAITING}`,
  );
  const waiting: WaitingRequest[] = [];
  for (const r of requests) {
    waiting.push({
      id: r.id,
      code: r.code,
      channel: r.channel,
      kind: r.kind,
      createdAt: r.created_at,
      contactId: r.contact_id,
      lines: r.carted ? await mint(c, 'order.request_lines', { request_id: r.id }) : null,
    });
  }

  const draftRows = await read<{ id: string; payload: unknown; payload_refs: Record<string, CellRef>; based_on: CellRef[]; message: string | null }>(
    c,
    `select d.id::text, d.payload, d.payload_refs, d.based_on,
            (select coalesce(m.transcript, m.text) from ops.order_request r join ops.inbound_message m on m.tenant_id = r.tenant_id and m.id = r.inbound_message_id
              where r.tenant_id = d.tenant_id and r.draft_id = d.id and m.erased_at is null limit 1) as message
       from approval.draft d where d.command = 'order.confirm' and d.status = 'proposed' order by d.created_at limit ${WAITING}`,
  );
  const drafts = draftRows.map((d) => ({ id: d.id, payload: d.payload, payloadRefs: d.payload_refs, basedOn: d.based_on, message: d.message }));
  const draftSnapshots = await storedSnapshots(
    c,
    drafts.flatMap((d) => [...d.basedOn, ...Object.values(d.payloadRefs)].map((r) => r.snapshotId)),
  );

  const steps = (await read<{ code: string }>(c, 'select code from ref.order_step where not terminal order by code')).map((s) => s.code);
  const board = await mint(c, 'order.board', { steps });
  const flow = await read<{ kind: string; from_step: string; to_step: string }>(c, 'select kind, from_step, to_step from ref.order_flow order by kind, from_step, to_step');
  const text = (row: StoredSnapshot['rows'][number], col: string) => {
    const cell = row[col];
    return cell?.kind === 'text' ? cell.txt : '';
  };
  const cards: BoardCard[] = [];
  for (const [row, r] of board.rows.slice(0, BOARD_CARDS).entries()) {
    const orderId = text(r, 'order_id');
    const kind = text(r, 'kind');
    const step = text(r, 'step');
    const lines = await mint(c, 'order.lines', { order_id: orderId });
    const measured = await read<{ line_no: number; measurement_id: string }>(
      c,
      `select line_no, measurement_id::text from books.order_line where order_id = $1 and measurement_id is not null and reverses_id is null order by line_no`,
      [orderId],
    );
    const measurements: BoardCard['measurements'] = [];
    for (const m of measured) measurements.push({ lineNo: m.line_no, values: await mint(c, 'measurement.values', { measurement_id: m.measurement_id }) });
    cards.push({
      orderId,
      row,
      kind,
      step,
      customerId: text(r, 'customer_id'),
      next: flow.filter((f) => f.kind === kind && f.from_step === step && STEPPABLE.has(f.to_step)).map((f) => f.to_step),
      lines,
      measurements,
    });
  }
  return { viewer: me, stitching, shops: await shopList(c), waiting, drafts, draftSnapshots, board, cards, customers: await customerList(c) };
}
