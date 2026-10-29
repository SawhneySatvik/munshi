// Shared by the jobs runner's tests (test/v2/core/jobs/): the jobs role's own connection string for a test file's clone,
// so the pool under test is built by createJobsPool exactly as the tick route builds it, and a snapshot mint per role.
import type pg from 'pg';
import { inject } from 'vitest';
import { type TestDb, tx } from '../../db.ts';
import { COLUMNS, rowsOf } from '../../gates/fixture.ts';

// Test passwords are the role names (global-setup.ts).
export const jobsUrl = (db: TestDb): string => `postgres://munshi_jobs:munshi_jobs@127.0.0.1:${inject('pg17Port')}/${db.name}`;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A slot day of its own, so each test's claims never meet another's (the runner names slots from `now`).
export const dayAfter = (days: number): Date => new Date(Date.now() + days * 86_400_000);

export function mint(pool: pg.Pool, ctx: Record<string, string>, purpose: string, amount: string): Promise<string> {
  return tx(pool, ctx, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'sale.day', '{}', $2, $3, $4, '\\x00', '\\x00', 0) returning id`,
      [ctx.tenant_id, purpose, JSON.stringify(COLUMNS), JSON.stringify(rowsOf(amount))],
    );
    return r.rows[0]?.id as string;
  });
}

// Waits until a munshi_jobs backend of this database is blocked on a lock: proof that the purge reached a row another
// transaction holds, before that transaction commits.
export async function jobsWaitingOnLock(db: TestDb): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await db.admin.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity where datname = $1 and usename = 'munshi_jobs' and wait_event_type = 'Lock'`,
      [db.name],
    );
    if ((rows[0]?.n ?? 0) > 0) return;
    await sleep(25);
  }
  throw new Error('no munshi_jobs backend ever waited on a lock');
}
