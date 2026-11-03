// Surplus for good: stock near its expiry given to a recipient (simulated, every one) instead of wasted, only as an
// approved surplus.give draft. Executing it is one insert into ops.surplus_listing, under the approver, in the
// decision's transaction: the listing's trigger (25_surplus.sql) writes the stock leaving (kind `donated`, its source
// the lot), both audit entries, the value at the lot's cost and the lot's currency, so the gift and its listing land
// together or not at all. The payload is the trigger's three keys and the lot's item (itemId), which makes approvals
// cite the item's current stock.on_hand, so a sale or a write-off of it before the approval stales the draft.
// Concurrent gifts of one item are serialised here by the item's stock lock, taken before what is left of the lot is
// read. Helpers from commands.ts are used only inside run(), so the value import is safe while commands.ts spreads
// SURPLUS_COMMANDS.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { type CommandResult, type Ctx, type Def, lockStock } from './commands.ts';
import { CoreError } from './errors.ts';
import { type CellRef, resolveRef } from './read.ts';
import { mayReadIn } from './read-roles.ts';

const id = z.guid();
const give = z.strictObject({ lotId: id, itemId: id, qtyMilli: z.number().int().positive().safe(), recipientId: id });
type Give = z.output<typeof give>;

// A live lot (a line of an unreversed purchase, with an expiry) and what is left of it, read as the listing's trigger and
// watch.expiry read it: its quantity, at most the item's stock on hand less the lots of the item that expire after it.
// Null for no such lot of this shop (RLS).
async function lotLeft(c: pg.ClientBase, lotId: string): Promise<{ itemId: string; left: number } | null> {
  const { rows } = await c.query<{ item_id: string; left: string }>(
    `with live as (
       select pl.* from books.purchase_line pl
         join books.purchase p on p.tenant_id = pl.tenant_id and p.id = pl.purchase_id
        where pl.expires_on is not null and p.reverses_id is null
          and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id)
     )
     select l.item_id::text as item_id,
            greatest(0, least(l.qty_milli,
              coalesce((select sum(m.qty_milli) from books.stock_move m where m.tenant_id = l.tenant_id and m.item_id = l.item_id), 0)
              - coalesce((select sum(o.qty_milli) from live o where o.item_id = l.item_id and (o.expires_on, o.id) > (l.expires_on, l.id)), 0)))::text as left
       from live l where l.id = $1`,
    [lotId],
  );
  const r = rows[0];
  return r ? { itemId: r.item_id, left: Number(r.left) } : null;
}

const queryOf = async (c: pg.ClientBase, ref: CellRef) =>
  (await c.query<{ query_name: string }>('select query_name from snap.snapshot where id = $1', [ref.snapshotId])).rows[0]?.query_name;
const holdsText = async (c: pg.ClientBase, ref: CellRef, col: string, want: string) => {
  const cell = await resolveRef(c, { ...ref, col });
  return cell?.kind === 'text' && cell.txt === want;
};

// The cells a gift's quantity may come from: what the expiry watcher found at risk (or left) of this very lot, what is
// left of this very lot now (surplus.lot), or the item's stock on hand now. Any other cell holding the same number is not
// this gift's evidence.
async function offEvidence(c: pg.ClientBase, i: Give, ref: CellRef | undefined): Promise<boolean> {
  if (!ref) return true;
  const query = await queryOf(c, ref);
  if (query === 'watch.expiry' && (ref.col === 'at_risk' || ref.col === 'remaining')) return !(await holdsText(c, ref, 'lot_id', i.lotId));
  if (query === 'surplus.lot' && ref.col === 'left') return !(await holdsText(c, ref, 'lot_id', i.lotId));
  if (query === 'stock.on_hand' && ref.col === 'on_hand') return !(await holdsText(c, ref, 'item_id', i.itemId));
  return true;
}

// Every row a gift cites is a row of this gift: the lot's (watch.expiry, surplus.lot: its lot_id), the item's
// (stock.on_hand: its item_id) or the recipient's (surplus.recipients: its id), and it cites the recipient's name, so a
// card naming a recipient or an item names the very one the payload gives to and from. A row of any other read: refused.
// Returns the payload paths it fails.
const BINDS: Record<string, [col: string, path: 'lotId' | 'itemId' | 'recipientId']> = {
  'watch.expiry': ['lot_id', 'lotId'],
  'surplus.lot': ['lot_id', 'lotId'],
  'stock.on_hand': ['item_id', 'itemId'],
  'surplus.recipients': ['id', 'recipientId'],
};
async function offPayload(c: pg.ClientBase, i: Give, cited: CellRef[]): Promise<string[]> {
  const bad = new Set<string>();
  let named = false;
  for (const ref of cited) {
    const query = await queryOf(c, ref);
    const bind = query ? BINDS[query] : undefined;
    if (!bind) {
      bad.add('basedOn');
      continue;
    }
    const [col, path] = bind;
    if (!(await holdsText(c, ref, col, i[path]))) bad.add(path);
    else if (query === 'surplus.recipients' && ref.col === 'name') named = true;
  }
  if (!named) bad.add('recipientId');
  return [...bad];
}

export const SURPLUS_COMMANDS: [string, Def][] = [
  [
    'surplus.give',
    {
      input: give,
      draftOnly: true,
      // At proposal and again at approval: surplus is the office's (a counter member is refused outright, which
      // rolls back and leaves the draft as it was), the lot is live and of this item, the gift fits what is left of it,
      // the recipient is the shop's, the quantity is this lot's or this item's own cell, and every row cited is this
      // lot's, this item's or this recipient's (the recipient's name among them).
      checks: async (c, payload, refs, basedOn) => {
        if (!(await mayReadIn(c, 'surplus.recipients'))) throw new CoreError('refused', { fields: ['command'] });
        const i = give.parse(payload);
        const bad: string[] = [];
        const lot = await lotLeft(c, i.lotId);
        if (!lot) bad.push('lotId');
        else if (lot.itemId !== i.itemId) bad.push('itemId');
        else if (i.qtyMilli > lot.left) bad.push('qtyMilli');
        const { rows } = await c.query('select 1 from ops.surplus_recipient where id = $1', [i.recipientId]);
        if (!rows.length) bad.push('recipientId');
        if (await offEvidence(c, i, refs.qtyMilli)) bad.push('qtyMilli');
        bad.push(...(await offPayload(c, i, [...basedOn, ...Object.values(refs)])));
        return [...new Set(bad)];
      },
      run: (async (ctx: Ctx, i: Give): Promise<CommandResult> => {
        const { c, t } = ctx;
        const before = await lotLeft(c, i.lotId);
        if (!before || before.itemId !== i.itemId) throw new CoreError('invalid', { fields: ['lotId'] });
        await lockStock(ctx, i.itemId);
        // Read again under the lock: a gift of the same item that committed while this one waited counts now.
        const lot = await lotLeft(c, i.lotId);
        if (!lot || i.qtyMilli > lot.left) throw new CoreError('conflict', { fields: ['qtyMilli'] });
        const listingId = randomUUID();
        const { rows } = await c.query<{ stock_move_id: string }>(
          `insert into ops.surplus_listing (tenant_id, id, lot_id, qty_milli, recipient_id) values ($1, $2, $3, $4, $5)
           returning stock_move_id::text`,
          [t.tenantId, listingId, i.lotId, i.qtyMilli, i.recipientId],
        );
        return { listingId, moveId: rows[0]?.stock_move_id ?? null };
      }) as Def['run'],
    },
  ],
];
