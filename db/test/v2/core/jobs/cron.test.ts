// CRON1, the tick route (apps/web/app/api/internal/tick/route.ts): a missing, wrong or
// unset CRON_SECRET answers 404 as if the route did not exist, opens no jobs connection and claims nothing; the
// comparison is over fixed-length digests (timing-safe); nothing is logged; the right secret runs the jobs, by GET (the
// Vercel cron) or POST (the ticker). Red-proofs: test/v2/sabotage/core-jobs.ts.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GET, POST } from '../../../../../apps/web/app/api/internal/tick/route.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp } from '../../gates/fixture.ts';
import { jobsUrl } from './lib.ts';

const ROUTE = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'apps', 'web', 'app', 'api', 'internal', 'tick', 'route.ts');
const held = globalThis as typeof globalThis & { munshiJobsPool?: { url: string; pool: pg.Pool } | undefined };
const before = { secret: process.env.CRON_SECRET, url: process.env.JOBS_DATABASE_URL };

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
  await signUp(db, 'cron-shop');
  process.env.JOBS_DATABASE_URL = jobsUrl(db);
  delete process.env.CRON_SECRET;
  await db.sabotage();
});
afterAll(async () => {
  await held.munshiJobsPool?.pool.end();
  held.munshiJobsPool = undefined;
  for (const [key, value] of [['CRON_SECRET', before.secret], ['JOBS_DATABASE_URL', before.url]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db?.close();
});

const call = (method: 'GET' | 'POST', authorization?: string) =>
  (method === 'GET' ? GET : POST)(
    new Request('http://localhost/api/internal/tick', { method, headers: authorization === undefined ? {} : { authorization } }),
  );

it('a missing, wrong or unset CRON_SECRET answers 404, opens no jobs connection and claims nothing; the right one runs the jobs; nothing is logged', async () => {
  const secret = randomBytes(32).toString('hex');
  const logged: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    }),
  );
  try {
    // Unset, or set empty: nothing opens the route, not even an empty bearer or the text "undefined".
    for (const value of [undefined, '']) {
      if (value === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = value;
      for (const auth of [undefined, '', 'Bearer ', 'Bearer undefined', `Bearer ${secret}`]) {
        expect((await call('POST', auth)).status, `CRON_SECRET=${value} ${auth}`).toBe(404);
      }
    }
    process.env.CRON_SECRET = secret;
    const lastChanged = `${secret.slice(0, -1)}${secret.endsWith('0') ? '1' : '0'}`; // same length, one character off
    const wrong = [undefined, '', secret, `bearer ${secret}`, `Bearer  ${secret}`, `Bearer ${lastChanged}`, `Bearer ${secret}0`, `Bearer ${secret.slice(0, 8)}`, `Basic ${secret}`];
    for (const method of ['GET', 'POST'] as const) {
      for (const auth of wrong) {
        const res = await call(method, auth);
        expect(res.status, `${method} ${auth}`).toBe(404);
        expect(await res.text()).toBe('');
      }
    }
    expect(held.munshiJobsPool).toBeUndefined();
    expect((await db.admin.query<{ n: number }>('select count(*)::int as n from ops.job_claim')).rows[0]?.n).toBe(0);

    for (const method of ['GET', 'POST'] as const) {
      const res = await call(method, `Bearer ${secret}`);
      expect(res.status, method).toBe(200);
      const body = (await res.json()) as { jobs: { job: string; outcome: string }[] };
      expect(body.jobs.filter((j) => j.outcome !== 'ok')).toEqual([]);
    }
    const claims = await db.admin.query<{ n: number }>(`select count(*)::int as n from ops.job_claim where outcome = 'ok'`);
    expect(claims.rows[0]?.n).toBeGreaterThan(0);
    expect(logged).toEqual([]);
  } finally {
    for (const s of spies) s.mockRestore();
  }
  // Timing-safe: both sides are hashed to 32 bytes and compared with timingSafeEqual.
  expect(readFileSync(ROUTE, 'utf8')).toMatch(/timingSafeEqual\(digest\(/);
});
