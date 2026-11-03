// ON4 and the pending skip (D-079, D-080): the daily `signups` job runs ops.purge_pending_signups() as munshi_jobs and
// erases, through the identity adapter, each password identity it frees, before its slot commits; the lapsed shop's slug
// is then free for a new sign-up. With identities to erase and no eraser wired, the slot fails and purges nothing. A
// real shop the operator has not accepted is skipped by every per-tenant job; once accepted it is not. Real sign-ups
// through core and the password adapter, never a mocked database. Red-proofs: test/v2/sabotage/onboarding.ts.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { wireIdentityEraser } from '../../../../../packages/core/src/jobs-signups.ts';
import { signUpRealShop } from '../../../../../packages/core/src/onboarding.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { acceptTenant, plant } from '../../gates/lib.ts';
import { ctx, emailFor, PASSWORD, portOf } from '../auth/fixture.ts';
import { dayAfter, jobsUrl } from './lib.ts';

let db: TestDb;
let jobs: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  jobs = createJobsPool(jobsUrl(db));
  await db.sabotage();
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});
afterEach(() => wireIdentityEraser(null));

async function realShop(label: string): Promise<{ tenant: string; slug: string; subject: string; email: string }> {
  const slug = `${label}-${randomBytes(4).toString('hex')}`;
  const email = emailFor(label);
  const input = { shopName: `${label} Stores`, businessType: 'kirana', city: 'Indore', ownerName: 'Owner', slug, email, password: PASSWORD };
  const r = await signUpRealShop(db.as('munshi_app'), portOf(db), input, ctx(), 'invite');
  if (r.kind !== 'opened') throw new Error(`fixture: the sign-up was not made (${r.kind})`);
  const tenant = r.opened.session.tenantId;
  const { rows } = await db.admin.query<{ subject: string }>('select subject from ops.login where tenant_id = $1', [tenant]);
  return { tenant, slug, subject: rows[0]?.subject as string, email };
}

// A sign-up made fifteen days ago: its tenant's and its slug's clocks, planted as a past.
const lapse = async (tenant: string) => {
  await plant(db.admin, `update ops.tenant set created_at = now() - interval '15 days' where tenant_id = $1`, [tenant]);
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - interval '15 days' where tenant_id = $1`, [tenant]);
};
const identity = async (subject: string) =>
  (await db.admin.query('select email_hmac is null as gone, erased_at is not null as erased from idp.identity where subject = $1', [subject])).rows[0];
const slugHeld = async (slug: string) => (await db.admin.query('select 1 from ops.tenant_directory where slug = $1', [slug])).rowCount === 1;

it('ON4 the purge job erases a lapsed sign-up’s identity through the identity adapter and frees its slug for a new sign-up', async () => {
  const lapsed = await realShop('on4-lapsed');
  const waiting = await realShop('on4-waiting');
  await lapse(lapsed.tenant);
  const port = portOf(db);
  const erased: string[] = [];
  wireIdentityEraser(async (subject) => {
    erased.push(subject);
    await port.erase(subject);
  });
  const [run] = await runDueJobs(jobs, dayAfter(1), ['signups']);
  expect(run).toMatchObject({ job: 'signups', outcome: 'ok', removed: { signup_identities: 1 } });
  expect(erased).toEqual([lapsed.subject]);
  expect(await identity(lapsed.subject)).toEqual({ gone: true, erased: true });
  expect(await slugHeld(lapsed.slug)).toBe(false);
  // The waiting one, inside its two weeks, keeps everything.
  expect(await identity(waiting.subject)).toEqual({ gone: false, erased: false });
  expect(await slugHeld(waiting.slug)).toBe(true);
  // The freed address takes a new sign-up, and the erased email signs up afresh.
  const again = await signUpRealShop(
    db.as('munshi_app'),
    port,
    { shopName: 'On4 Again', businessType: 'kirana', city: 'Indore', ownerName: 'Owner', slug: lapsed.slug, email: lapsed.email, password: PASSWORD },
    ctx('203.0.113.9'),
    'invite',
  );
  expect(again.kind).toBe('opened');
});

it('ON4 with identities to erase and no eraser wired, the purge fails and purges nothing', async () => {
  const lapsed = await realShop('on4-unwired');
  await lapse(lapsed.tenant);
  const [run] = await runDueJobs(jobs, dayAfter(2), ['signups']);
  expect(run).toMatchObject({ job: 'signups', outcome: 'failed' });
  expect(await slugHeld(lapsed.slug)).toBe(true);
  expect(await identity(lapsed.subject)).toEqual({ gone: false, erased: false });
});

it('ON-SKIP a real shop the operator has not accepted is skipped by the per-tenant jobs; accepted, it is not', async () => {
  const shop = await realShop('on-skip');
  const slots = async (day: number) => (await runDueJobs(jobs, dayAfter(day), ['retention'])).filter((r) => r.tenantId === shop.tenant);
  expect(await slots(3)).toEqual([]);
  await acceptTenant(db.admin, shop.tenant);
  expect(await slots(4)).toEqual([expect.objectContaining({ job: 'retention', outcome: 'ok' })]);
});
