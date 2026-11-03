// The counter (apps/web/lib/server/counter.ts shows it): today's counter sales (sales.by_day) and the best sellers of the
// last four weeks (sales.by_item) for the quick tiles; the bill as the books would price it now (sale.quote); and the
// receipt of a sale just recorded (sale.receipt, the customer's balance from credit.balances, what is left of each item
// from stock.on_hand), each read after the commit. Every figure is a cell minted as the signed-in member.
import { askerIn } from './read-roles.ts';
import type { Session } from './session.ts';
import { addDays, businessDate } from './time.ts';
import {
  type Client,
  customerList,
  itemList,
  mint,
  read,
  type StoredSnapshot,
  stampOf,
  type Viewer,
  viewer,
} from './views-common.ts';

const QUICK_TILES = 8;
const QUICK_DAYS = 28;

/** The signed-in member, their shop, today's business date in the shop's zone (the read gate's own, taken once per
 * transaction, so the counter's reads fall in the counter window across midnight too), and the Ask desks theirs. */
export async function viewFloor(c: Client, session: Session): Promise<{ viewer: Viewer; today: string; desks: string[] }> {
  const me = await viewer(c, session);
  const asker = await askerIn(c);
  return { viewer: me, today: asker?.today ?? businessDate(new Date(), me.timeZone), desks: [...(asker?.desks ?? [])] };
}

export async function viewCounter(c: Client, session: Session) {
  const floor = await viewFloor(c, session);
  const day = await mint(c, 'sales.by_day', { from: floor.today, to: floor.today });
  const best = await mint(c, 'sales.by_item', { from: addDays(floor.today, 1 - QUICK_DAYS), to: floor.today, limit: QUICK_TILES });
  const items = (await itemList(c)).map(({ id, name, unit }) => ({ id, name, unit }));
  return { ...floor, day, best, items, customers: await customerList(c) };
}

/** The bill as the books would price it now: one sale.quote. */
export function viewQuote(c: Client, lines: Array<{ itemId: string; qtyMilli: number }>): Promise<StoredSnapshot> {
  return mint(c, 'sale.quote', { item_ids: lines.map((l) => l.itemId), qty_milli: lines.map((l) => l.qtyMilli) });
}

/** Each item's unit, for reading a typed quantity in it. */
export async function itemUnits(c: Client, ids: string[]): Promise<Map<string, string>> {
  return new Map((await itemList(c, { ids })).map((i) => [i.id, i.unit]));
}

/** The shop a counter sale is rung up in: the tenant's first. */
export async function counterShop(c: Client): Promise<string | undefined> {
  return (await read<{ id: string }>(c, 'select id::text as id from ops.shop order by created_at, id limit 1'))[0]?.id;
}

/** A sale just recorded: its stamp, sale.receipt, the credit customer's balances and every item's on-hand, read now. */
export async function viewReceipt(c: Client, session: Session, saleId: string, customerId: string | null, itemIds: string[]) {
  const { today } = await viewFloor(c, session);
  const stamp = await stampOf(c, 'sale', saleId);
  const sale = await mint(c, 'sale.receipt', { sale_id: saleId });
  const balances = customerId ? await mint(c, 'credit.balances', { as_of: today }) : null;
  const onHand: StoredSnapshot[] = [];
  for (const id of new Set(itemIds)) onHand.push(await mint(c, 'stock.on_hand', { item_id: id }));
  const customer = customerId ? ((await customerList(c, [customerId]))[0]?.name ?? '') : null;
  return { stamp, sale, balances, onHand, customer };
}
