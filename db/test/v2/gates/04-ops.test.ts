// 04_ops_infra.sql: IDEM1's database part (the key, a concurrent duplicate, the result filled once, ids only), BUCKET1
// (a document names its own tenant's bucket; art and card shapes), SWEEP1's database part for job claims and the
// idempotency purge, and RET1's database part for the contact rule this file holds (a year, or a requested erasure).
// Red-proofs: test/v2/sabotage/ops.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { sha, signUp, type Tenant } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let u: Tenant;
let app: pg.Pool;
let jobs: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  t = await signUp(db, 'ops-shop');
  u = await signUp(db, 'ops-other');
  await db.sabotage();
});
afterAll(() => db?.close());

const owner = (x: Tenant = t) => ({ tenant_id: x.tenant, actor_id: x.owner });

it('IDEM1 a key is taken once: a concurrent duplicate waits for the first and then fails; the result is filled once, in the key’s own transaction, ids only', async () => {
  const scope = `member:${t.owner}`;
  const insert = (c: pg.PoolClient, key: string) =>
    c.query(`insert into ops.idempotency (tenant_id, scope, key, command, request_sha256) values ($1, $2, $3, 'sale.record', $4)`, [
      t.tenant,
      scope,
      key,
      sha('body'),
    ]);
  const [c1, c2] = [await app.connect(), await app.connect()];
  const sale = randomUUID();
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [t.tenant, t.owner]);
    }
    await insert(c1, 'tap-00001');
    const second = insert(c2, 'tap-00001').then(
      () => 'inserted',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await c1.query(`update ops.idempotency set result = $1 where tenant_id = $2 and scope = $3 and key = 'tap-00001'`, [{ saleId: sale }, t.tenant, scope]);
    await c1.query('commit');
    expect(await second).toBe('23505');
    await c2.query('rollback');
  } finally {
    c1.release();
    c2.release();
  }
  const stored = await tx(app, owner(), (c) => c.query(`select result from ops.idempotency where scope = $1 and key = 'tap-00001'`, [scope]));
  expect(stored.rows).toEqual([{ result: { saleId: sale } }]);
  const later = await refused(
    tx(app, owner(), (c) => c.query(`update ops.idempotency set result = '{"saleId": "${randomUUID()}"}' where scope = $1 and key = 'tap-00001'`, [scope])),
  );
  expect(later.code).toBe('MS010');
  // A key whose result was left empty is not filled by a later transaction.
  await tx(app, owner(), (c) => insert(c as pg.PoolClient, 'tap-00003'));
  const notOwn = await refused(
    tx(app, owner(), (c) => c.query(`update ops.idempotency set result = $1 where scope = $2 and key = 'tap-00003'`, [{ saleId: sale }, scope])),
  );
  expect(notOwn.code).toBe('MS010');
  const numbers = await refused(
    tx(app, owner(), async (c) => {
      await insert(c, 'tap-00002');
      await c.query(`update ops.idempotency set result = '{"total": 4500}' where scope = $1 and key = 'tap-00002'`, [scope]);
    }),
  );
  expect(numbers.code).toBe('23514');
});

it('SWEEP1 the jobs role purges idempotency keys older than 7 days, in its tenant only, and nothing newer', async () => {
  for (const x of [t, u]) {
    await tx(app, owner(x), (c) =>
      c.query(
        `insert into ops.idempotency (tenant_id, scope, key, command, request_sha256) values ($1, $2, 'old-00001', 'sale.record', $3), ($1, $2, 'new-00001', 'sale.record', $3)`,
        [x.tenant, `member:${x.owner}`, sha('b')],
      ),
    );
  }
  await plant(db.admin, `update ops.idempotency set created_at = now() - interval '8 days' where key = 'old-00001'`);
  const swept = await tx(jobs, { tenant_id: t.tenant }, (c) => c.query('delete from ops.idempotency'));
  expect(swept.rowCount).toBe(1);
  const left = await db.admin.query(`select tenant_id = $1 as mine, key from ops.idempotency where key in ('old-00001', 'new-00001') order by 1, 2`, [t.tenant]);
  expect(left.rows).toEqual([
    { mine: false, key: 'new-00001' },
    { mine: false, key: 'old-00001' },
    { mine: true, key: 'new-00001' },
  ]);
});

it("BUCKET1 a document whose storage_key names another tenant's bucket is refused; art is SVG of at most 200 KB, a card a JPEG", async () => {
  const doc = (key: string, kind = 'photo', mime = 'image/jpeg', bytes = 1000) =>
    tx(app, owner(), (c) =>
      c.query(`insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, $2, 'upload', $3, $4, $5, $6)`, [
        t.tenant,
        kind,
        key,
        sha(randomUUID()),
        mime,
        bytes,
      ]),
    );
  expect((await refused(doc(`t-${u.tenant}/photo/theirs.jpg`))).code).toBe('MS007');
  expect((await refused(doc(`t-${t.tenant}`))).code).toBe('MS007'); // the bucket alone, no path
  expect((await refused(doc(`x/t-${t.tenant}/photo/a.jpg`))).code).toBe('MS007');
  expect((await refused(doc(`t-${t.tenant}/art/a.svg`, 'art', 'image/svg+xml', 300_000))).code).toBe('23514');
  expect((await refused(doc(`t-${t.tenant}/card/a.png`, 'card', 'image/png'))).code).toBe('23514');
  expect((await refused(doc(`t-${t.tenant}/photo/a.svg`, 'photo', 'image/svg+xml'))).code).toBe('23514');
  await doc(`t-${t.tenant}/photo/mine.jpg`);
  await doc(`t-${t.tenant}/art/logo.svg`, 'art', 'image/svg+xml', 4000);
});

it('SWEEP1 a job slot is claimed once; an unfinished claim is taken over only after 5 minutes; a finished one never changes, and is swept only after 7 days', async () => {
  const q = (sql: string, params: unknown[] = []) => tx(jobs, {}, (c) => c.query(sql, params));
  await q(`insert into ops.job_claim (job, slot) values ('watch', 'slot-1')`);
  const dup = await q(`insert into ops.job_claim (job, slot) values ('watch', 'slot-1') on conflict do nothing`);
  expect(dup.rowCount).toBe(0);
  const takeOver = `update ops.job_claim set claimed_at = now() where job = 'watch' and slot = 'slot-1'`;
  expect((await refused(q(takeOver))).code).toBe('MS010'); // still within its 5 minutes
  await plant(db.admin, `update ops.job_claim set claimed_at = now() - interval '6 minutes' where slot = 'slot-1'`);
  await q(takeOver);
  await q(`update ops.job_claim set finished_at = now(), outcome = 'ok' where job = 'watch' and slot = 'slot-1'`);
  expect((await refused(q(`update ops.job_claim set outcome = 'failed', error_code = 'boom' where slot = 'slot-1'`))).code).toBe('MS010');
  expect((await q(`delete from ops.job_claim where slot = 'slot-1'`)).rowCount).toBe(0); // finished today
  await plant(db.admin, `update ops.job_claim set finished_at = now() - interval '8 days' where slot = 'slot-1'`);
  expect((await q(`delete from ops.job_claim where slot = 'slot-1'`)).rowCount).toBe(1);
});

it('RET1 the contact purge is refused one day short of a year and accepted one day past, or at once once the owner asked; an owner asks once', async () => {
  const add = async () =>
    tx(app, owner(), async (c) => {
      const r = await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name) values ($1, 'Old customer') returning id`, [t.tenant]);
      return r.rows[0]?.id as string;
    });
  const purge = (id: string) =>
    tx(jobs, { tenant_id: t.tenant }, (c) =>
      c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where id = $1`, [id]),
    );
  const [short, past, asked] = [await add(), await add(), await add()];
  await db.admin.query(`update ops.contact set created_at = now() - interval '364 days' where id = $1`, [short]);
  await db.admin.query(`update ops.contact set created_at = now() - interval '366 days' where id = $1`, [past]);
  expect((await refused(purge(short))).code).toBe('MS007');
  await purge(past);
  expect((await refused(purge(asked))).code).toBe('MS007');
  const ask = (actor: string) => tx(app, { tenant_id: t.tenant, actor_id: actor }, (c) => c.query(`update ops.contact set erase_requested_at = now() where id = $1`, [asked]));
  expect((await refused(ask(t.manager))).code).toBe('MS007');
  await ask(t.owner);
  expect((await refused(ask(t.owner))).code).toBe('MS007'); // once
  await purge(asked);
  const { rows } = await db.admin.query(`select count(*)::int as n from ops.contact where id = any($1) and erased_at is not null and erase_reason = 'retention'`, [
    [past, asked],
  ]);
  expect(rows[0].n).toBe(2);
});
