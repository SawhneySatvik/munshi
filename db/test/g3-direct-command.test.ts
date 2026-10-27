// G3: a direct command writes the books only for an active member of this tenant whose role holds that command.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BOOK_TABLES, openTestDb, refused, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  b = await seedTenant(db.app, 'B');
  await db.sabotage();
});
afterAll(() => db.close());

const writeSale = (c: pg.PoolClient, t: Tenant) =>
  c.query(
    `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, now(), 1000, 'INR')
     returning id, created_by, decision_id`,
    [t.tenant, t.shop],
  );
const writePrice = (c: pg.PoolClient, t: Tenant) =>
  c.query(`insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 900, 'INR', now())`, [
    t.tenant,
    t.item,
  ]);
const REFUSED = { code: 'MS001', message: 'book write refused: the acting member may not run this command' };

it('G3 a member with the authority may run the command, stamped and audited', async () => {
  const { row, audit } = await tx(db.app, { tenant: a.tenant, actor: a.staffMember, command: 'sale.record' }, async (c) => {
    const row = (await writeSale(c, a)).rows[0];
    const audit = await c.query('select actor_id, decision_id, command from audit.audit_log where tenant_id = $1 and entity_id = $2', [
      a.tenant,
      row.id,
    ]);
    return { row, audit: audit.rows };
  });
  expect(row).toMatchObject({ created_by: a.staffMember, decision_id: null });
  expect(audit).toEqual([{ actor_id: a.staffMember, decision_id: null, command: 'sale.record' }]);
});

it('G3 a member without the authority is refused', async () => {
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: a.staffMember, command: 'price.set' }, (c) => writePrice(c, a)));
  expect(r).toEqual(REFUSED);
});

it('G3 staff holding sale.record cannot write books.price', async () => {
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: a.staffMember, command: 'sale.record' }, (c) => writePrice(c, a)));
  expect(r).toEqual({ code: 'MS001', message: 'book write refused: sale.record does not write books.price' });
});

it('G3 every held command writes named book tables, and every book table has a command', async () => {
  const held = (await db.admin.query<{ command: string }>('select distinct command from ops.command_authority order by command')).rows;
  const mapped = (
    await db.admin.query<{ command: string; rels: string[] }>(
      'select command, array_agg(rel order by rel)::text[] as rels from ops.command_table group by command order by command',
    )
  ).rows;
  console.log(`G3 ${held.length} held commands; ${mapped.length} commands write ${mapped.reduce((n, m) => n + m.rels.length, 0)} (command, table) pairs`);
  expect(held.length).toBeGreaterThan(0);
  expect(mapped.map((m) => m.command)).toEqual(held.map((h) => h.command));
  expect([...new Set(mapped.flatMap((m) => m.rels))].sort()).toEqual([...BOOK_TABLES].sort());
  // The tables the fixture's counter sale writes.
  expect(mapped.find((m) => m.command === 'sale.record')?.rels).toEqual([
    'books.credit_entry',
    'books.journal_entry',
    'books.journal_line',
    'books.payment',
    'books.sale',
    'books.sale_line',
    'books.stock_move',
  ]);
});

it('G3 a member of another tenant is refused', async () => {
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: b.owner, command: 'sale.record' }, (c) => writeSale(c, a)));
  expect(r).toEqual(REFUSED);
});

it('G3 an inactive member is refused', async () => {
  const gone = randomUUID();
  await tx(db.app, { tenant: a.tenant, actor: a.owner }, (c) =>
    c.query(`insert into ops.member (tenant_id, id, name, role, active) values ($1, $2, 'Former owner (synthetic)', 'owner', false)`, [
      a.tenant,
      gone,
    ]),
  );
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: gone, command: 'sale.record' }, (c) => writeSale(c, a)));
  expect(r).toEqual(REFUSED);
});

it('G3 no runtime role can change who holds which command, or which tables a command writes', async () => {
  for (const table of ['ops.command_authority', 'ops.command_table']) {
    const { rows } = await db.admin.query(
      `select r as role, has_table_privilege(r, $1, 'SELECT') as sel, has_any_column_privilege(r, $1, 'INSERT') as ins,
              has_any_column_privilege(r, $1, 'UPDATE') as upd, has_table_privilege(r, $1, 'DELETE') as del,
              has_table_privilege(r, $1, 'TRUNCATE') as trunc
         from unnest(array['munshi_app', 'munshi_agent']) as r order by r`,
      [table],
    );
    expect(rows, table).toEqual([
      { role: 'munshi_agent', sel: false, ins: false, upd: false, del: false, trunc: false },
      { role: 'munshi_app', sel: true, ins: false, upd: false, del: false, trunc: false },
    ]);
    const seeded = await db.admin.query(`select count(*)::int as n from ${table}`);
    expect(seeded.rows[0].n, table).toBeGreaterThan(0);
  }
});
