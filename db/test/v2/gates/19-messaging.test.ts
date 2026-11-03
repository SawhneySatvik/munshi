// 19_messaging.sql: an outbound message is a book whose text and recipient hold (b_outbound_derive); W6's database part
// (a delivery derived in its message's transaction, every field the database's; claimed once, so sent once, forward
// only, each move by its role); CH1's database part on a live deployment; K2's (a campaign reaches only a consenting
// customer's current contact); the STOP rule; the extract's span and digit parse; E1 over ai.* after an inbound
// erasure; the text purge's either-or rule; recipients and routes; AI1-MARK, the durable "written by AI" mark on a
// campaign (M4); M6's Instagram parts (IG1 the STOP rule is WhatsApp's, IG2 an Instagram message reaches only a granted
// real shop, IG3 a post's card is public once its campaign is approved) and STUCK1 (a delivery sending for over a day
// takes a final_at). Red-proofs: test/v2/sabotage/messaging.ts, surplus.ts and m6.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, sha, signUp } from './fixture.ts';
import { acceptTenant, asOwner, plant, refused } from './lib.ts';

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
  // A direct command's message is a fixed template (D-061): every one here carries a template code over template words.
  const cols = { channel: m.channel ?? 'whatsapp', recipient_kind: m.kind ?? 'supplier', recipient_id: m.recipient ?? f.supplier, text_id: t, template_code: 'reorder', ...m.extra };
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

// A customer with their own contact (a fresh phone), made by customer.create; the contact's id comes back too.
let phones = 0;
async function customerWithPhone(t: { tenant: string; owner: string }, pool = app): Promise<{ customer: string; contact: string; phone: string }> {
  const phone = `+9198${String(70000000 + ++phones).padStart(8, '0')}`;
  return tx(pool, { tenant_id: t.tenant, actor_id: t.owner, command: 'customer.create' }, async (c) => {
    const contact = await one(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Ravi Kumar', $2) returning id`, [t.tenant, phone]);
    const customer = await one(c, 'insert into books.customer (tenant_id) values ($1) returning id', [t.tenant]);
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [t.tenant, customer, contact]);
    return { customer, contact, phone };
  });
}
const consent = (customer: string, contact: string, granted: boolean, purpose = 'marketing', evidence?: string, c?: pg.PoolClient) => {
  const sql = `insert into books.customer_consent (tenant_id, customer_id, contact_id, channel, purpose, granted, source, evidence_rel, evidence_id, notice_version, at)
               values ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, $8, 'v1', now())`;
  const params = [f.tenant, customer, contact, purpose, granted, evidence ? 'whatsapp_reply' : 'in_person', evidence ? 'ops.inbound_message' : null, evidence ?? null];
  return c ? c.query(sql, params) : tx(app, { ...owner(), command: 'consent.record' }, (x) => x.query(sql, params));
};
// A draft-only command runs under an approved decision: proposed in one transaction, decided in the next.
async function underDecision<T>(command: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const draft = await tx(app, owner(), (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, $2, '{}', $3, 'member', 0) returning id`, [
      f.tenant,
      command,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  return tx(app, owner(), async (c) => {
    const d = await one(c, `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`, [
      f.tenant,
      draft,
      f.owner,
    ]);
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [d]);
    return fn(c);
  });
}
const inbound = (body: string, extra = '') =>
  tx(pub, { tenant_id: f.tenant }, async (c) => {
    const id = randomUUID();
    await c.query(
      `insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at${extra ? ', opt_out' : ''})
       values ($1, $2, $3, '919800000999', 'text', $4, now()${extra ? `, ${extra}` : ''})`,
      [f.tenant, id, `wamid.${randomUUID()}`, body],
    );
    return id;
  });

it('K2 a campaign reaches a customer only with marketing consent given through their current, unerased contact: of five planted recipients exactly one gets a message; a reminder needs service consent', async () => {
  const campaign = await tx(app, owner(), (c) =>
    one(c, `insert into ops.campaign (tenant_id, name, channel, segment, segment_days) values ($1, 'Regulars', 'whatsapp', 'lapsed_regulars', 60) returning id`, [f.tenant]),
  );
  const [consenting, never, withdrew, stopped, erased] = [
    await customerWithPhone(f),
    await customerWithPhone(f),
    await customerWithPhone(f),
    await customerWithPhone(f),
    await customerWithPhone(f),
  ];
  for (const p of [consenting, withdrew, stopped, erased]) await consent(p.customer, p.contact, true);
  await consent(withdrew.customer, withdrew.contact, false);
  const stop = await inbound('STOP');
  await tx(app, { ...owner(), command: 'consent.record' }, async (c) => {
    await consent(stopped.customer, stopped.contact, false, 'marketing', stop, c);
    await c.query(`update ops.inbound_message set status = 'handled' where id = $1`, [stop]);
  });
  await tx(app, owner(), (c) =>
    c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [erased.contact, f.owner]),
  );
  const outcomes: string[] = [];
  for (const p of [consenting, never, withdrew, stopped, erased]) {
    outcomes.push(
      await underDecision('campaign.send', (c) => message(c, { kind: 'customer', recipient: p.customer, extra: { campaign_id: campaign } })).then(
        () => 'sent',
        (e: { code: string }) => e.code,
      ),
    );
  }
  expect(outcomes).toEqual(['sent', 'MS007', 'MS007', 'MS007', 'MS007']);
  expect((await db.admin.query('select count(*)::int as n from books.outbound_message where campaign_id = $1', [campaign])).rows).toEqual([{ n: 1 }]);
  const remind = () => underDecision('customer.remind', (c) => message(c, { kind: 'customer', recipient: consenting.customer }));
  const r = await refused(remind());
  expect([r.code, r.message]).toEqual(['MS007', 'message refused: customer.remind reaches a customer only with service consent from their current contact']);
  await consent(consenting.customer, consenting.contact, true, 'service');
  await remind();
});

it('STOP a bare STOP is an opt-out whatever the webhook says; it is handled only beside its withdrawal, never ignored, and never erased before it; other messages are purged 30 days after they arrive', async () => {
  const stop = await inbound('  stop ', 'false');
  expect((await db.admin.query('select opt_out from ops.inbound_message where id = $1', [stop])).rows).toEqual([{ opt_out: true }]);
  const handle = (status: string, withdraw: boolean) =>
    tx(app, { ...owner(), command: 'consent.record' }, async (c) => {
      if (withdraw) await consent(f.customer, f.customerContact, false, 'marketing', stop, c);
      await c.query('update ops.inbound_message set status = $2 where id = $1', [stop, status]);
    });
  const message = 'inbound refused: a STOP is handled only beside its withdrawal';
  expect([(await refused(handle('handled', false))).message, (await refused(handle('ignored', true))).message]).toEqual([message, message]);
  await plant(db.admin, `update ops.inbound_message set received_at = now() - interval '31 days' where id = $1`, [stop]);
  const purge = (id: string) =>
    tx(jobs, { tenant_id: f.tenant }, (c) =>
      c.query(`update ops.inbound_message set text = null, from_address = null, erased_at = now() where id = $1`, [id]),
    );
  const early = await refused(purge(stop));
  expect([early.code, early.message]).toEqual(['MS007', 'inbound refused: a STOP is never erased before its withdrawal']);
  const byOwner = await refused(tx(app, owner(), (c) => c.query(`update ops.inbound_message set text = null, from_address = null, erased_at = now() where id = $1`, [stop])));
  expect(byOwner.message).toBe('inbound refused: a STOP is never erased before its withdrawal');
  await handle('handled', true);
  await purge(stop);
  const [fresh, old] = [await inbound('Is the tea in?'), await inbound('Any offers?')];
  await plant(db.admin, `update ops.inbound_message set received_at = now() - interval '29 days' where id = $1`, [fresh]);
  await plant(db.admin, `update ops.inbound_message set received_at = now() - interval '31 days' where id = $1`, [old]);
  expect((await refused(purge(fresh))).message).toBe('inbound refused: the purge erases a message 30 days after it arrived');
  await purge(old);
});

it('X1 an extract’s span lies inside its live message and hashes to its sha256; a digit span in any script re-parses to its number (paise, thousandths); a word span is core’s', async () => {
  const body = 'Need ५०० rupees, 1,500 more and ٣ kg';
  const msg = await inbound(body);
  const at = (s: string) => [body.indexOf(s), body.indexOf(s) + s.length] as const;
  const extract = (field: string, num: number | null, span: readonly [number, number], hash: Buffer, parsedAs = 'digits', message = msg) =>
    tx(app, owner(), (c) =>
      c.query(
        `insert into ops.inbound_extract (tenant_id, message_id, run_id, field, num, span_start, span_end, span_sha256, parsed_as) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [f.tenant, message, f.run, field, num, span[0], span[1], hash, parsedAs],
      ),
    );
  await extract('amount', 50000, at('५००'), sha('५००'));
  await extract('amount', 150000, at('1,500'), sha('1,500'));
  await extract('quantity', 3000, at('٣'), sha('٣'));
  await extract('amount', 1, at('rupees'), sha('rupees'), 'words'); // core reads words; the database checks the span only
  const misread = await refused(extract('amount', 500, at('५००'), sha('५००')));
  expect([misread.code, misread.message]).toEqual(['MS006', 'extract refused: the digit span does not read as its number']);
  const hash = await refused(extract('amount', 50000, at('५००'), sha('500')));
  expect(hash.message).toBe('extract refused: the span does not hash to span_sha256');
  const tail = body.slice(body.length - 2);
  const outside = await refused(extract('quantity', 1000, [body.length - 2, body.length + 3], sha(tail)));
  expect([outside.code, outside.message]).toEqual(['MS006', 'extract refused: the span lies inside the live message']);
  await tx(app, owner(), (c) => c.query(`update ops.inbound_message set text = null, from_address = null, erased_at = now() where id = $1`, [msg]));
  expect((await refused(extract('amount', 50000, at('५००'), sha('५००')))).message).toBe('extract refused: the span lies inside the live message');
});

// Every text, jsonb and bytea column of the schemas E1 scans, searched (as the superuser, past RLS) for the needles.
async function scan(needles: string[]): Promise<string[]> {
  const { rows: cols } = await db.admin.query<{ rel: string; col: string; type: string }>(
    `select n.nspname || '.' || c.relname as rel, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('ops', 'ai', 'approval', 'snap', 'audit', 'platform') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and (a.atttypid in ('text'::regtype, 'jsonb'::regtype, 'bytea'::regtype) or format_type(a.atttypid, a.atttypmod) like 'character%')`,
  );
  const found: string[] = [];
  for (const { rel, col, type } of cols) {
    const expr = type === 'bytea' ? `position(convert_to($1, 'UTF8') in ${col}) > 0` : `strpos(${col}::text, $1) > 0`;
    for (const needle of needles) {
      const { rows } = await db.admin.query(`select count(*)::int as n from ${rel} where ${expr}`, [needle]);
      if (rows[0].n > 0) found.push(`${rel}.${col}: ${needle}`);
    }
  }
  return found;
}

it('E1 after an inbox message is purged, and with it the texts made from it, no name or phone from it is left in ops.*, ai.*, approval.*, snap.*, audit.* or platform.*', async () => {
  const msg = await inbound('This is Meera Iyer, call me on 9876501234');
  const answer = await tx(jobs, { tenant_id: f.tenant }, async (c) => {
    const t = await one(c, `insert into ops.message_text (tenant_id, body, author, run_id, body_sha256) values ($1, 'Meera Iyer asks for a call on 9876501234', 'run', $2, '\\x00') returning id`, [
      f.tenant,
      f.jobsRun,
    ]);
    await c.query(`insert into ai.answer (tenant_id, run_id, kind, text_id, inbound_message_id, verdict) values ($1, $2, 'gloss', $3, $4, 'answered')`, [
      f.tenant,
      f.jobsRun,
      t,
      msg,
    ]);
    return t;
  });
  const needles = ['Meera Iyer', '9876501234'];
  expect((await scan(needles)).sort()).toEqual(['ops.inbound_message.text: 9876501234', 'ops.inbound_message.text: Meera Iyer', 'ops.message_text.body: 9876501234', 'ops.message_text.body: Meera Iyer']);
  // ai.* holds no free text (its rows' triggers allow ids and codes only, review B2), so the scan's ai.* half is shown to
  // read those columns with a needle planted past the triggers, then removed.
  const planted = randomUUID();
  await plant(db.admin, `insert into ai.answer (tenant_id, id, run_id, kind, refs, verdict) values ($1, $2, $3, 'ask', '[[{"col": "Meera Iyer"}]]', 'abstained')`, [
    f.tenant,
    planted,
    f.jobsRun,
  ]);
  expect(await scan(['Meera Iyer'])).toContain('ai.answer.refs: Meera Iyer');
  await plant(db.admin, 'delete from ai.answer where id = $1', [planted]);
  const purgeText = () => tx(jobs, { tenant_id: f.tenant }, (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [answer]));
  expect((await refused(purgeText())).code).toBe('MS007'); // its source message is still there
  await plant(db.admin, `update ops.inbound_message set received_at = now() - interval '31 days' where id = $1`, [msg]);
  await tx(jobs, { tenant_id: f.tenant }, (c) => c.query(`update ops.inbound_message set text = null, from_address = null, erased_at = now() where id = $1`, [msg]));
  await purgeText();
  expect(await scan(needles)).toEqual([]);
});

it('RET1 the purge erases a sent text 30 days after its last delivery is final, never while one is open or sooner', async () => {
  const sent = await send('reorder.place', { body: 'Reorder for the purge' });
  const { text_id: textId } = (await db.admin.query('select text_id from books.outbound_message where id = $1', [sent])).rows[0];
  const d = (await deliveryOf(sent)).id as string;
  const purge = () => tx(jobs, { tenant_id: f.tenant }, (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [textId]));
  expect((await refused(purge())).code, 'not yet sent').toBe('MS007');
  await moveDelivery(jobs, d, `status = 'sending'`);
  await moveDelivery(jobs, d, `status = 'sent'`);
  await plant(db.admin, `update ops.delivery set final_at = now() - interval '29 days' where id = $1`, [d]);
  const r = await refused(purge());
  expect([r.code, r.message]).toEqual(['MS007', 'message text refused: the purge erases a text 30 days after its Ask answer or its last final delivery, with its source message, or 30 days after it was written if nothing names it']);
  await plant(db.admin, `update ops.delivery set final_at = now() - interval '31 days' where id = $1`, [d]);
  await purge();
});

it('R1 an active owner lists test recipients only under a live WhatsApp grant and within its cap, each with its route in one transaction; a number routes to one shop (first come); routes are erased with their removed recipient', async () => {
  // Test recipients are a real shop's (D-080): an accepted real shop here; the sample shop is refused even with a grant.
  const r = await signUp(db, 'message-real', { dataClass: 'live' });
  const ctxOf = (actor: string) => ({ tenant_id: r.tenant, actor_id: actor });
  const list = (contact: string, actor = r.owner, hmac: Buffer = sha(randomUUID()), withRoute = true) =>
    tx(app, ctxOf(actor), async (c) => {
      const id = await one(c, `insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2) returning id`, [r.tenant, contact]);
      if (withRoute) await c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [hmac, r.tenant, id]);
      return id;
    });
  const [a, b] = [await customerWithPhone(r), await customerWithPhone(r)];
  const ungranted = await refused(list(a.contact));
  expect([ungranted.code, ungranted.message]).toEqual(['MS007', "recipient refused: the shop's WhatsApp grant allows 0 test recipients"]);
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 1, $2)`, [
    r.tenant,
    randomUUID(),
  ]);
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 2, $2)`, [
    f.tenant,
    randomUUID(),
  ]);
  const sample = await refused(
    tx(app, owner(), (c) => c.query(`insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2)`, [f.tenant, f.customerContact])),
  );
  expect([sample.code, sample.message]).toEqual(['MS007', "recipient refused: test recipients are a real shop's"]);
  expect((await refused(list(a.contact, r.manager))).code).toBe('MS007');
  const hmac = sha(randomUUID());
  const first = await list(a.contact, r.owner, hmac);
  // this one fills the cap of one
  expect((await refused(list(b.contact))).message).toBe("recipient refused: the shop's WhatsApp grant allows 1 test recipients");
  const orphan = await refused(
    tx(app, ctxOf(r.owner), (c) => c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [sha(randomUUID()), r.tenant, first])),
  );
  expect(orphan.message).toBe('route refused: a route is written with its recipient, for the current shop');
  // another real shop listing the same number: refused by the first-come key
  const other = await signUp(db, 'message-other', { dataClass: 'live' });
  const otherContact = (await customerWithPhone(other)).contact;
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 2, $2)`, [
    other.tenant,
    randomUUID(),
  ]);
  const taken = await refused(
    tx(app, { tenant_id: other.tenant, actor_id: other.owner }, async (c) => {
      const id = await one(c, `insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2) returning id`, [other.tenant, otherContact]);
      await c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [hmac, other.tenant, id]);
    }),
  );
  expect(taken.code).toBe('23505');
  // the webhook finds the shop by the number; another shop's app sees none of this shop's routes
  expect((await tx(pub, {}, (c) => c.query('select tenant_id from ops.phone_route where phone_hmac = $1', [hmac]))).rows).toEqual([{ tenant_id: r.tenant }]);
  expect((await tx(app, { tenant_id: other.tenant, actor_id: other.owner }, (c) => c.query('select id from ops.phone_route where phone_hmac = $1', [hmac]))).rowCount).toBe(0);
  const eraseRoute = () =>
    tx(app, ctxOf(r.owner), (c) => c.query('update ops.phone_route set phone_hmac = null, erased_at = now() where recipient_id = $1', [first]));
  expect((await refused(eraseRoute())).message).toBe('route refused: a route is erased with its removed recipient, by an active owner or the jobs role');
  await tx(app, ctxOf(r.owner), async (c) => {
    await c.query('update ops.channel_recipient set removed_at = now() where id = $1', [first]);
    await c.query('update ops.phone_route set phone_hmac = null, erased_at = now() where recipient_id = $1', [first]);
  });
  expect((await refused(tx(app, ctxOf(r.owner), (c) => c.query('update ops.channel_recipient set removed_at = now() where id = $1', [first])))).code).toBe('MS010');
});

it('CH1 a delivery is real (pending) only for a real shop the operator accepted, from a real session, to a real recipient, with the shop’s live grant and, on WhatsApp, a listed recipient; otherwise recorded, a sample shop always', async () => {
  const live = await openTestDb();
  try {
    await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
    await live.sabotage(); // the live clone is this test's own, so the current red-proof reaches it too
    const liveApp = live.as('munshi_app');
    const t = { tenant: randomUUID(), owner: randomUUID() };
    const ctx = { tenant_id: t.tenant, actor_id: t.owner };
    await tx(liveApp, ctx, async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Live shop', 'kirana', 'live')`, [t.tenant]);
      await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('live-kirana', $1)`, [t.tenant]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [t.tenant, t.owner]);
    });
    await acceptTenant(live.admin, t.tenant);
    const [listed, unlisted] = [await customerWithPhone(t, liveApp), await customerWithPhone(t, liveApp)];
    const supplier = (simulated: boolean) =>
      tx(liveApp, { ...ctx, command: 'supplier.create' }, async (c) => {
        const s = await one(c, 'insert into books.supplier (tenant_id, is_simulated) values ($1, $2) returning id', [t.tenant, simulated]);
        const k = await one(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Supplier', $2) returning id`, [t.tenant, `+9197${simulated ? '1' : '2'}0000000`]);
        await c.query('insert into books.party_contact (tenant_id, supplier_id, contact_id, effective_from) values ($1, $2, $3, now())', [t.tenant, s, k]);
        return { s, k };
      });
    const [real, sim] = [await supplier(false), await supplier(true)];
    const grant = (granted: boolean) =>
      plant(live.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id, effective_from) values ($1, 'whatsapp', $2, 5, $3, clock_timestamp())`, [
        t.tenant,
        granted,
        randomUUID(),
      ]);
    const modeIn = (shop: { tenant: string; owner: string }, via: string, kind: string, recipient: string, channel = 'whatsapp') =>
      tx(liveApp, { tenant_id: shop.tenant, actor_id: shop.owner, via, command: kind === 'customer' ? 'booking.confirm' : 'reorder.place' }, async (c) => {
        const body = `To ${recipient}`;
        const textId = await one(c, `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'template', '\\x00') returning id`, [shop.tenant, body]);
        const m = await one(
          c,
          `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256, campaign_id) values ($1, $2, $3, $4, 'reorder', $5, $6, $7) returning id`,
          [shop.tenant, channel, kind, recipient, textId, sha(body), kind === 'public' ? recipient : null],
        );
        return (await c.query<{ mode: string }>('select mode from ops.delivery where message_id = $1', [m])).rows[0]?.mode;
      });
    const mode = (via: string, kind: string, recipient: string, channel = 'whatsapp') => modeIn(t, via, kind, recipient, channel);
    const grantTo = (tenant: string) =>
      plant(live.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id, effective_from) values ($1, 'whatsapp', true, 5, $2, clock_timestamp())`, [
        tenant,
        randomUUID(),
      ]);
    expect(await mode('real', 'customer', listed.customer), 'no grant yet').toBe('recorded');
    await grant(true);
    for (const contact of [listed.contact, real.k, sim.k]) {
      await tx(liveApp, ctx, async (c) => {
        const r = await one(c, `insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2) returning id`, [t.tenant, contact]);
        await c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [sha(randomUUID()), t.tenant, r]);
      });
    }
    const cases: [string, string, string, string, string?][] = [
      ['pending', 'real', 'customer', listed.customer],
      ['pending', 'real', 'supplier', real.s],
      ['recorded', 'demo', 'customer', listed.customer],
      ['recorded', 'real', 'customer', unlisted.customer],
      ['recorded', 'real', 'supplier', sim.s],
      ['recorded', 'real', 'customer', listed.customer, 'sms'],
    ];
    for (const [want, via, kind, recipient, channel] of cases) {
      expect(await mode(via, kind, recipient, channel), `${via} ${kind} ${channel ?? ''}`).toBe(want);
    }
    // An Instagram post needs no listed recipient, only the shop's Instagram grant, which it has not got.
    const post = await tx(liveApp, ctx, (c) =>
      one(c, `insert into ops.campaign (tenant_id, name, channel, segment) values ($1, 'Card', 'instagram', 'lapsed_regulars') returning id`, [t.tenant]),
    );
    expect(await mode('real', 'public', post, 'instagram'), 'an Instagram post with no grant').toBe('recorded');
    await grant(false);
    expect(await mode('real', 'customer', listed.customer), 'after the grant is withdrawn').toBe('recorded');
    // A real shop still pending (D-080) lists no recipient and stores no text (a_open, MS020), so it sends nothing; once
    // the operator accepts it, its owner's own test send, with the grant, a real session and the owner listed, is real.
    const p = { tenant: randomUUID(), owner: randomUUID() };
    const pctx = { tenant_id: p.tenant, actor_id: p.owner };
    await tx(liveApp, pctx, async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Pending shop', 'kirana', 'live')`, [p.tenant]);
      await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('live-pending', $1)`, [p.tenant]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, phone_e164, role) values ($1, $2, 'Owner', '+919800000777', 'owner')`, [p.tenant, p.owner]);
    });
    await grantTo(p.tenant);
    const list = () => tx(liveApp, pctx, (c) => c.query('insert into ops.channel_recipient (tenant_id, member_id) values ($1, $2)', [p.tenant, p.owner]));
    expect((await refused(list())).code).toBe('MS020');
    const testSend = () =>
      tx(liveApp, { ...pctx, via: 'real' }, async (c) => {
        const textId = await one(c, `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, 'Test', 'template', '\\x00') returning id`, [p.tenant]);
        const d = await one(
          c,
          `insert into ops.delivery (tenant_id, test_member_id, test_text_id, channel, to_address, mode, status, attempts, sent_at, not_after)
           values ($1, $2, $3, 'whatsapp', '+911111111111', 'cloud_api', 'sent', 1, now(), now()) returning id`,
          [p.tenant, p.owner, textId],
        );
        return (await c.query<{ mode: string }>('select mode from ops.delivery where id = $1', [d])).rows[0]?.mode;
      });
    expect((await refused(testSend())).code, 'a pending real shop').toBe('MS020');
    await acceptTenant(live.admin, p.tenant);
    await list();
    expect(await testSend(), 'the same shop, accepted').toBe('pending');
    // A sample shop on this same deployment (a sandbox), with the grant, a real via and a listed customer: recorded.
    const sample = { tenant: randomUUID(), owner: randomUUID() };
    await tx(liveApp, { tenant_id: sample.tenant, actor_id: sample.owner }, async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class, sandbox) values ($1, 'Sample', 'kirana', 'synthetic', true)`, [sample.tenant]);
      await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('live-sample', $1)`, [sample.tenant]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [sample.tenant, sample.owner]);
    });
    const sampleCustomer = await customerWithPhone(sample, liveApp);
    // No test recipient is listed on a sample shop (D-080): no real path grants it a channel (GRANT1, 03-pending). The
    // past where both exist is planted, with an acceptance too, and still records.
    const sampleListing = await refused(
      tx(liveApp, { tenant_id: sample.tenant, actor_id: sample.owner }, (c) =>
        c.query('insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2)', [sample.tenant, sampleCustomer.contact]),
      ),
    );
    // A sample shop lists no test recipient, whatever its grant (D-080).
    expect(sampleListing.message).toBe("recipient refused: test recipients are a real shop's");
    await grantTo(sample.tenant);
    const planted = randomUUID();
    await plant(live.admin, `insert into ops.channel_recipient (tenant_id, id, channel, contact_id, added_by, created_txid) values ($1, $2, 'whatsapp', $3, $4, 0)`, [
      sample.tenant,
      planted,
      sampleCustomer.contact,
      sample.owner,
    ]);
    await plant(live.admin, `insert into platform.tenant_acceptance (tenant_id) values ($1)`, [sample.tenant]);
    expect(await modeIn(sample, 'real', 'customer', sampleCustomer.customer), 'a sample shop on the live deployment').toBe('recorded');
  } finally {
    await live.close();
  }
  // On this demo database everything else holding still records: the planted grant and a listed customer.
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 5, $2)`, [
    f.tenant,
    randomUUID(),
  ]);
  const m = await tx(app, { ...owner(), via: 'real', command: 'booking.confirm' }, (c) => message(c, { kind: 'customer', recipient: f.customer }));
  expect((await deliveryOf(m)).mode).toBe('recorded');
});

it('ROLE1 a campaign is composed by an active owner or manager and moves composing → proposed → approved or rejected (or back), approved → sent; its copy changes only while composing; its card is a card', async () => {
  const create = (actor: string, status = 'composing') =>
    tx(app, { tenant_id: f.tenant, actor_id: actor }, (c) =>
      one(c, `insert into ops.campaign (tenant_id, name, channel, segment, status) values ($1, 'Diwali', 'whatsapp', 'bought_within_days', $2) returning id`, [f.tenant, status]),
    );
  expect((await refused(create(f.staff))).code).toBe('MS007');
  expect((await refused(create(f.owner, 'approved'))).code).toBe('MS010');
  const id = await create(f.manager);
  const set = (sql: string, params: unknown[] = []) => tx(app, owner(), (c) => c.query(`update ops.campaign set ${sql} where id = $1`, [id, ...params]));
  expect((await refused(set(`status = 'approved'`))).message).toBe('campaign refused: a campaign moves composing → approved');
  expect((await refused(set('card_document_id = $2', [f.document]))).message).toBe("campaign refused: a campaign's card is a card document");
  const copy = await tx(app, owner(), (c) => text(c, 'Come back for Diwali'));
  await set('copy_text_id = $2', [copy]);
  await set(`status = 'proposed'`);
  expect((await refused(set('copy_text_id = null'))).message).toBe('campaign refused: the copy and card change only while composing');
  await set(`status = 'approved'`);
  await set(`status = 'sent'`);
  expect((await refused(set(`status = 'composing'`))).code).toBe('MS010');
});

it("AI1-MARK a campaign is marked written by AI when a run's text becomes its copy, and the mark never goes back: not by a person's edit, an erased text, or anyone's write", async () => {
  const words = (author: 'member' | 'run', body: string) =>
    tx(app, owner(), (c) =>
      one(c, `insert into ops.message_text (tenant_id, body, author, run_id, body_sha256) values ($1, $2, $3, $4, '\\x00') returning id`, [
        f.tenant,
        body,
        author,
        author === 'run' ? f.run : null,
      ]),
    );
  const create = (copy: string | null) =>
    tx(app, owner(), (c) =>
      one(c, `insert into ops.campaign (tenant_id, name, channel, segment, copy_text_id, ai_drafted) values ($1, 'Mark', 'whatsapp', 'lapsed_regulars', $2, true) returning id`, [
        f.tenant,
        copy,
      ]),
    );
  const mark = async (id: string) => (await db.admin.query<{ ai_drafted: boolean }>('select ai_drafted from ops.campaign where id = $1', [id])).rows[0]?.ai_drafted;
  const setCopy = (id: string, copy: string) => tx(app, owner(), (c) => c.query('update ops.campaign set copy_text_id = $2 where id = $1', [id, copy]));
  // A caller's `true` is not taken: the mark is the database's.
  const id = await create(null);
  expect(await mark(id)).toBe(false);
  await setCopy(id, await words('member', 'Our own words'));
  expect(await mark(id), "a person's words").toBe(false);
  const runWords = await words('run', 'Words a run wrote');
  await setCopy(id, runWords);
  expect(await mark(id), "a run's words").toBe(true);
  await setCopy(id, await words('member', 'Edited by a person'));
  expect(await mark(id), "a person's edit of a run's copy").toBe(true);
  // The run's words erased (an owner's erasure): the mark stays.
  await tx(app, owner(), (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [runWords]));
  expect(await mark(id), 'after the erasure').toBe(true);
  // No runtime role writes the mark itself.
  for (const [role, ctx] of [['munshi_app', owner()], ['munshi_jobs', { tenant_id: f.tenant }]] as const) {
    expect((await refused(tx(db.as(role), ctx, (c) => c.query('update ops.campaign set ai_drafted = false where id = $1', [id])))).code, role).toBe('42501');
  }
  expect(await mark(id)).toBe(true);
  // The jobs role reads the mark, so a jobs path that renders the words can add the disclosure line.
  const { rows } = await tx(jobs, { tenant_id: f.tenant }, (c) => c.query('select ai_drafted from ops.campaign where id = $1', [id]));
  expect(rows).toEqual([{ ai_drafted: true }]);
  // A campaign created over a run's words is marked from the start.
  expect(await mark(await create(await words('run', 'Fresh run words')))).toBe(true);
});

it('ROLE1 an inbox message is stored by the webhook with no actor, its media filled once by the webhook, its transcript once by a member’s run, handled once by an active member; the jobs role only erases', async () => {
  const store = (pool: pg.Pool, ctx: Record<string, string>) =>
    tx(pool, ctx, (c) =>
      c.query(`insert into ops.inbound_message (tenant_id, provider_message_id, from_address, kind, received_at) values ($1, $2, '919800000777', 'audio', now())`, [
        f.tenant,
        `wamid.${randomUUID()}`,
      ]),
    );
  expect((await refused(store(pub, owner()))).code, 'the webhook with an actor').toBe('MS018');
  expect((await refused(store(app, owner()))).code, 'the app').toBe('42501');
  expect((await refused(store(jobs, { tenant_id: f.tenant }))).code, 'the jobs role').toBe('42501');
  const msg = await inbound('');
  const audio = await tx(app, owner(), (c) =>
    one(c, `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'voice', 'upload', $2, $3, 'audio/ogg', 900) returning id`, [
      f.tenant,
      `t-${f.tenant}/voice/${randomUUID()}.ogg`,
      sha(randomUUID()),
    ]),
  );
  const set = (pool: pg.Pool, ctx: Record<string, string>, sql: string, params: unknown[] = []) =>
    tx(pool, ctx, (c) => c.query(`update ops.inbound_message set ${sql} where id = $1`, [msg, ...params]));
  expect((await refused(set(app, owner(), 'media_document_id = $2, media_at = now()', [audio]))).code, 'the app fills media').toBe('42501');
  await set(pub, { tenant_id: f.tenant }, 'media_document_id = $2, media_at = now()', [audio]);
  expect((await refused(set(jobs, { tenant_id: f.tenant }, `transcript = 'hello', transcribed_at = now()`))).code, 'the jobs role transcribes').toBe('42501');
  await set(app, owner(), `transcript = 'Do you have tea', transcribed_at = now()`);
  expect((await refused(set(app, owner(), `transcript = 'Something else'`))).code, 'a second transcript').toBe('MS011');
  expect((await refused(set(jobs, { tenant_id: f.tenant }, `status = 'handled'`))).code, 'the jobs role handles').toBe('42501');
  await set(app, owner(), `status = 'ignored'`);
  expect((await refused(set(app, owner(), `status = 'handled'`))).message).toBe('inbound refused: an active member handles a new message once');
});

it('RET1 a text nothing names is purged 30 days after it was written, never sooner, nor while a message, test send, answer, open campaign or order line names it', async () => {
  const written = (body: string, daysAgo: number) =>
    tx(app, owner(), (c) => text(c, body)).then(async (id) => {
      await plant(db.admin, `update ops.message_text set created_at = now() - make_interval(days => $2) where id = $1`, [id, daysAgo]);
      return id;
    });
  const purge = (id: string) => tx(jobs, { tenant_id: f.tenant }, (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [id]));
  const campaign = (status: string, copy: string) =>
    plant(db.admin, `insert into ops.campaign (tenant_id, name, channel, segment, status, copy_text_id, created_by) values ($1, 'C', 'whatsapp', 'lapsed_regulars', $2, $3, $4)`, [
      f.tenant,
      status,
      copy,
      f.owner,
    ]);
  const [orphan, young, openCopy, rejectedCopy, note] = [
    await written('A rejected draft’s reply', 31),
    await written('Written last week', 29),
    await written('An open campaign’s copy', 31),
    await written('A rejected campaign’s copy', 31),
    await written('Stitch the hem short', 31),
  ];
  await campaign('proposed', openCopy);
  await campaign('rejected', rejectedCopy);
  await plant(db.admin, 'update books.order_line set note_text_id = $2 where order_id = $1', [f.order, note]);
  for (const id of [young, openCopy, note]) expect((await refused(purge(id))).code).toBe('MS007');
  await purge(orphan);
  await purge(rejectedCopy);
});

it('R1 a contact’s erasure removes the test recipient it was and erases its route, in the same update', async () => {
  const r = await signUp(db, 'message-erase', { dataClass: 'live' }); // test recipients are a real shop's (D-080)
  const ctx = { tenant_id: r.tenant, actor_id: r.owner };
  const p = await customerWithPhone(r);
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 5, $2)`, [
    r.tenant,
    randomUUID(),
  ]);
  const recipient = await tx(app, ctx, async (c) => {
    const id = await one(c, `insert into ops.channel_recipient (tenant_id, contact_id) values ($1, $2) returning id`, [r.tenant, p.contact]);
    await c.query('insert into ops.phone_route (phone_hmac, tenant_id, recipient_id) values ($1, $2, $3)', [sha(randomUUID()), r.tenant, id]);
    return id;
  });
  await tx(app, ctx, (c) =>
    c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [p.contact, r.owner]),
  );
  const { rows } = await db.admin.query(
    `select r.removed_at is not null as removed, p.phone_hmac is null and p.erased_at is not null as route_erased
       from ops.channel_recipient r join ops.phone_route p on p.recipient_id = r.id where r.id = $1`,
    [recipient],
  );
  expect(rows).toEqual([{ removed: true, route_erased: true }]);
});

// The webhook stores it (it reads back nothing of it); the opt-out flag is read as the superuser.
const igInbound = async (tenant: string, text: string, account: string, from = '17841400000000001') => {
  const id = randomUUID();
  await tx(pub, { tenant_id: tenant }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, id, channel, provider_message_id, from_address, account_ref, kind, text, received_at)
       values ($1, $2, 'instagram', $3, $4, $5, 'text', $6, now())`,
      [tenant, id, `ig.${randomUUID()}`, from, account, text],
    ),
  );
  return (await db.admin.query<{ opt_out: boolean }>('select opt_out from ops.inbound_message where id = $1', [id])).rows[0]?.opt_out;
};
const igGrant = (tenant: string, granted: boolean, account: string) =>
  plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id, effective_from) values ($1, 'instagram', $2, 0, $3, $4, clock_timestamp())`, [
    tenant,
    granted,
    account,
    randomUUID(),
  ]);

it('IG1 the bare-STOP rule is WhatsApp’s: on Instagram a STOP is a message like any other', async () => {
  expect((await db.admin.query('select opt_out from ops.inbound_message where id = $1', [await inbound('stop')])).rows).toEqual([{ opt_out: true }]);
  const r = await signUp(db, 'ig-stop', { dataClass: 'live' });
  await igGrant(r.tenant, true, 'ig_stop');
  expect(await igInbound(r.tenant, 'STOP', 'ig_stop')).toBe(false);
});

it('IG2 an Instagram message, from the sender’s Instagram-scoped id, reaches only a real shop whose latest Instagram grant grants it for the account it was sent to; the webhook finds the shop by the grant’s account', async () => {
  const r = await signUp(db, 'ig-real', { dataClass: 'live' });
  const refusedHere = await refused(igInbound(r.tenant, 'Is the kurta in stock?', 'ig_real_shop'));
  expect([refusedHere.code, refusedHere.message]).toEqual(['MS007', 'inbound refused: an Instagram message reaches only the shop granted Instagram for its account']);
  await igGrant(r.tenant, true, 'ig_real_shop');
  expect(await igInbound(r.tenant, 'Is the kurta in stock?', 'ig_real_shop')).toBe(false);
  // Sent to another account than the shop's: refused; an Instagram row names its account, a WhatsApp row none.
  expect((await refused(igInbound(r.tenant, 'Wrong door', 'ig_other_shop'))).code).toBe('MS007');
  const unnamed = await refused(
    tx(pub, { tenant_id: r.tenant }, (c) =>
      c.query(`insert into ops.inbound_message (tenant_id, channel, provider_message_id, from_address, kind, text, received_at) values ($1, 'instagram', $2, '1784', 'text', 'Hi', now())`, [
        r.tenant,
        `ig.${randomUUID()}`,
      ]),
    ),
  );
  expect(unnamed.code).toBe('MS007');
  const named = await refused(
    tx(pub, { tenant_id: r.tenant }, (c) =>
      c.query(
        `insert into ops.inbound_message (tenant_id, channel, provider_message_id, from_address, account_ref, kind, text, received_at) values ($1, 'whatsapp', $2, '919800000001', 'ig_real_shop', 'text', 'Hi', now())`,
        [r.tenant, `wamid.${randomUUID()}`],
      ),
    ),
  );
  expect(named.code).toBe('23514');
  // The webhook, with no shop context yet, reads the grant's account to find the shop, and no other column.
  const { rows } = await tx(pub, {}, (c) =>
    c.query(`select tenant_id from platform.channel_grant where channel = 'instagram' and account_ref = 'ig_real_shop' and granted order by effective_from desc, id desc limit 1`),
  );
  expect(rows).toEqual([{ tenant_id: r.tenant }]);
  expect((await refused(tx(pub, {}, (c) => c.query('select change_id from platform.channel_grant')))).code).toBe('42501');
  // The webhook reads Instagram grants only: a WhatsApp grant's row is no webhook's business.
  await plant(db.admin, `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, change_id) values ($1, 'whatsapp', true, 2, $2)`, [
    r.tenant,
    randomUUID(),
  ]);
  const seen = await tx(pub, {}, (c) => c.query('select distinct channel from platform.channel_grant where tenant_id = $1', [r.tenant]));
  expect(seen.rows).toEqual([{ channel: 'instagram' }]);
  // A sample shop (no real path grants it) and a withdrawn grant take none.
  expect((await refused(igInbound(f.tenant, 'Hello', 'ig_real_shop'))).code).toBe('MS007');
  await igGrant(r.tenant, false, 'ig_real_shop');
  expect((await refused(igInbound(r.tenant, 'Hello again', 'ig_real_shop'))).code).toBe('MS007');
});

it('IG3 a post’s card is public once its Instagram campaign is approved or sent, never while composing or for a WhatsApp campaign; the sender reads which card a campaign names', async () => {
  const card = await tx(app, owner(), (c) =>
    one(c, `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'card', 'upload', $2, $3, 'image/jpeg', 2000) returning id`, [
      f.tenant,
      `t-${f.tenant}/card/${randomUUID()}.jpg`,
      sha(randomUUID()),
    ]),
  );
  const campaign = (channel: string) =>
    tx(app, owner(), (c) =>
      one(c, `insert into ops.campaign (tenant_id, name, channel, segment, segment_days, card_document_id) values ($1, 'Festive post', $2, 'bought_within_days', 30, $3) returning id`, [
        f.tenant,
        channel,
        card,
      ]),
    );
  const move = (id: string, status: string) => tx(app, owner(), (c) => c.query('update ops.campaign set status = $2 where id = $1', [id, status]));
  const seen = async () => (await tx(pub, { tenant_id: f.tenant }, (c) => c.query('select id from ops.document where id = $1', [card]))).rowCount;
  const wa = await campaign('whatsapp');
  await move(wa, 'proposed');
  await move(wa, 'approved');
  expect(await seen(), 'a WhatsApp campaign').toBe(0);
  const ig = await campaign('instagram');
  expect(await seen(), 'composing').toBe(0);
  await move(ig, 'proposed');
  expect(await seen(), 'proposed').toBe(0);
  await move(ig, 'approved');
  expect(await seen(), 'approved').toBe(1);
  await move(ig, 'sent');
  expect(await seen(), 'sent').toBe(1);
  // Another shop's context sees none of it.
  expect((await tx(pub, { tenant_id: randomUUID() }, (c) => c.query('select id from ops.document where id = $1', [card]))).rowCount).toBe(0);
  const { rows } = await tx(jobs, { tenant_id: f.tenant }, (c) => c.query('select card_document_id from ops.campaign where id = $1', [ig]));
  expect(rows).toEqual([{ card_document_id: card }]);
  // The public sees no other campaign of the shop: not the WhatsApp one, not the fill's composing one.
  const visible = await tx(pub, { tenant_id: f.tenant }, (c) => c.query('select card_document_id from ops.campaign'));
  expect(visible.rows).toEqual([{ card_document_id: card }]);
});

it('STUCK1 a delivery sending for more than a day takes a final_at from the jobs role, its status unchanged, so the address purge reaches it; never sooner, by another role, or with another change', async () => {
  const [stuck, fresh] = [await send('reorder.place', { body: 'Stuck reorder' }), await send('reorder.place', { body: 'Fresh reorder' })];
  const [d, e] = [(await deliveryOf(stuck)).id as string, (await deliveryOf(fresh)).id as string];
  for (const id of [d, e]) await moveDelivery(jobs, id, `status = 'sending'`);
  await plant(db.admin, `update ops.delivery set claimed_at = now() - interval '25 hours' where id = $1`, [d]);
  const finalise = (id: string, extra = '', pool = jobs) => moveDelivery(pool, id, `final_at = now()${extra}`);
  expect((await refused(finalise(e))).code, 'sending for under a day').toBe('MS010');
  expect((await refused(finalise(d, `, error_code = '131000'`))).code, 'with another change').toBe('MS010');
  expect((await refused(finalise(d, '', pub))).code, 'the webhook').toBe('MS010');
  await finalise(d);
  expect(await deliveryOf(stuck)).toMatchObject({ status: 'sending', final: true });
  expect((await refused(finalise(d))).code, 'once').toBe('MS010');
  await plant(db.admin, `update ops.delivery set final_at = now() - interval '31 days' where id = $1`, [d]);
  await moveDelivery(jobs, d, 'to_address = null, erased_at = now()');
  expect(await deliveryOf(stuck)).toMatchObject({ status: 'sending', to_address: null });
});
