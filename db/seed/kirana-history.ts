// The demo shop's small history of decisions (W2-A), so Keeper's desk has notes to show and a walk has a decision to
// reach. Synthetic, through the people's own command path as the rest of the seed: the owner drafts two reorders of
// what the last bill brought (each quantity the bill line's cell), approves one with a standing preference, and the
// manager declines the other with a reason; core's decide() keeps each person's words as a note citing their decision.
// A reorder writes only a message to a simulated supplier, so no figure of the books changes. Run by seedKirana before
// the watchers, so neither decided draft shows on Home (Home shows drafts decided since the brief).
import { decide, mintSnapshot, proposeDraft, type Session } from '@munshi/core';
import type pg from 'pg';

export const HISTORY = {
  approved: { item: 'Tea leaves 250 g', words: 'Keep tea well stocked before festivals; order it early in the week' },
  declined: { item: 'Potato chips 50 g', words: 'Chips sell slowly after the monsoon; wait for the weekend rush' },
} as const;

// A reorder of the quantity the item's last bill line brought, from that bill's supplier: both cells of one read.
async function reorderLastBill(app: pg.Pool, owner: Session, itemId: string): Promise<string> {
  const last = await mintSnapshot(app, { kind: 'member', session: owner }, 'purchases.last_price', { item_id: itemId });
  const row = last.rows[0];
  const supplier = row?.supplier_id;
  const qty = row?.qty;
  if (supplier?.kind !== 'text' || qty?.kind !== 'quantity') throw new Error('seed: the history item has no bill to reorder from');
  const cite = (col: string) => ({ snapshotId: last.id, row: 0, col });
  return proposeDraft(
    app,
    { session: owner },
    {
      command: 'reorder.place',
      payload: { supplierId: supplier.txt, lines: [{ itemId, qtyMilli: Number(qty.num) }] },
      basedOn: [cite('supplier_id'), cite('qty')],
      payloadRefs: { 'lines[0].qtyMilli': cite('qty') },
    },
  );
}

export async function seedKiranaHistory(
  app: pg.Pool,
  k: { owner: Session; manager: Session; items: Map<string, string> },
): Promise<{ approved: string; declined: string }> {
  const id = (name: string) => {
    const found = k.items.get(name);
    if (!found) throw new Error(`seed: no item ${name}`);
    return found;
  };
  const approved = await decide(app, k.owner, await reorderLastBill(app, k.owner, id(HISTORY.approved.item)), 'approved', undefined, HISTORY.approved.words);
  const declined = await decide(app, k.manager, await reorderLastBill(app, k.owner, id(HISTORY.declined.item)), 'rejected', 'not_now', HISTORY.declined.words);
  if (approved.status !== 'executed' || declined.status !== 'rejected') throw new Error('seed: the history decisions did not go through');
  return { approved: approved.decisionId, declined: declined.decisionId };
}
