// The back office's schedule: runBackOffice runs each tenant's watchers once an hour
// and writes each branch's brief once its day has reached BRIEF_HOUR in the shop's zone, once a day; two ticks at once
// run each once (the job claim); it runs only as munshi_jobs. Held (holdSampleDay, while model answers are replayed from
// recordings), an operator's synthetic sample shop's watchers and brief run as of the earliest day its watchers ran as
// of, and a real shop's, a visitor's sandbox's and a showcase shop's follow the clock. Red-proofs: test/v2/sabotage/core-wire.ts and test/v2/sabotage/demo-clock.ts.
import { BRIEF_HOUR, createSandbox, localTime, runBackOffice, runWatchers } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { provision } from '../../../../seed/provision.ts';
import { acceptTenant } from '../../gates/lib.ts';
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

// The business date the tenant's latest finished watcher run read as of: what the pages read as of (asOfDate).
const latestDay = async (tenantId: string) =>
  (
    await q(
      `select s.params->>'as_of' as day from ai.run r join snap.snapshot s on s.tenant_id = r.tenant_id and s.run_id = r.id
        where r.tenant_id = $1 and r.trigger = 'watcher' and r.ended_at is not null order by r.started_at desc limit 1`,
      [tenantId],
    )
  )[0]?.day;

it('held, a sample shop stays on the day it was seeded as of, its brief written for that day; a real shop, a sandbox and a showcase shop follow the clock', async () => {
  const sample = await smallShop(app, 'Held');
  const real = await smallShop(app, 'Real', { accept: (id) => acceptTenant(db.admin, id) });
  const sandbox = (await createSandbox(app, { businessType: 'kirana', name: 'Visitor shop', slug: 'visitor-held', ownerName: 'Visitor' })).session.tenantId;
  const owner = await db.admin.connect();
  const showcase = await provision(owner, { slug: 'showcase-held', name: 'Showcase Salon (sample menu)', businessType: 'salon', ownerName: 'Owner', shops: ['Main'] }).finally(() =>
    owner.release(),
  );
  const seeded = '2031-04-01';
  for (const t of [sample.owner.tenantId, real.owner.tenantId, sandbox, showcase.tenantId]) await runWatchers(jobs, t, seeded);
  // A clock-bound run moved the sample shop's day on; held, it returns to its own.
  await runWatchers(jobs, sample.owner.tenantId, '2031-04-05');
  const runs = await runBackOffice(jobs, at('2031-04-09', BRIEF_HOUR - 2), { holdSampleDay: true });
  // A brief's slot ends with the business date it was written for.
  const of = (t: Shop | string) =>
    runs.filter((r) => r.slot.includes(typeof t === 'string' ? t : t.owner.tenantId)).map((r) => [r.kind, r.outcome, r.kind === 'brief' ? r.slot.split(':').at(-1) : '']);
  expect(of(sample)).toEqual([
    ['watchers', 'ok', ''],
    ['brief', 'ok', seeded],
  ]);
  expect(await latestDay(sample.owner.tenantId)).toBe(seeded);
  const briefs = await q('select business_date::text as day from ai.brief where tenant_id = $1', [sample.owner.tenantId]);
  expect(briefs).toEqual([{ day: seeded }]);
  // The real shop's, the sandbox's and the showcase shop's watchers run as of the clock's day, and their briefs wait for
  // the morning.
  expect(of(real)).toEqual([['watchers', 'ok', '']]);
  expect(await latestDay(real.owner.tenantId)).toBe('2031-04-09');
  expect(of(sandbox)).toEqual([['watchers', 'ok', '']]);
  expect(await latestDay(sandbox)).toBe('2031-04-09');
  expect(of(showcase.tenantId)).toEqual([['watchers', 'ok', '']]);
  expect(await latestDay(showcase.tenantId)).toBe('2031-04-09');
});
