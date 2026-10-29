// Holds on a piece (BLUEPRINT §8.4, ops.reservation in 14_sites_public.sql). A hold is ops, never a book: nothing owed,
// sold or moved changes until a person records the sale. The public asks (requested); an active member holds the piece
// (held, until the site's reservation hours run out), declines the ask with a reason code, or releases the hold; the sale
// that names a held piece marks it sold in the sale's own transaction; the jobs runner expires it (jobs-holds.ts). Every
// move is checked again by reservation_flow, by role. This file imports nothing of commands.ts, so the sale can import it.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { refuseParts } from './capabilities.ts';
import { CoreError } from './errors.ts';
import { liveHeld, onHandOf } from './queries-holds.ts';
import { type Session, withTx } from './session.ts';

const id = z.guid();
const version = z.string().regex(/^[a-z0-9_.-]{1,40}$/);
const ask = z.strictObject({
  siteId: id,
  itemId: id,
  qtyMilli: z.number().int().positive().safe(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  note: z.string().trim().min(1).max(500).optional(),
  noticeVersion: version,
  consentVersion: version,
  // The caller's keyed hash of the client's IP (32 bytes, hex); the address itself is never stored.
  ipHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type HoldAsk = z.input<typeof ask>;

function parse<S extends z.ZodType>(s: S, input: unknown, field?: string): z.output<S> {
  const r = s.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: field ? [field] : r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

// The public's ask, on a pool connected as munshi_public: the tenant from the site the route resolved, no actor. The
// database stores it as requested, checks the site's intake and versions, and on a demo keeps only the sample contact.
// The public role cannot read a reservation's id back, so the id is made here.
export async function askToHold(pool: pg.Pool, tenantId: string, input: HoldAsk): Promise<string> {
  const tenant = parse(id, tenantId, 'tenantId');
  const i = parse(ask, input);
  const reservationId = randomUUID();
  await withTx(pool, { kind: 'system', tenantId: tenant }, (c) =>
    c.query(
      `insert into ops.reservation (tenant_id, id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, note, notice_version, consent_version, ip_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenant, reservationId, i.siteId, i.itemId, i.qtyMilli, i.name, i.phone, i.note ?? null, i.noticeVersion, i.consentVersion, Buffer.from(i.ipHash, 'hex')],
    ),
  );
  return reservationId;
}

// One move of a reservation, only from the state it names, in the caller's transaction: a row this tenant does not hold
// is not found, and one in another state (moved already, or final) is a conflict. Conditional on the state because
// reservation_flow admits an update that leaves the state as it was, so a repeated move would pass silently; the trigger
// still checks every move by role.
async function move(c: pg.PoolClient, reservationId: string, from: string, set: string, values: unknown[] = []): Promise<void> {
  const r = await c.query(`update ops.reservation set ${set} where id = $1 and state = $2`, [reservationId, from, ...values]);
  if (r.rowCount === 1) return;
  const { rows } = await c.query('select 1 from ops.reservation where id = $1', [reservationId]);
  throw rows.length ? new CoreError('conflict', { fields: ['reservationId'] }) : new CoreError('not_found');
}

// Requested → held, only while the shop has holds on (a decline or a release finishes an ask already made, so those
// run whatever the switch). Live holds never keep back more than the books hold: checked after the move, with this hold
// counted, under the item's stock lock (lockStock's key, commands.ts), so a write-off or another hold of the same piece
// in flight is waited for, not read past.
export async function holdPiece(pool: pg.Pool, session: Session, reservationId: string): Promise<void> {
  const rid = parse(id, reservationId, 'reservationId');
  await withTx(pool, { kind: 'member', session }, async (c) => {
    await refuseParts(c, ['holds']);
    const { rows } = await c.query<{ item_id: string }>('select item_id::text as item_id from ops.reservation where id = $1', [rid]);
    const item = rows[0]?.item_id;
    if (!item) throw new CoreError('not_found');
    await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.stock:' || $1 || ':' || $2, 0))`, [session.tenantId, item]);
    await move(c, rid, 'requested', `state = 'held'`);
    const { rows: fit } = await c.query<{ fits: boolean }>(
      `select ${onHandOf('i')} >= (select coalesce(sum(r.qty_milli), 0) from ${liveHeld('i')}) as fits from books.item i where i.id = $1`,
      [item],
    );
    if (!fit[0]?.fits) throw new CoreError('conflict', { fields: ['qtyMilli'] });
  });
}

// Requested → declined, with a decline reason code (ref.reason_use, use 'decline').
export async function declineHold(pool: pg.Pool, session: Session, reservationId: string, reason: string): Promise<void> {
  const rid = parse(id, reservationId, 'reservationId');
  const code = parse(z.string().regex(/^[a-z_]{1,40}$/), reason, 'reason');
  return withTx(pool, { kind: 'member', session }, (c) => move(c, rid, 'requested', `state = 'declined', reason = $3`, [code]));
}

// Held → released: the piece is free again.
export async function releaseHold(pool: pg.Pool, session: Session, reservationId: string): Promise<void> {
  const rid = parse(id, reservationId, 'reservationId');
  return withTx(pool, { kind: 'member', session }, (c) => move(c, rid, 'held', `state = 'released'`));
}

// For sale.record (commands-sale.ts), in its transaction, after the sale naming this reservation and its lines are
// written: held → sold. The database admits it only from a sale of this transaction that names the reservation and sells
// its item; a reservation no longer held is a conflict.
export async function sellHeldPiece(c: pg.PoolClient, reservationId: string): Promise<void> {
  return move(c, parse(id, reservationId, 'reservationId'), 'held', `state = 'sold'`);
}
