// 19_messaging.sql: an outbound message is a book whose text and recipient hold (b_outbound_derive); W6's database part
// (a delivery derived in its message's transaction, every field the database's; claimed once, so sent once, forward
// only, each move by its role); CH1's database part on a live deployment; K2's (a campaign reaches only a consenting
// customer's current contact); the STOP rule; the extract's span and digit parse; E1 over ai.* after an inbound
// erasure; the text purge's either-or rule; recipients and routes. Red-proofs: test/v2/sabotage/messaging.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, sha, signUp } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;
let jobs: pg.Pool;
let pub: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  pub = db.as('munshi_public');
  f = await fillTenant(db, await signUp(db, 'message-shop'));
  await db.sabotage();
});
afterAll(() => db?.close());

const one = async (c: pg.ClientBase, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const owner = () => ({ tenant_id: f.tenant, actor_id: f.owner });
const text = (c: pg.ClientBase, body: string) =>
  one(c, `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'template', '\\x00') returning id`, [f.tenant, body]);
type Message = { kind?: string; recipient?: string; channel?: string; body?: string; hash?: string; textId?: string; extra?: Record<string, unknown> };
const message = async (c: pg.ClientBase, m: Message = {}) => {
  const body = m.body ?? 'Please send 10 packs';
  const t = m.textId ?? (await text(c, body));
  const cols = { channel: m.channel ?? 'whatsapp', recipient_kind: m.kind ?? 'supplier', recipient_id: m.recipient ?? f.supplier, text_id: t, ...m.extra };
  const keys = Object.keys(cols);
  return one(
    c,
    `insert into books.outbound_message (tenant_id, body_sha256, ${keys.join(', ')}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) returning id`,
    [f.tenant, sha(m.hash ?? body), ...Object.values(cols)],
  );
};
const send = (command: string, m: Message = {}, actor = f.owner) => tx(app, { tenant_id: f.tenant, actor_id: actor, command }, (c) => message(c, m));
const deliveryOf = async (msg: string) =>
  (await db.admin.query('select id, to_address, mode, status, attempts, claimed_at is not null as claimed, final_at is not null as final from ops.delivery where message_id = $1', [msg]))
    .rows[0];
const moveDelivery = (pool: pg.Pool, id: string, set: string, ctx: Record<string, string> = { tenant_id: f.tenant }) =>
  tx(pool, ctx, (c) => c.query(`update ops.delivery set ${set} where id = $1`, [id]));

it('an outbound message is a book: reorder.place by an owner or manager, never staff; its text unerased and of its hash (MS006); its recipient the shop’s, of its kind (MS007)', async () => {
  expect((await refused(send('reorder.place', {}, f.staff))).code).toBe('MS001');
  const forged = await refused(send('reorder.place', { body: 'Send 10', hash: 'Send 1000' }));
  expect([forged.code, forged.message]).toEqual(['MS006', 'message refused: its text is unerased and has its sha256']);
  const erased = await tx(app, owner(), (c) => text(c, 'Old text'));
  await tx(app, owner(), (c) => c.query(`update ops.message_text set body = null, erased_at = now() where id = $1`, [erased]));
  expect((await refused(send('reorder.place', { textId: erased, body: 'Old text' }))).code).toBe('MS006');
  const stranger = await refused(send('reorder.place', { recipient: randomUUID() }));
  expect([stranger.code, stranger.message]).toEqual(['MS007', "message refused: the recipient is this shop's supplier"]);
  expect((await refused(send('reorder.place', { kind: 'customer' }))).code, 'a supplier named as a customer').toBe('MS007');
  expect((await refused(send('reorder.place', { channel: 'instagram' }))).code, 'instagram is public').toBe('23514');
  const msg = await send('reorder.place', {}, f.manager);
  const phone = (await db.admin.query('select c.phone_e164 from books.party_contact p join ops.contact c on c.id = p.contact_id where p.supplier_id = $1', [f.supplier])).rows[0]
    .phone_e164;
  expect(await deliveryOf(msg)).toMatchObject({ to_address: phone, mode: 'recorded', status: 'queued', attempts: 0, claimed: false });
});

it('W6 a delivery is derived in its message’s transaction, one per message, every field the database’s; a direct insert for an earlier message is refused, and a test send is a member’s own', async () => {
  const late = await refused(tx(app, owner(), (c) => c.query(`insert into ops.delivery (tenant_id, message_id, channel, mode, status, not_after) values ($1, $2, 'whatsapp', 'recorded', 'queued', now())`, [f.tenant, f.reorder])));
  expect([late.code, late.message]).toEqual(['MS006', "delivery refused: a delivery is derived in its message's transaction"]);
  const twice = await refused(
    tx(app, { ...owner(), command: 'reorder.place' }, async (c) => {
      const m = await message(c);
      await c.query(`insert into ops.delivery (tenant_id, message_id, channel, mode, status, not_after) values ($1, $2, 'whatsapp', 'recorded', 'queued', now())`, [f.tenant, m]);
    }),
  );
  expect(twice.code).toBe('23505');
  await plant(db.admin, `update ops.member set phone_e164 = '+919800000123' where id = $1`, [f.owner]);
  const testSend = (member: string) =>
    tx(app, owner(), async (c) => {
      const t = await text(c, 'Test of the campaign copy');
      return one(
        c,
        `insert into ops.delivery (tenant_id, test_member_id, test_text_id, channel, to_address, mode, status, attempts, sent_at, not_after)
         values ($1, $2, $3, 'whatsapp', '+911111111111', 'cloud_api', 'sent', 1, now(), now() + interval '9 days') returning id`,
        [f.tenant, member, t],
      );
    });
  const id = await testSend(f.owner);
  const { rows } = await db.admin.query(
    `select to_address, mode, status, attempts, sent_at, not_after < now() + interval '25 hours' as within_a_day from ops.delivery where id = $1`,
    [id],
  );
  expect(rows).toEqual([{ to_address: '+919800000123', mode: 'recorded', status: 'queued', attempts: 0, sent_at: null, within_a_day: true }]);
  expect((await refused(testSend(f.manager))).code).toBe('MS007');
});

it('W6 a delivery moves forward only: claimed once by the jobs role (two sweeps at once claim it once), sent only from sending, later statuses from the webhook; nothing returns to queued; a recorded delivery stays recorded', async () => {
  const msg = await send('reorder.place');
  const d = (await deliveryOf(msg)).id as string;
  const [c1, c2] = [await jobs.connect(), await jobs.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true)`, [f.tenant]);
    }
    await c1.query(`update ops.delivery set status = 'sending' where id = $1`, [d]);
    const second = c2.query(`update ops.delivery set status = 'sending' where id = $1`, [d]).then(
      () => 'claimed',
      (e: { code: string }) => e.code,
    );
    await c1.query('commit');
    expect(await second).toBe('MS010');
    await c2.query('rollback');
  } finally {
    c1.release();
    c2.release();
  }
  expect(await deliveryOf(msg)).toMatchObject({ status: 'sending', attempts: 1, claimed: true });
  expect((await refused(moveDelivery(jobs, d, `status = 'queued'`))).code, 'back to queued').toBe('MS010');
  // A recorded delivery never takes an adapter, even as it is claimed.
  const other = (await deliveryOf(await send('reorder.place'))).id as string;
  const adapter = await refused(moveDelivery(jobs, other, `status = 'sending', mode = 'cloud_api'`));
  expect([adapter.code, adapter.message]).toEqual(['MS010', 'delivery refused: only a pending delivery takes its adapter, as it is claimed']);
  expect((await refused(moveDelivery(pub, d, `status = 'delivered'`))).code, 'the webhook before the send').toBe('MS010');
  expect((await refused(moveDelivery(app, d, `status = 'sent'`, owner()))).code, 'the app').toBe('42501');
  await moveDelivery(jobs, d, `status = 'sent'`);
  expect(await deliveryOf(msg)).toMatchObject({ status: 'sent', final: true }); // a recorded send is final when sent
  await moveDelivery(pub, d, `status = 'delivered'`);
  await moveDelivery(pub, d, `status = 'read'`);
  expect((await refused(moveDelivery(jobs, d, `status = 'sending'`))).code, 'sent again').toBe('MS010');
});
