// The demo and its fence (BLUEPRINT §6.6; MERCHANTS-DESIGN F2, F3; SANDBOX1): the picker lists the directory's synthetic
// and showcase shops, never a live tenant or a sandbox; a demo session is only for a sample shop (by its class, D-080); a
// judge's sample shop is a synthetic sandbox with its pack's switches, opened as a 7-day sandbox session, on any
// deployment; and a whole sandbox can be deleted as the owner in one transaction, off live, while the same delete of a sample
// shop that is not one is refused. Red-proofs: test/v2/sabotage/core-auth.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runCommand } from '../../../../../packages/core/src/commands.ts';
import { createSandbox, listDemoShops, openDemoSession } from '../../../../../packages/core/src/logins.ts';
import { openSession, resumeSession } from '../../../../../packages/core/src/session.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp } from '../../gates/fixture.ts';
import { plant } from '../../gates/lib.ts';
import { failure } from '../platform/fixture.ts';
import { liveDb, liveShop } from './fixture.ts';

let demo: TestDb;
let live: TestDb;

beforeAll(async () => {
  demo = await openTestDb();
  live = await liveDb();
  await demo.sabotage();
  await live.sabotage();
});
afterAll(async () => {
  await demo?.close();
  await live?.close();
});

const sample = (slug: string) => ({ businessType: 'salon' as const, name: 'My sample salon', slug, ownerName: 'A judge' });

it('F3 the picker lists the demo’s synthetic and showcase shops, and never a planted live tenant or a sandbox', async () => {
  const app = demo.as('munshi_app');
  const kirana = await signUp(demo, 'auth-demo-kirana');
  const showcase = await signUp(demo, 'auth-demo-showcase', { dataClass: 'showcase' });
  const sandbox = await createSandbox(app, sample('auth-demo-sandbox'));
  // A live tenant cannot exist in a demo database (tenant_class); one planted past the guards is still not listed.
  const planted = randomUUID();
  await plant(demo.admin, `insert into ops.tenant (tenant_id, name, business_type, data_class, created_txid) values ($1, 'Planted live shop', 'kirana', 'live', 0)`, [planted]);
  await plant(demo.admin, `insert into ops.tenant_directory (slug, skeleton, tenant_id, created_txid) values ('auth-demo-planted', 'authdemopianted', $1, 0)`, [planted]);
  const listed = await listDemoShops(app);
  expect(listed.map((s) => s.slug)).toEqual(['auth-demo-kirana', 'auth-demo-showcase']);
  expect(listed[0]).toEqual({ tenantId: kirana.tenant, slug: 'auth-demo-kirana', name: 'Shop auth-demo-kirana' });
  expect(listed[1]?.tenantId).toBe(showcase.tenant);
  expect(listed.some((s) => s.tenantId === sandbox.session.tenantId || s.tenantId === planted)).toBe(false);
});

it('F2 on a live deployment a real shop opens no demo session for any member and is never listed; a sandbox is a sample shop there too (D-080)', async () => {
  const app = live.as('munshi_app');
  const t = await liveShop(live);
  for (const m of [t.owner, t.manager, t.staff]) expect(await openDemoSession(app, t.tenant, m)).toBeNull();
  // One database for real and sample shops (D-080): a judge's sandbox is made here too, and still never listed.
  const opened = await createSandbox(app, sample('auth-live-sandbox'));
  expect(opened.session.via).toBe('sandbox');
  expect((await live.admin.query(`select data_class, sandbox from ops.tenant where tenant_id = $1`, [opened.session.tenantId])).rows).toEqual([
    { data_class: 'synthetic', sandbox: true },
  ]);
  expect(await listDemoShops(app)).toEqual([]);
});

it('SANDBOX1 a sample shop is a synthetic sandbox with its pack’s switches and no login, opened as a 7-day sandbox session the picker never offers', async () => {
  const app = demo.as('munshi_app');
  const opened = await createSandbox(app, sample('auth-sandbox-one'));
  const { tenantId, memberId } = opened.session;
  expect(opened.session.via).toBe('sandbox');
  const days = (opened.expiresAt.getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.99);
  expect(days).toBeLessThanOrEqual(7);
  expect(await resumeSession(app, { tenantId, memberId, sessionId: opened.session.sessionId as string, via: 'sandbox' })).toEqual(opened.session);
  const row = (await demo.admin.query('select data_class, sandbox from ops.tenant where tenant_id = $1', [tenantId])).rows;
  expect(row).toEqual([{ data_class: 'synthetic', sandbox: true }]);
  const switches = await demo.admin.query<{ capability: string }>(
    `select capability from ops.capability_switch where tenant_id = $1 and is_on order by capability`,
    [tenantId],
  );
  const pack = await demo.admin.query<{ capability: string }>(`select capability from ref.pack_capability where business_type = 'salon' order by capability`);
  expect(switches.rows).toEqual(pack.rows);
  expect(pack.rows.length).toBeGreaterThan(5);
  expect((await demo.admin.query('select count(*)::int as n from ops.login where tenant_id = $1', [tenantId])).rows).toEqual([{ n: 0 }]);
  // The owner works in it: a direct command runs under the sandbox session.
  expect(await runCommand(app, opened.session, 'item.create', { name: 'Haircut', unit: 'piece' })).toHaveProperty('itemId');
  // A demo session is refused on a sandbox, and the picker leaves it out.
  expect(await openDemoSession(app, tenantId, memberId)).toBeNull();
  expect((await listDemoShops(app)).some((s) => s.tenantId === tenantId)).toBe(false);
  // A taken slug is refused like any sign-up's.
  expect((await failure(createSandbox(app, sample('auth-sandbox-one')))).code).toBe('refused');
});

// Every row of a tenant, deleted as the owner in one transaction (what db:reset-demo --sandboxes will do, R4 K5):
// passes over every table with a tenant_id until a pass makes no progress; the tables left are the ones that refused,
// and then nothing is deleted at all.
async function deleteTenant(db: TestDb, tenantId: string): Promise<{ deleted: number; refused: string[] }> {
  const { rows } = await db.admin.query<{ rel: string }>(
    `select format('%I.%I', n.nspname, c.relname) as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
      where c.relkind = 'r' and n.nspname in ('ops', 'books', 'approval', 'snap', 'audit', 'ai', 'idp', 'platform') order by 1`,
  );
  const c: pg.PoolClient = await db.admin.connect();
  let deleted = 0;
  let left = rows.map((r) => r.rel);
  try {
    await c.query('begin');
    await c.query('set local role munshi_owner');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    for (let progress = true; progress && left.length; ) {
      progress = false;
      const next: string[] = [];
      for (const rel of left) {
        await c.query('savepoint one');
        try {
          deleted += (await c.query(`delete from ${rel} where tenant_id = $1`, [tenantId])).rowCount ?? 0;
          await c.query('release savepoint one');
          progress = true;
        } catch {
          await c.query('rollback to savepoint one');
          next.push(rel);
        }
      }
      left = next;
    }
    await c.query(left.length ? 'rollback' : 'commit');
  } finally {
    c.release();
  }
  return { deleted, refused: left };
}

it('SANDBOX1 a whole sandbox is deleted as the owner in one transaction off live; the same delete of a sample shop that is not a sandbox is refused', async () => {
  const app = demo.as('munshi_app');
  const opened = await createSandbox(app, sample('auth-sandbox-gone'));
  await runCommand(app, opened.session, 'item.create', { name: 'Hair spa', unit: 'piece' });
  const gone = await deleteTenant(demo, opened.session.tenantId);
  expect(gone.refused).toEqual([]);
  expect(gone.deleted).toBeGreaterThan(10);
  expect((await demo.admin.query('select count(*)::int as n from ops.tenant where tenant_id = $1', [opened.session.tenantId])).rows).toEqual([{ n: 0 }]);
  expect((await demo.admin.query(`select count(*)::int as n from ops.tenant_directory where slug = 'auth-sandbox-gone'`)).rows).toEqual([{ n: 0 }]);
  const kept = await signUp(demo, 'auth-sample-kept');
  const s = await openSession(app, kept.tenant, kept.owner);
  if (!s) throw new Error('no owner session');
  await runCommand(app, s, 'item.create', { name: 'Kept tea', unit: 'pack' });
  const refused = await deleteTenant(demo, kept.tenant);
  expect(refused.refused).toContain('books.item');
  expect(refused.refused).toContain('ops.tenant');
  expect((await demo.admin.query('select count(*)::int as n from books.item where tenant_id = $1', [kept.tenant])).rows).toEqual([{ n: 1 }]);
});
