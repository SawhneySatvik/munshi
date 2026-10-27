// G6: a journal entry balances per currency at commit; the check is deferred, so the lines can follow the header.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, refused, setCtx, type TestDb } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  await db.sabotage();
});
afterAll(() => db.close());

// Inserts an entry and its lines, asserts every statement was accepted, then returns the result of COMMIT.
async function post(lines: [string, number, string][]): Promise<pg.QueryResult> {
  const c = await db.app.connect();
  try {
    await c.query('begin');
    await setCtx(c, { tenant: a.tenant, actor: a.owner, command: 'journal.post' });
    const entry = await c.query(`insert into books.journal_entry (tenant_id, entry_date, memo) values ($1, current_date, 'test') returning id`, [
      a.tenant,
    ]);
    for (const [account, amount, currency] of lines) {
      const r = await c.query('insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values ($1, $2, $3, $4, $5)', [
        a.tenant,
        entry.rows[0].id,
        account,
        amount,
        currency,
      ]);
      expect(r.rowCount).toBe(1);
    }
    return await c.query('commit');
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

const UNBALANCED = { code: 'MS004', message: 'journal entry does not balance per currency' };

it('G6 an unbalanced journal entry fails at commit', async () => {
  expect(await refused(post([['cash', 1000, 'INR'], ['sales', -900, 'INR']]))).toEqual(UNBALANCED);
});

it('G6 an entry with no lines fails at commit', async () => {
  expect(await refused(post([]))).toEqual(UNBALANCED);
});

it('G6 an entry balanced overall but not per currency fails at commit', async () => {
  expect(await refused(post([['cash', 1000, 'INR'], ['sales', -1000, 'USD']]))).toEqual(UNBALANCED);
});

it('G6 a balanced entry commits, in each of two currencies', async () => {
  const before = await db.admin.query('select count(*)::int as n from books.journal_line where tenant_id = $1', [a.tenant]);
  await post([
    ['cash', 1000, 'INR'],
    ['sales', -1000, 'INR'],
    ['cash', 500, 'USD'],
    ['sales', -500, 'USD'],
  ]);
  const after = await db.admin.query('select count(*)::int as n from books.journal_line where tenant_id = $1', [a.tenant]);
  expect(after.rows[0].n - before.rows[0].n).toBe(4);
});
