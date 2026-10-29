// The back office's schedule (BP-WIRE-1, BLUEPRINT §7.3–§7.5): runBackOffice runs each tenant's watchers once an hour
// and writes each branch's brief once its day has reached BRIEF_HOUR in the shop's zone, once a day; two ticks at once
// run each once (the job claim); it runs only as munshi_jobs. Red-proofs: test/v2/sabotage/core-wire.ts.
import { BRIEF_HOUR, localTime, runBackOffice } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Schedule');
  await db.sabotage();
});
afterAll(() => db?.close());

const q = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const mine = (runs: { kind: string; slot: string; outcome: string }[]) => runs.filter((r) => r.slot.includes(s.owner.tenantId)).map((r) => [r.kind, r.outcome]);
// An instant in the shop's zone (Asia/Kolkata) on a day after the seed: the minutes past midnight given.
const at = (day: string, hour: number) => localTime(day, hour * 60 + 5, 'Asia/Kolkata');

it('the back office runs the watchers hourly and a branch’s brief once its morning has come, once a day; two ticks at once run each once', async () => {
  const day = '2031-03-04';
  const early = await runBackOffice(jobs, at(day, BRIEF_HOUR - 2));
  expect(mine(early)).toEqual([['watchers', 'ok']]);
  expect((await q('select count(*)::int as n from ai.brief where tenant_id = $1', [s.owner.tenantId]))[0].n).toBe(0);

  const [one, two] = await Promise.all([runBackOffice(jobs, at(day, BRIEF_HOUR)), runBackOffice(jobs, at(day, BRIEF_HOUR))]);
  expect([...mine(one ?? []), ...mine(two ?? [])].sort()).toEqual([
    ['brief', 'ok'],
    ['watchers', 'ok'],
  ]);
  const briefs = await q('select shop_id::text as shop, business_date::text as day from ai.brief where tenant_id = $1', [s.owner.tenantId]);
  expect(briefs).toEqual([{ shop: s.shopId, day }]);
  // Later the same hour: nothing new; the next hour, the watchers again and no second brief.
  expect(mine(await runBackOffice(jobs, at(day, BRIEF_HOUR)))).toEqual([]);
  expect(mine(await runBackOffice(jobs, at(day, BRIEF_HOUR + 1)))).toEqual([['watchers', 'ok']]);
  expect((await q('select count(*)::int as n from ai.brief where tenant_id = $1', [s.owner.tenantId]))[0].n).toBe(1);
});

it('the back office runs only on a munshi_jobs connection', async () => {
  await expect(runBackOffice(app, at('2031-03-05', BRIEF_HOUR))).rejects.toThrow(/munshi_jobs/);
});
