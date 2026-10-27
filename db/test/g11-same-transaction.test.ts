// G11: a journal entry's lines and a snapshot's cells are accepted only in the transaction that created their parent, so
// neither grows after it commits; the parent's created_txid is stamped by a trigger, never taken from the caller.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, refused, type TestDb, tx } from './db.ts';
import { seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  await db.sabotage();
});
afterAll(() => db.close());

const posting = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tx(db.app, { tenant: a.tenant, actor: a.owner, command: 'journal.post' }, fn);
const lines = (c: pg.PoolClient, entry: string, amount: number) =>
  c.query(`insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency) values ($1, $2, 'cash', $3, 'INR'), ($1, $2, 'sales', -$3, 'INR')`, [
    a.tenant,
    entry,
    amount,
  ]);
const newEntry = async (c: pg.PoolClient) =>
  (await c.query(`insert into books.journal_entry (tenant_id, entry_date, memo) values ($1, current_date, 'G11') returning id`, [a.tenant])).rows[0]
    .id as string;
const count = async (sql: string, id: string) => (await db.admin.query(sql, [a.tenant, id])).rows[0].n as number;

it("G11 lines and cells written in their parent's transaction are accepted (the paired case)", async () => {
  const entry = await posting(async (c) => {
    const id = await newEntry(c);
    await lines(c, id, 700);
    return id;
  });
  const snapshot = await tx(db.app, { tenant: a.tenant }, async (c) => {
    const id = (await c.query(`insert into snap.snapshot (tenant_id, query_name, row_count) values ($1, 'g11.paired', 1) returning id`, [a.tenant])).rows[0].id;
    await c.query(`insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num) values ($1, $2, 0, 'n', 'integer', 7)`, [a.tenant, id]);
    return id as string;
  });
  expect(await count('select count(*)::int as n from books.journal_line where tenant_id = $1 and entry_id = $2', entry)).toBe(2);
  expect(await count('select count(*)::int as n from snap.snapshot_cell where tenant_id = $1 and snapshot_id = $2', snapshot)).toBe(1);
});

it('G11 a later transaction cannot add a line to a committed journal entry', async () => {
  const entry = await posting(async (c) => {
    const id = await newEntry(c);
    await lines(c, id, 500);
    return id;
  });
  // A balanced pair, so the balance check alone would let it through.
  const r = await refused(posting((c) => lines(c, entry, 100)));
  expect(r).toEqual({ code: 'MS006', message: 'journal line refused: its entry was not created in this transaction' });
  expect(await count('select count(*)::int as n from books.journal_line where tenant_id = $1 and entry_id = $2', entry)).toBe(2);
});

it('G11 a later transaction cannot add a cell to a committed snapshot', async () => {
  const r = await refused(
    tx(db.app, { tenant: a.tenant }, (c) =>
      c.query(`insert into snap.snapshot_cell (tenant_id, snapshot_id, row_no, col, kind, num) values ($1, $2, 1, 'late', 'integer', 1)`, [
        a.tenant,
        a.snapshot,
      ]),
    ),
  );
  expect(r).toEqual({ code: 'MS006', message: 'snapshot cell refused: its snapshot was not created in this transaction' });
});

it('G11 a caller-supplied created_txid on an entry or a snapshot is overwritten', async () => {
  const stamped = await posting(async (c) => {
    const entry = (
      await c.query(
        `insert into books.journal_entry (tenant_id, entry_date, created_txid) values ($1, current_date, txid_current() + 1)
         returning id, created_txid, txid_current() as now_txid`,
        [a.tenant],
      )
    ).rows[0];
    await lines(c, entry.id, 300);
    const snapshot = (
      await c.query(
        `insert into snap.snapshot (tenant_id, query_name, row_count, created_txid) values ($1, 'g11.forged', 0, txid_current() + 1)
         returning created_txid, txid_current() as now_txid`,
        [a.tenant],
      )
    ).rows[0];
    return [entry, snapshot];
  });
  for (const row of stamped) expect(row.created_txid).toBe(row.now_txid);
});
