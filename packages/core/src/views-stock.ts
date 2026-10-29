// The stock page (apps/web/lib/server/stock.ts shows it): what the books hold for every item (items.list) and what is
// running low (stock.below_reorder), minted as the signed-in member, with the suppliers the low read names; an item's
// on-hand after a write (stock.on_hand); and the on-hand cell a count was made against, read back from its snapshot.
import { resolveRef } from './read.ts';
import type { Session } from './session.ts';
import { type Client, mint, read, type StoredSnapshot, supplierList } from './views-common.ts';
import { itemUnits, viewFloor } from './views-counter.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function viewStock(c: Client, session: Session) {
  const floor = await viewFloor(c, session);
  const list = await mint(c, 'items.list', {});
  const low = await mint(c, 'stock.below_reorder', { as_of: floor.today });
  const ids = [...new Set(low.rows.flatMap((r) => (r.supplier_id?.kind === 'text' && UUID.test(r.supplier_id.txt) ? [r.supplier_id.txt] : [])))];
  return { ...floor, list, low, firms: await supplierList(c, ids) };
}

/** An item's on-hand read after a write (stock.on_hand). */
export function viewOnHand(c: Client, itemId: string): Promise<StoredSnapshot> {
  return mint(c, 'stock.on_hand', { item_id: itemId });
}

/**
 * The item's unit, and the on-hand the person saw when they counted: the cell at `seen`, only if it is an items.list
 * row for this very item holding a quantity (else null, and the count is refused as a conflict).
 */
export async function viewCountBasis(c: Client, itemId: string, seen: { snapshotId: string; row: number } | null) {
  const unit = (await itemUnits(c, [itemId])).get(itemId);
  if (!seen) return { unit, expected: null };
  const [snap] = await read<{ query_name: string }>(c, 'select query_name from snap.snapshot where id = $1', [seen.snapshotId]);
  const item = await resolveRef(c, { ...seen, col: 'item_id' });
  const onHand = await resolveRef(c, { ...seen, col: 'on_hand' });
  const fits = snap?.query_name === 'items.list' && item?.kind === 'text' && item.txt === itemId && onHand?.kind === 'quantity';
  return { unit, expected: fits ? Number(onHand.num) : null };
}
