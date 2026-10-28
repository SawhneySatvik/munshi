// MS-19a, 0012: real people's names and phones live only in the erasable ops.contact vault on showcase and live tenants
// (PII1); a contact is added by a member and erased only as an owner's request or the retention purge; and the two
// shared rules (OE1): ops.only_erase (personal columns go to NULL only in a whole erasure, never refilled, then frozen)
// and ops.fill_once (filled once, with its stamp). The fill-once case runs on a scratch table shaped like 0016's inbound
// message, which carries both triggers.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Ctx, openTestDb, refused, type TestDb, tx } from './db.ts';

type Shop = { tenant: string; owner: string; manager: string; staff: string };
let demo: TestDb; // no deployment row: demo
let live: TestDb; // ops.deployment = live
let synthetic: Shop;
let showcase: Shop;
let liveShop: Shop;

const tenantOf = async (db: TestDb, dataClass: string): Promise<Shop> => {
  const s = { tenant: randomUUID(), owner: randomUUID(), manager: randomUUID(), staff: randomUUID() };
  await tx(db.app, { tenant: s.tenant, actor: s.owner }, async (c) => {
    await c.query('insert into ops.tenant (tenant_id, name, data_class) values ($1, $2, $3)', [s.tenant, `A ${dataClass} shop`, dataClass]);
    for (const [id, role] of [
      [s.owner, 'owner'],
      [s.manager, 'manager'],
      [s.staff, 'staff'],
    ]) {
      await c.query('insert into ops.member (tenant_id, id, name, role) values ($1, $2, $3, $4)', [s.tenant, id, `${role} (synthetic)`, role]);
    }
  });
  return s;
};

beforeAll(async () => {
  [demo, live] = await Promise.all([openTestDb(), openTestDb()]);
  await live.admin.query("begin; set local role munshi_owner; insert into ops.deployment (kind) values ('live'); commit;");
  synthetic = await tenantOf(demo, 'synthetic');
  showcase = await tenantOf(demo, 'showcase');
  liveShop = await tenantOf(live, 'live');
  await demo.admin.query(`
    create table public.oe1_inbound (id int primary key, from_address text, body text, transcript text, transcribed_at timestamptz, erased_at timestamptz);
    create trigger erase before update on public.oe1_inbound for each row execute function ops.only_erase('from_address', 'body');
    create trigger fill before update on public.oe1_inbound for each row execute function ops.fill_once('transcript', 'transcribed_at');`);
  for (const db of [demo, live]) await db.sabotage();
});
afterAll(() => Promise.all([demo.close(), live.close()]));

const addContact = (db: TestDb, s: Shop, name: string, phone: string | null, by = s.owner) =>
  tx(db.app, { tenant: s.tenant, actor: by }, async (c) =>
    (await c.query<{ id: string }>('insert into ops.contact (tenant_id, name, phone_e164) values ($1, $2, $3) returning id', [s.tenant, name, phone])).rows[0]
      ?.id as string,
  );
const COMMAND = { 'books.customer': 'customer.create', 'books.staff': 'staff.create', 'books.supplier': 'supplier.create' } as const;
const addPerson = (db: TestDb, s: Shop, table: keyof typeof COMMAND, row: { name?: string; phone?: string; contact?: string }) =>
  tx(db.app, { tenant: s.tenant, actor: s.owner, command: COMMAND[table] }, (c) =>
    c.query(`insert into ${table} (tenant_id, name, phone, contact_id) values ($1, $2, $3, $4) returning name, phone, contact_id`, [
      s.tenant,
      row.name ?? null,
      row.phone ?? null,
      row.contact ?? null,
    ]),
  );
// Moves a row's created_at two years back, with the triggers off (only a superuser can), as if written then.
const backdate = (table: string, id: string) =>
  demo.admin.query(
    `begin; set local session_replication_role = replica; update ${table} set created_at = now() - interval '2 years' where id = '${id}'; commit;`,
  );
const update = (db: TestDb, s: Shop, ctx: Ctx, sql: string, params: unknown[] = []) =>
  tx(db.app, { tenant: s.tenant, ...ctx }, async (c) => {
    for (const statement of sql.split(';').filter((x) => x.trim())) await c.query(statement, params);
  });

it('PII1 a showcase or live tenant names a customer, staff member or supplier only through the vault; the synthetic kirana keeps its names', async () => {
  let checked = 0;
  for (const [db, s] of [
    [demo, showcase],
    [live, liveShop],
  ] as const) {
    for (const table of ['books.customer', 'books.staff', 'books.supplier'] as const) {
      for (const row of [{ name: 'Planted Person' }, { name: 'Planted Person', phone: '+919800000201' }]) {
        expect(await refused(addPerson(db, s, table, row)), `${table} ${JSON.stringify(row)}`).toEqual({
          code: 'MS008',
          message: expect.stringMatching(/^book write refused: on a (showcase|live) tenant, books\.(customer|staff|supplier) names a person only through ops\.contact$/),
        });
      }
      const contact = await addContact(db, s, 'Planted Person', null);
      expect((await addPerson(db, s, table, { contact })).rows).toEqual([{ name: null, phone: null, contact_id: contact }]);
      // Never a name or a phone beside a contact.
      expect((await refused(addPerson(db, s, table, { contact, name: 'Planted Person' }))).code).toBe('23514');
      expect((await refused(addPerson(db, s, table, { contact, phone: '+919800000201' }))).code).toBe('23514');
      checked++;
    }
  }
  console.log(`PII1 ${checked} (tenant class, table) pairs refuse a name or a phone in the books`);
  expect(checked).toBe(6);
  for (const table of ['books.customer', 'books.staff', 'books.supplier'] as const) {
    expect((await addPerson(demo, synthetic, table, { name: 'Invented customer (synthetic)', phone: '+919800000202' })).rowCount).toBe(1);
  }
});

it("PII1 a contact is added by an active member, and erased only as an active owner's request or the retention purge, audited by id alone", async () => {
  const s = synthetic;
  const contactOf = async (id: string) =>
    (await demo.admin.query('select created_by, erased_by, erase_reason, erase_requested_at is not null as requested from ops.contact where id = $1', [id])).rows[0];
  const id = await addContact(demo, s, 'Meena (synthetic)', '+919800000301', s.staff);
  expect(await contactOf(id)).toEqual({ created_by: s.staff, erased_by: null, erase_reason: null, requested: false });
  expect(await refused(tx(demo.app, { tenant: s.tenant }, (c) => c.query(`insert into ops.contact (tenant_id, name) values ($1, 'No one')`, [s.tenant])))).toEqual({
    code: 'MS007',
    message: 'contact refused: a contact is added by an active member',
  });
  expect(
    (await refused(tx(demo.app, { tenant: s.tenant, actor: s.owner }, (c) => c.query(`insert into ops.contact (tenant_id, name, erased_at) values ($1, 'x', now())`, [s.tenant]))))
      .code,
  ).toBe('MS007');

  const erase = (ctx: Ctx, reason: string, by: string | null) =>
    update(demo, s, ctx, `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = $3 where id = $1`, [id, by, reason]);
  const SHAPE = { code: 'MS007', message: "contact refused: an erasure is an active owner's request or the retention purge" };
  expect(await refused(erase({ actor: s.manager }, 'request', s.manager))).toEqual(SHAPE);
  expect(await refused(erase({ actor: s.owner }, 'request', s.manager))).toEqual(SHAPE); // erased_by is the owner
  expect(await refused(erase({ actor: s.owner }, 'retention', s.owner))).toEqual(SHAPE);
  expect(await refused(erase({}, 'request', null))).toEqual(SHAPE); // the purge records retention

  const request = (actor: string) => update(demo, s, { actor }, 'update ops.contact set erase_requested_at = now() where id = $1', [id]);
  const ONCE = { code: 'MS007', message: 'contact refused: erasure is requested once, by an active owner' };
  expect(await refused(request(s.manager))).toEqual(ONCE);
  await request(s.owner);
  expect(await refused(request(s.owner))).toEqual(ONCE);
  await erase({ actor: s.owner }, 'request', s.owner);
  expect(await contactOf(id)).toEqual({ created_by: s.staff, erased_by: s.owner, erase_reason: 'request', requested: true });

  // The purge: no actor, reason retention, and no audit entry (an entry always names an actor). The database checks its
  // condition: a contact added today, or a year-old one whose customer row is new, is not idle for a year.
  const purged = await addContact(demo, s, 'Old customer (synthetic)', '+919800000302');
  const customer = randomUUID();
  await tx(demo.app, { tenant: s.tenant, actor: s.owner, command: 'customer.create' }, (c) =>
    c.query('insert into books.customer (tenant_id, id, contact_id) values ($1, $2, $3)', [s.tenant, customer, purged]),
  );
  const PURGE = `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where id = $1`;
  const IDLE = { code: 'MS007', message: 'contact refused: the retention purge erases only a contact idle for a year, or one whose erasure was requested' };
  expect(await refused(update(demo, s, {}, PURGE, [purged]))).toEqual(IDLE);
  await backdate('ops.contact', purged);
  expect(await refused(update(demo, s, {}, PURGE, [purged]))).toEqual(IDLE);
  await backdate('books.customer', customer);
  await update(demo, s, {}, PURGE, [purged]);
  const { rows } = await demo.admin.query(
    `select entity_id, actor_id, action, payload from audit.audit_log where entity = 'ops.contact' and entity_id = any($1::uuid[]) order by seq`,
    [[id, purged]],
  );
  expect(rows).toEqual([
    { entity_id: id, actor_id: s.staff, action: 'contact.add', payload: { contact_id: id } },
    { entity_id: id, actor_id: s.owner, action: 'contact.erase_request', payload: { contact_id: id } },
    { entity_id: id, actor_id: s.owner, action: 'contact.erase', payload: { contact_id: id } },
    { entity_id: purged, actor_id: s.owner, action: 'contact.add', payload: { contact_id: purged } },
  ]);
});

it('PII1 the retention purge never erases a person a credit balance holds; an erasure the owner requested completes once it clears', async () => {
  const s = synthetic;
  const contact = await addContact(demo, s, 'Owing customer (synthetic)', '+919800000303');
  const customer = randomUUID();
  await tx(demo.app, { tenant: s.tenant, actor: s.owner, command: 'customer.create' }, (c) =>
    c.query('insert into books.customer (tenant_id, id, contact_id) values ($1, $2, $3)', [s.tenant, customer, contact]),
  );
  const credit = (amount: number) =>
    tx(demo.app, { tenant: s.tenant, actor: s.owner, command: 'credit.record' }, (c) =>
      c.query(`insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, at) values ($1, $2, $3, 'INR', now())`, [s.tenant, customer, amount]),
    );
  await credit(50_000);
  await update(demo, s, { actor: s.owner }, 'update ops.contact set erase_requested_at = now() where id = $1', [contact]);
  const PURGE = `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where id = $1`;
  const BALANCE = { code: 'MS007', message: 'contact refused: the retention purge never erases a person a balance holds' };
  expect(await refused(update(demo, s, {}, PURGE, [contact]))).toEqual(BALANCE);
  await credit(-20_000);
  expect(await refused(update(demo, s, {}, PURGE, [contact]))).toEqual(BALANCE);
  await credit(-30_000);
  await update(demo, s, {}, PURGE, [contact]); // the held request completes: the balance is clear, though the customer is not idle
  const { rows } = await demo.admin.query('select name, phone_e164, erase_reason, erase_requested_at is not null as requested from ops.contact where id = $1', [contact]);
  expect(rows).toEqual([{ name: null, phone_e164: null, erase_reason: 'retention', requested: true }]);
});

it("OE1 a contact's phone never moves to another number: not directly, and not by emptying it and filling another", async () => {
  const s = synthetic;
  const id = await addContact(demo, s, 'Asha (synthetic)', '+919800000401');
  const on = { actor: s.owner };
  for (const sql of [
    "update ops.contact set phone_e164 = '+919800000999' where id = $1",
    'update ops.contact set phone_e164 = null where id = $1',
    "update ops.contact set phone_e164 = null where id = $1; update ops.contact set phone_e164 = '+919800000999' where id = $1",
    "update ops.contact set name = 'Someone else' where id = $1",
  ]) {
    expect(await refused(update(demo, s, on, sql, [id])), sql).toEqual({
      code: 'MS011',
      message: expect.stringMatching(/^erase refused: ops\.contact\.(phone_e164|name) changes only to NULL, in the UPDATE that sets erased_at$/),
    });
  }
  // A phone the contact never had is never filled in either.
  const noPhone = await addContact(demo, s, 'Walk-in (synthetic)', null);
  expect((await refused(update(demo, s, on, "update ops.contact set phone_e164 = '+919800000402' where id = $1", [noPhone]))).code).toBe('MS011');
  const { rows } = await demo.admin.query('select name, phone_e164 from ops.contact where id = any($1::uuid[]) order by name', [[id, noPhone]]);
  expect(rows).toEqual([
    { name: 'Asha (synthetic)', phone_e164: '+919800000401' },
    { name: 'Walk-in (synthetic)', phone_e164: null },
  ]);
});

it('OE1 an erasure nulls every personal column with erased_at = now() in one UPDATE, and the erased row never changes again', async () => {
  const s = synthetic;
  const id = await addContact(demo, s, 'Farah (synthetic)', '+919800000501');
  const on = { actor: s.owner };
  const by = `erased_by = '${s.owner}', erase_reason = 'request'`;
  for (const sql of [
    'update ops.contact set name = null where id = $1', // one column, without erased_at
    `update ops.contact set name = null, erased_at = now(), ${by} where id = $1`, // erased_at, but the phone kept
    `update ops.contact set name = null, phone_e164 = null, erased_at = now() - interval '1 day', ${by} where id = $1`,
  ]) {
    expect((await refused(update(demo, s, on, sql, [id]))).code, sql).toBe('MS011');
  }
  await update(demo, s, on, `update ops.contact set name = null, phone_e164 = null, erased_at = now(), ${by} where id = $1`, [id]);
  for (const sql of [
    'update ops.contact set erase_requested_at = now() where id = $1',
    "update ops.contact set phone_e164 = '+919800000501' where id = $1",
    `update ops.contact set erased_at = now(), ${by} where id = $1`,
  ]) {
    expect(await refused(update(demo, s, on, sql, [id])), sql).toEqual({
      code: 'MS011',
      message: 'erase refused: the ops.contact row is erased, and an erased row never changes',
    });
  }
  // The phone is free for a new contact: a changed phone means a new contact.
  expect(await addContact(demo, s, 'Farah (synthetic)', '+919800000501')).toMatch(/^[0-9a-f-]{36}$/);
});

it('OE1 a fill-once column fills once, in the UPDATE that sets its stamp, never again even after a NULL; an erasure still nulls it and freezes the row', async () => {
  const q = (sql: string) => demo.admin.query(sql);
  await q(`insert into public.oe1_inbound (id, from_address, body) values (1, '+919800000601', 'STOP')`);
  const FILL = /^fill refused: public\.oe1_inbound\.transcript is filled once/;
  for (const sql of ["update public.oe1_inbound set transcript = 'band karo' where id = 1", 'update public.oe1_inbound set transcribed_at = now() where id = 1']) {
    expect(await refused(q(sql)), sql).toEqual({ code: 'MS011', message: expect.stringMatching(FILL) });
  }
  // The first fill, with its stamp.
  await q("update public.oe1_inbound set transcript = 'band karo', transcribed_at = now() where id = 1");
  for (const sql of [
    "update public.oe1_inbound set transcript = 'something else' where id = 1",
    "update public.oe1_inbound set transcript = 'something else', transcribed_at = now() where id = 1",
    'update public.oe1_inbound set transcript = null where id = 1',
  ]) {
    expect(await refused(q(sql)), sql).toEqual({ code: 'MS011', message: expect.stringMatching(FILL) });
  }
  // A NULL that reached it some other way (triggers off, as a reset runs) does not open it again: the stamp stays.
  await q("begin; set local session_replication_role = replica; update public.oe1_inbound set transcript = null where id = 1; commit;");
  expect(await refused(q("update public.oe1_inbound set transcript = 'a second fill', transcribed_at = now() where id = 1"))).toEqual({
    code: 'MS011',
    message: expect.stringMatching(FILL),
  });
  await q("begin; set local session_replication_role = replica; update public.oe1_inbound set transcript = 'band karo' where id = 1; commit;");
  // Detaching a STOP from its sender is refused: the sender goes only in a whole erasure.
  expect((await refused(q('update public.oe1_inbound set from_address = null where id = 1'))).code).toBe('MS011');
  expect(await refused(q('update public.oe1_inbound set from_address = null, body = null, erased_at = now() where id = 1'))).toEqual({
    code: 'MS011',
    message: 'erase refused: an erasure of public.oe1_inbound nulls transcript',
  });
  await q('update public.oe1_inbound set from_address = null, body = null, transcript = null, erased_at = now() where id = 1');
  expect((await refused(q("update public.oe1_inbound set transcript = 'again', transcribed_at = now() where id = 1"))).code).toBe('MS011');
  expect((await q('select from_address, body, transcript, transcribed_at is not null as stamped from public.oe1_inbound')).rows).toEqual([
    { from_address: null, body: null, transcript: null, stamped: true },
  ]);
});

it('PII1 consent is a book: consent.record writes it for any member role, a reply names its message, it is never dated ahead, and nothing changes it', async () => {
  const s = synthetic;
  const customer = randomUUID();
  await tx(demo.app, { tenant: s.tenant, actor: s.owner, command: 'customer.create' }, (c) =>
    c.query(`insert into books.customer (tenant_id, id, name) values ($1, $2, 'Consenting customer (synthetic)')`, [s.tenant, customer]),
  );
  const write = (actor: string, command: string, values: string) =>
    tx(demo.app, { tenant: s.tenant, actor, command }, (c) =>
      c.query(
        `insert into books.customer_consent (tenant_id, customer_id, channel, purpose, granted, source, notice_version, evidence_table, evidence_id, at)
         values ($1, $2, ${values}, now()) returning created_by`,
        [s.tenant, customer],
      ),
    );
  const IN_PERSON = `'whatsapp', 'marketing', true, 'in_person', 'v1', null, null`;
  for (const actor of [s.owner, s.manager, s.staff]) {
    expect((await write(actor, 'consent.record', IN_PERSON)).rows).toEqual([{ created_by: actor }]);
  }
  expect((await refused(write(s.owner, 'customer.create', IN_PERSON))).code).toBe('MS001');
  // Dated ahead, a consent would outrank every later withdrawal and STOP: `at` is never after the row is written.
  const ahead = await refused(
    tx(demo.app, { tenant: s.tenant, actor: s.staff, command: 'consent.record' }, (c) =>
      c.query(
        `insert into books.customer_consent (tenant_id, customer_id, channel, purpose, granted, source, notice_version, at)
         values ($1, $2, 'whatsapp', 'marketing', true, 'in_person', 'v1', '2030-01-01')`,
        [s.tenant, customer],
      ),
    ),
  );
  expect(ahead).toMatchObject({ code: '23514', message: expect.stringContaining('consent_not_future') });
  // A WhatsApp reply names the message it arrived in; consent granted names the notice the person saw.
  expect((await refused(write(s.owner, 'consent.record', `'whatsapp', 'marketing', true, 'whatsapp_reply', 'v1', null, null`))).code).toBe('23514');
  expect((await refused(write(s.owner, 'consent.record', `'whatsapp', 'marketing', true, 'in_person', null, null, null`))).code).toBe('23514');
  expect((await write(s.owner, 'consent.record', `'whatsapp', 'marketing', false, 'whatsapp_reply', null, 'ops.inbound_message', gen_random_uuid()`)).rowCount).toBe(1);
  for (const sql of ['update books.customer_consent set granted = true', 'delete from books.customer_consent']) {
    expect((await refused(tx(demo.app, { tenant: s.tenant, actor: s.owner, command: 'consent.record' }, (c) => c.query(sql)))).code, sql).toBe('42501');
  }
});
