// G7: audit.verify_chain recomputes the tenant's hash chain and names the first broken link after a tamper or a
// deletion made as the table owner; it refuses to answer for a tenant other than the current one.
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
async function asOwner(t: Tenant, sql: string, params: unknown[]): Promise<number> {
  return tx(db.admin, {}, async (c: pg.PoolClient) => {
    await c.query('set local role munshi_owner');
    await setCtx(c, { tenant: t.tenant });
    return (await c.query(sql, params)).rowCount ?? 0;
  });
}

it('G7 the chain verifies, then finds a tampered row', async () => {
  const clean = await verify(a);
  console.log(`G7 tenant A chain: ${clean.n} entries, first broken link ${clean.broken}`);
  expect(clean.n).toBeGreaterThanOrEqual(10);
  expect(clean.broken).toBeNull();
  const tampered = await asOwner(a, `update audit.audit_log set payload = payload || '{"amount_minor": 1}' where tenant_id = $1 and seq = 5`, [
    a.tenant,
  ]);
  expect(tampered).toBe(1);
  expect((await verify(a)).broken).toBe('5');
  expect((await verify(b)).broken).toBeNull(); // the other tenant's chain is untouched
});

it('G7 a deleted row is found', async () => {
  expect((await verify(b)).broken).toBeNull();
  expect(await asOwner(b, 'delete from audit.audit_log where tenant_id = $1 and seq = 3', [b.tenant])).toBe(1);
  expect((await verify(b)).broken).toBe('3');
});

it('G7 verify_chain refuses to answer for another tenant', async () => {
  const r = await refused(tx(db.app, { tenant: a.tenant }, (c) => c.query('select audit.verify_chain($1)', [b.tenant])));
  expect(r).toEqual({ code: 'MS003', message: 'verify_chain: the tenant is not the current tenant' });
});

it('G7 caller-supplied seq and hash are replaced by the chain', async () => {
  const row = await tx(db.app, { tenant: c.tenant }, (client) =>
    client.query(
      `insert into audit.audit_log (tenant_id, seq, actor_id, action, entity, payload, created_at, prev_hash, hash)
       values ($1, 999, $2, 'login', 'ops.member', '{}', '2000-01-01', '\\x00', '\\x00') returning seq, created_at > '2001-01-01' as now_stamped`,
      [c.tenant, c.owner],
    ),
  );
  const n = (await verify(c)).n;
  expect(row.rows[0]).toEqual({ seq: String(n), now_stamped: true });
  expect((await verify(c)).broken).toBeNull();
});
