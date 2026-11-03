// ON4 and the pending skip (D-079, D-080): the daily `signups` job runs ops.purge_pending_signups() as munshi_jobs,
// commits it, then erases through the identity adapter each password identity it freed, if nothing holds it (no live
// login, not an operator's); the lapsed shop's slug is then free for a new sign-up. With identities to erase and no
// eraser wired, the slot fails and purges nothing. A real shop the operator has not accepted is skipped by every
// per-tenant job; once accepted it is not. And a real sign-up's refusals: an existing identity it proved is never erased
// (the web address refused, or the MS020 path of a second pending shop), an identity bound to a shop is never erased by
// eraseUnbound, and an email with an account and a wrong password answers as a new email with a refused password, in the
// same time band. ON4-RETRY: the purge queues what it frees (ops.identity_erase), so an erase that fails after the purge
// committed is retried by the next run. Real sign-ups through core and the password adapter, never a mocked database.
// Red-proofs: test/v2/sabotage/onboarding.ts.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { SCRYPT } from '../../../../../packages/adapters/identity/password.ts';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { wireIdentityEraser } from '../../../../../packages/core/src/jobs-signups.ts';
import { signUpRealShop } from '../../../../../packages/core/src/onboarding.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { acceptTenant, asOwner, plant } from '../../gates/lib.ts';
import { band, ctx, emailFor, oneScrypt, PASSWORD, portOf, timed } from '../auth/fixture.ts';
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

const form = (label: string, over: Record<string, string> = {}) => ({
  shopName: `${label} Stores`,
  businessType: 'kirana',
  city: 'Indore',
  ownerName: 'Owner',
  slug: `${label}-${randomBytes(4).toString('hex')}`,
  email: emailFor(label),
  password: PASSWORD,
  ...over,
});

async function realShop(label: string, over: Record<string, string> = {}, port = portOf(db)): Promise<{ tenant: string; slug: string; subject: string; email: string }> {
  const input = form(label, over);
  const r = await signUpRealShop(db.as('munshi_app'), port, input, ctx(`203.0.113.${randomBytes(1)[0]}`), 'invite');
  if (r.kind !== 'opened') throw new Error(`fixture: the sign-up was not made (${r.kind})`);
  const tenant = r.opened.session.tenantId;
  const { rows } = await db.admin.query<{ subject: string }>('select subject from ops.login where tenant_id = $1', [tenant]);
  return { tenant, slug: input.slug, subject: rows[0]?.subject as string, email: input.email };
}

// A sign-up made fifteen days ago: its tenant's and its slug's clocks, planted as a past.
const lapse = async (tenant: string) => {
  await plant(db.admin, `update ops.tenant set created_at = now() - interval '15 days' where tenant_id = $1`, [tenant]);
  await plant(db.admin, `update ops.tenant_directory set created_at = now() - interval '15 days' where tenant_id = $1`, [tenant]);
};
const identity = async (subject: string) =>
  (await db.admin.query('select email_hmac is null as gone, erased_at is not null as erased from idp.identity where subject = $1', [subject])).rows[0];
const identities = async () => (await db.admin.query<{ n: number }>('select count(*)::int as n from idp.identity where erased_at is null')).rows[0]?.n;
const slugHeld = async (slug: string) => (await db.admin.query('select 1 from ops.tenant_directory where slug = $1', [slug])).rowCount === 1;
const adapterEraser = () => {
  const port = portOf(db);
  const asked: string[] = [];
  wireIdentityEraser((subject) => {
    asked.push(subject);
    return port.eraseUnbound(subject);
  });
  return asked;
};

it('ON4 the purge job erases a lapsed sign-up’s identity through the identity adapter and frees its slug for a new sign-up', async () => {
  const lapsed = await realShop('on4-lapsed');
  const waiting = await realShop('on4-waiting');
  await lapse(lapsed.tenant);
  const asked = adapterEraser();
  const [run] = await runDueJobs(jobs, dayAfter(1), ['signups']);
  expect(run).toMatchObject({ job: 'signups', outcome: 'ok', removed: { signup_identities: 1, signup_identities_kept: 0 } });
  expect(asked).toEqual([lapsed.subject]);
  expect(await identity(lapsed.subject)).toEqual({ gone: true, erased: true });
  expect(await slugHeld(lapsed.slug)).toBe(false);
  // The waiting one, inside its two weeks, keeps everything.
  expect(await identity(waiting.subject)).toEqual({ gone: false, erased: false });
  expect(await slugHeld(waiting.slug)).toBe(true);
  // The freed address takes a new sign-up, and the erased email signs up afresh.
  const again = await signUpRealShop(db.as('munshi_app'), portOf(db), form('on4-again', { slug: lapsed.slug, email: lapsed.email }), ctx('203.0.113.9'), 'invite');
  expect(again.kind).toBe('opened');
});

it('ON4 with identities to erase and no eraser wired, the shop is still purged, the slot fails and the identity stays queued', async () => {
  const lapsed = await realShop('on4-unwired');
  await lapse(lapsed.tenant);
  const [run] = await runDueJobs(jobs, dayAfter(2), ['signups']);
  expect(run).toMatchObject({ job: 'signups', outcome: 'failed' });
  expect(await slugHeld(lapsed.slug)).toBe(false);
  expect(await identity(lapsed.subject)).toEqual({ gone: false, erased: false });
  expect((await db.admin.query('select 1 from ops.identity_erase where subject = $1', [lapsed.subject])).rowCount).toBe(1);
});

it('ON4-OPERATOR a lapsed sign-up’s identity that is an operator’s is purged from the shop but never erased', async () => {
  const lapsed = await realShop('on4-operator');
  await lapse(lapsed.tenant);
  // The identity became an operator's after it signed up (the operator seed sets the summary's flag).
  await plant(db.admin, `update ops.subject_summary set is_operator = true where provider = 'password' and subject = $1`, [lapsed.subject]);
  const asked = adapterEraser();
  const [run] = await runDueJobs(jobs, dayAfter(3), ['signups']);
  // The purge neither returns nor queues an operator's identity, so the eraser is never asked for it.
  expect(run).toMatchObject({ job: 'signups', outcome: 'ok' });
  expect(asked).not.toContain(lapsed.subject);
  expect(await slugHeld(lapsed.slug)).toBe(false);
  expect(await identity(lapsed.subject)).toEqual({ gone: false, erased: false });
  expect((await db.admin.query('select 1 from ops.identity_erase where subject = $1', [lapsed.subject])).rowCount).toBe(0);
});

it('ON4-RETRY an erase that fails after the purge committed stays queued, and the next run erases it', async () => {
  const lapsed = await realShop('on4-retry');
  await lapse(lapsed.tenant);
  const port = portOf(db);
  let fail = true;
  wireIdentityEraser(async (subject) => {
    if (fail) throw new Error('the identity database is away');
    return port.eraseUnbound(subject);
  });
  const queued = async () => (await db.admin.query('select 1 from ops.identity_erase where subject = $1', [lapsed.subject])).rowCount;
  const [first] = await runDueJobs(jobs, dayAfter(6), ['signups']);
  expect(first).toMatchObject({ job: 'signups', outcome: 'failed' });
  // The purge committed (its slot's checkpoint): the slug is free, and the identity waits in the queue, unerased.
  expect(await slugHeld(lapsed.slug)).toBe(false);
  expect(await identity(lapsed.subject)).toEqual({ gone: false, erased: false });
  expect(await queued()).toBe(1);
  fail = false;
  const [second] = await runDueJobs(jobs, dayAfter(7), ['signups']);
  expect(second).toMatchObject({ job: 'signups', outcome: 'ok', removed: { signup_identities: 1 } });
  expect(await identity(lapsed.subject)).toEqual({ gone: true, erased: true });
  expect(await queued()).toBe(0);
});

it('ON4-STARVE one queued identity whose erase throws does not stop the others: they are erased in the same run, it stays queued, the slot fails', async () => {
  const [bad, good] = [await realShop('on4-starve-bad'), await realShop('on4-starve-good')];
  await lapse(bad.tenant);
  await lapse(good.tenant);
  const port = portOf(db);
  wireIdentityEraser(async (subject) => {
    if (subject === bad.subject) throw new Error('this identity cannot be erased now');
    return port.eraseUnbound(subject);
  });
  const [run] = await runDueJobs(jobs, dayAfter(8), ['signups']);
  expect(run).toMatchObject({ job: 'signups', outcome: 'failed' });
  expect(await identity(good.subject)).toEqual({ gone: true, erased: true });
  expect(await identity(bad.subject)).toEqual({ gone: false, erased: false });
  const queued = await db.admin.query<{ subject: string }>('select subject from ops.identity_erase where subject = any($1)', [[bad.subject, good.subject]]);
  expect(queued.rows).toEqual([{ subject: bad.subject }]);
});

it('ON-SKIP a real shop the operator has not accepted is skipped by the per-tenant jobs; accepted, it is not', async () => {
  const shop = await realShop('on-skip');
  const slots = async (day: number) => (await runDueJobs(jobs, dayAfter(day), ['retention'])).filter((r) => r.tenantId === shop.tenant);
  expect(await slots(4)).toEqual([]);
  await acceptTenant(db.admin, shop.tenant);
  expect(await slots(5)).toEqual([expect.objectContaining({ job: 'retention', outcome: 'ok' })]);
});

it('ON-BOUND eraseUnbound never erases an identity a shop’s login is bound to; an unbound one it erases', async () => {
  const port = portOf(db);
  const bound = await realShop('on-bound');
  expect(await port.eraseUnbound(bound.subject)).toBe(false);
  expect(await identity(bound.subject)).toEqual({ gone: false, erased: false });
  const loose = await port.signUpOwner({ email: emailFor('on-loose'), password: PASSWORD, avoid: [] }, ctx('203.0.113.77'), 'invite');
  expect(loose?.created).toBe(true);
  expect(await port.eraseUnbound(loose?.identity.subject as string)).toBe(true);
  expect(await identity(loose?.identity.subject as string)).toEqual({ gone: true, erased: true });
});

it('ON-KEEP a refused sign-up of an existing identity leaves it intact: a reserved web address (taken), and a second pending shop (MS020, waiting)', async () => {
  const app = db.as('munshi_app');
  // An accepted shop's owner signs up a second shop at a reserved address: refused after the password is proved.
  const owner = await realShop('on-keep');
  await acceptTenant(db.admin, owner.tenant);
  await asOwner(db.admin, [`insert into platform.reserved_slug (slug, note) values ('keep-reserved', null)`]);
  const before = await identities();
  const taken = await signUpRealShop(app, portOf(db), form('on-keep-2', { email: owner.email, slug: 'keep-reserved' }), ctx('203.0.113.21'), 'invite');
  expect(taken.kind).toBe('taken');
  expect(await identity(owner.subject)).toEqual({ gone: false, erased: false });
  // A pending shop's owner signs up another: the database refuses a second pending sign-up for the identity (MS020).
  const pending = await realShop('on-wait');
  const waiting = await signUpRealShop(app, portOf(db), form('on-wait-2', { email: pending.email }), ctx('203.0.113.22'), 'invite');
  expect(waiting.kind).toBe('waiting');
  expect(await identity(pending.subject)).toEqual({ gone: false, erased: false });
  expect(await identities()).toBe((before as number) + 1);
});

it('ON-ENUM an email with an account and a wrong password answers as a new email with a refused password, in one time band', async () => {
  const app = db.as('munshi_app');
  const port = portOf(db, SCRYPT);
  const known = await realShop('on-enum', {}, port); // stored at the production cost, as a real one is
  const one = await oneScrypt();
  const times: Record<string, number[]> = { known: [], fresh: [] };
  for (let i = 0; i < 3; i++) {
    const a = await timed(() => signUpRealShop(app, port, form(`on-enum-k${i}`, { email: known.email, password: 'a wrong but long password' }), ctx(`198.51.100.${40 + i}`), 'invite'));
    const b = await timed(() => signUpRealShop(app, port, form(`on-enum-f${i}`, { password: 'short' }), ctx(`198.51.100.${50 + i}`), 'invite'));
    expect([a.r, b.r]).toEqual([{ kind: 'failed' }, { kind: 'failed' }]);
    times.known?.push(a.ms);
    times.fresh?.push(b.ms);
  }
  expect(band(one, times)).toMatch(/^ok/);
});
