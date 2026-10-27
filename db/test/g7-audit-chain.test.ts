// G7: audit.verify_chain recomputes the tenant's hash chain and names the first broken link after a tamper or a
// deletion made as the table owner; it refuses to answer for a tenant other than the current one. An entry names the
// acting member; a book row's entry is written once, by the guard, after the row is written.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, refused, setCtx, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
let c: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  b = await seedTenant(db.app, 'B');
  c = await seedTenant(db.app, 'C');
  await db.sabotage();
});
afterAll(() => db.close());

const verify = async (t: Tenant) =>
  (await tx(db.app, { tenant: t.tenant }, (c) => c.query('select audit.verify_chain($1) as broken, count(*)::int as n from audit.audit_log', [t.tenant])))
    .rows[0] as { broken: string | null; n: number };

// As munshi_owner, which owns the table (no grant needed) but is still subject to forced RLS.
async function asOwner(t: Tenant, sql: string, params: unknown[], actor?: string): Promise<pg.QueryResult> {
  return tx(db.admin, {}, async (c: pg.PoolClient) => {
    await c.query('set local role munshi_owner');
    await setCtx(c, actor ? { tenant: t.tenant, actor } : { tenant: t.tenant });
    return c.query(sql, params);
  });
}

// munshi_app appending an entry directly, with `actor` as the acting member.
const append = (t: Tenant, actor: string, entry: { actor_id: string; entity: string; entity_id: string }) =>
  tx(db.app, { tenant: t.tenant, actor }, (client) =>
    client.query(`insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload) values ($1, $2, 'note', $3, $4, '{}')`, [
      t.tenant,
      entry.actor_id,
      entry.entity,
      entry.entity_id,
    ]),
  );
const bookEntries = async (t: Tenant, entity: string, id: string) =>
  (await db.admin.query('select count(*)::int as n from audit.audit_log where tenant_id = $1 and entity = $2 and entity_id = $3', [t.tenant, entity, id]))
    .rows[0].n as number;

it('G7 the chain verifies, then finds a tampered row', async () => {
  const clean = await verify(a);
  console.log(`G7 tenant A chain: ${clean.n} entries, first broken link ${clean.broken}`);
  expect(clean.n).toBeGreaterThanOrEqual(10);
  expect(clean.broken).toBeNull();
  const tampered = await asOwner(a, `update audit.audit_log set payload = payload || '{"amount_minor": 1}' where tenant_id = $1 and seq = 5`, [
    a.tenant,
  ]);
  expect(tampered.rowCount).toBe(1);
  expect((await verify(a)).broken).toBe('5');
  expect((await verify(b)).broken).toBeNull(); // the other tenant's chain is untouched
});

it('G7 a deleted row is found', async () => {
  expect((await verify(b)).broken).toBeNull();
  expect((await asOwner(b, 'delete from audit.audit_log where tenant_id = $1 and seq = 3', [b.tenant])).rowCount).toBe(1);
  expect((await verify(b)).broken).toBe('3');
});

it('G7 verify_chain refuses to answer for another tenant', async () => {
  const r = await refused(tx(db.app, { tenant: a.tenant }, (c) => c.query('select audit.verify_chain($1)', [b.tenant])));
  expect(r).toEqual({ code: 'MS003', message: 'verify_chain: the tenant is not the current tenant' });
});

it('G7 caller-supplied seq and hash are replaced by the chain', async () => {
  const row = await asOwner(
    c,
    `insert into audit.audit_log (tenant_id, seq, actor_id, action, entity, payload, created_at, prev_hash, hash)
     values ($1, 999, $2, 'login', 'ops.member', '{}', '2000-01-01', '\\x00', '\\x00') returning seq, created_at > '2001-01-01' as now_stamped`,
    [c.tenant, c.owner],
    c.owner,
  );
  const n = (await verify(c)).n;
  expect(row.rows[0]).toEqual({ seq: String(n), now_stamped: true });
  expect((await verify(c)).broken).toBeNull();
});

it('G7 the app appends an entry as the acting member (the accepted case)', async () => {
  const before = (await verify(c)).n;
  expect((await append(c, c.owner, { actor_id: c.owner, entity: 'ops.member', entity_id: c.owner })).rowCount).toBe(1);
  expect(await verify(c)).toEqual({ broken: null, n: before + 1 });
});

it('G7 an entry must name the acting member', async () => {
  const r = await refused(append(c, c.owner, { actor_id: c.manager, entity: 'ops.member', entity_id: c.manager }));
  expect(r).toEqual({ code: 'MS005', message: 'audit refused: actor_id is not the acting member' });
});

it('G7 an entry for a book row that was never written is refused', async () => {
  const NOT_WRITTEN = { code: 'MS005', message: 'audit refused: no such book row by this member under this decision' };
  expect(await refused(append(c, c.owner, { actor_id: c.owner, entity: 'books.price', entity_id: randomUUID() }))).toEqual(NOT_WRITTEN);
  // The item exists, but the owner wrote it, not the manager.
  expect(await refused(append(c, c.manager, { actor_id: c.manager, entity: 'books.item', entity_id: c.item }))).toEqual(NOT_WRITTEN);
});

it('G7 a book row has one audit entry; a second, however spelled, is refused', async () => {
  expect(await bookEntries(c, 'books.item', c.item)).toBe(1);
  const again = await refused(append(c, c.owner, { actor_id: c.owner, entity: 'books.item', entity_id: c.item }));
  expect(again.code, again.message).toBe('23505');
  for (const entity of ['"books".item', 'BOOKS.ITEM', 'item']) {
    const r = await refused(append(c, c.owner, { actor_id: c.owner, entity, entity_id: c.item }));
    expect(r.code, `${entity}: ${r.message}`).toBe('23514');
  }
  expect(await bookEntries(c, 'books.item', c.item)).toBe(1);
});

it('G7 an insert skipped by ON CONFLICT DO NOTHING leaves no audit entry', async () => {
  expect(await bookEntries(c, 'books.item', c.item)).toBe(1);
  const r = await tx(db.app, { tenant: c.tenant, actor: c.owner, command: 'item.create' }, (client) =>
    client.query(`insert into books.item (tenant_id, id, name, unit) values ($1, $2, 'Butter 100 g', 'pack') on conflict do nothing`, [c.tenant, c.item]),
  );
  expect(r.rowCount).toBe(0);
  expect(await bookEntries(c, 'books.item', c.item)).toBe(1);
});
