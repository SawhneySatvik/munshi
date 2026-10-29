// 06_snap.sql with snap.snap_check (02): C3's database part (a snapshot's shape, its stamps, immutability), J2 (the
// purge deletes only old unpinned display, watch and evidence snapshots, in its tenant; a pin and a purge racing on one
// snapshot never leave a pin without its snapshot; pins come only from their holder's trigger) and PUB1's database part
// for snapshots (the public role reads only release-pinned snapshots and release pins). Red-proofs:
// test/v2/sabotage/snap.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, mintDisplay, plantProbeCommand, rowsOf, signUp, type Tenant } from './fixture.ts';
import { asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let u: Tenant;
let app: pg.Pool;
let jobs: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  t = await signUp(db, 'snap-shop');
  u = await signUp(db, 'snap-other');
  await db.sabotage();
});
afterAll(() => db?.close());

const mint = (pool: pg.Pool, ctx: Record<string, string>, purpose: string, columns: unknown, rows: unknown, tenant = t.tenant) =>
  tx(pool, ctx, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       values ($1, 'sale.day', '{"day": "2026-10-29"}', $2, $3, $4, '\\x00', '\\x00', 0) returning id`,
      [tenant, purpose, JSON.stringify(columns), JSON.stringify(rows)],
    );
    return r.rows[0]?.id as string;
  });
const asMember = (x: Tenant = t) => ({ tenant_id: x.tenant, actor_id: x.owner });

async function draftCiting(snapshot: string, c: pg.PoolClient) {
  await c.query(
    `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', 0)`,
    [t.tenant, JSON.stringify([{ snapshotId: snapshot, row: 0, col: 'amount' }])],
  );
}

it("C3 a snapshot's cells are checked set-based: one cell per column, each of its column's kind with exactly its fields; at most 500 rows; distinct columns", async () => {
  const cell = { k: 'money', n: '1500', c: 'INR' };
  const bad: [string, unknown, unknown][] = [
    ['no columns', [], [[]]],
    ['a column named twice', [{ n: 'a', k: 'int' }, { n: 'a', k: 'int' }], [[{ k: 'int', n: '1' }, { k: 'int', n: '2' }]]],
    ['an unknown kind', [{ n: 'a', k: 'float' }], [[{ k: 'float', n: '1.5' }]]],
    ['a row short of a cell', COLUMNS, [[{ k: 'text', t: 'Tea' }]]],
    ['a cell of another kind', COLUMNS, [[{ k: 'text', t: 'Tea' }, { k: 'qty', n: '1', u: 'pack' }]]],
    ['a money cell with no currency', COLUMNS, [[{ k: 'text', t: 'Tea' }, { k: 'money', n: '1500' }]]],
    ['a money cell with an extra field', COLUMNS, [[{ k: 'text', t: 'Tea' }, { ...cell, t: 'one thousand five hundred' }]]],
    ['a number as a JSON number', COLUMNS, [[{ k: 'text', t: 'Tea' }, { k: 'money', n: 1500, c: 'INR' }]]],
    ['a decimal amount', COLUMNS, [[{ k: 'text', t: 'Tea' }, { k: 'money', n: '15.00', c: 'INR' }]]],
    ['rows not an array', COLUMNS, { r: 1 }],
    ['501 rows', COLUMNS, Array.from({ length: 501 }, () => rowsOf('1')[0])],
  ];
  for (const [what, columns, rows] of bad) {
    const r = await refused(mint(app, asMember(), 'display', columns, rows)).catch((e: Error) => ({ code: `accepted: ${what}`, message: e.message }));
    expect(r.code, what).toBe('MS006');
  }
  const id = await mint(app, asMember(), 'display', [...COLUMNS, { n: 'on', k: 'date' }, { n: 'at', k: 'ts' }, { n: 'n', k: 'int' }], [
    [{ k: 'text', t: 'Tea' }, cell, { k: 'date', d: '2026-10-29' }, { k: 'ts', a: '2026-10-29T10:00:00.000Z' }, { k: 'null' }],
  ]);
  const { rows } = await db.admin.query(
    `select row_count, rows_sha256 = sha256(convert_to(rows::text, 'UTF8')) as rows_ok, params_sha256 = sha256(convert_to(params::text, 'UTF8')) as params_ok,
            actor_id, created_txid > 0 as txid
       from snap.snapshot where id = $1`,
    [id],
  );
  expect(rows).toEqual([{ row_count: 1, rows_ok: true, params_ok: true, actor_id: t.owner, txid: true }]);
});

it('C3 a snapshot never changes, whoever asks', async () => {
  const id = await mintDisplay(db, t, t.owner);
  expect((await refused(tx(app, asMember(), (c) => c.query(`update snap.snapshot set rows = '[]' where id = $1`, [id])))).code).toBe('42501');
  expect((await refused(asOwner(db.admin, [`update snap.snapshot set row_count = 0 where id = '${id}'`], t.tenant))).code).toBe('MS010');
});

it('J2 the purge deletes old unpinned display, watch and evidence snapshots of its tenant, and never a pinned, recent or release one', async () => {
  const old = (id: string) => plant(db.admin, `update snap.snapshot set created_at = now() - interval '8 days' where id = $1`, [id]);
  const doomed = [
    await mint(app, asMember(), 'display', COLUMNS, rowsOf('1')),
    await mint(app, asMember(), 'evidence', COLUMNS, rowsOf('2')),
    await mint(jobs, { tenant_id: t.tenant }, 'watch', COLUMNS, rowsOf('3')),
  ];
  const pinned = await mint(app, asMember(), 'display', COLUMNS, rowsOf('4'));
  const recent = await mint(app, asMember(), 'display', COLUMNS, rowsOf('5'));
  const release = await mint(app, asMember(), 'release', COLUMNS, rowsOf('6'));
  const theirs = await mint(app, asMember(u), 'display', COLUMNS, rowsOf('7'), u.tenant);
  for (const id of [...doomed, pinned, release, theirs]) await old(id);
  await tx(app, asMember(), (c) => draftCiting(pinned, c));
  const purged = await tx(jobs, { tenant_id: t.tenant }, (c) => c.query<{ id: string }>('delete from snap.snapshot returning id'));
  expect(purged.rows.map((r) => r.id).sort()).toEqual([...doomed].sort());
  const kept = await db.admin.query(`select id from snap.snapshot where id = any($1)`, [[pinned, recent, release, theirs]]);
  expect(kept.rowCount).toBe(4);
  // The app holds no DELETE at all.
  expect((await refused(tx(app, asMember(), (c) => c.query('delete from snap.snapshot')))).code).toBe('42501');
});

it('J2 a pin and a purge racing on one snapshot never leave a pin without its snapshot, in either order', async () => {
  const s1 = await mintDisplay(db, t, t.owner);
  const s2 = await mintDisplay(db, t, t.owner);
  for (const id of [s1, s2]) await plant(db.admin, `update snap.snapshot set created_at = now() - interval '8 days' where id = $1`, [id]);
  const open = async (pool: pg.Pool, ctx: Record<string, string>) => {
    const c = await pool.connect();
    await c.query('begin');
    for (const [k, v] of Object.entries(ctx)) await c.query('select set_config($1, $2, true)', [`munshi.${k}`, v]);
    return c;
  };
  // The pin first: the purge waits on the pin's key-share lock, then its delete fails the pin's foreign key.
  const pinner = await open(app, asMember());
  const purger = await open(jobs, { tenant_id: t.tenant });
  try {
    await draftCiting(s1, pinner);
    const purge = purger.query('delete from snap.snapshot where id = $1', [s1]).then(
      () => 'deleted',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await pinner.query('commit');
    expect(await purge).toBe('23503');
    await purger.query('rollback');
  } finally {
    pinner.release();
    purger.release();
  }
  // The purge first: the pin waits on the purge's row lock, then fails its own foreign key.
  const purger2 = await open(jobs, { tenant_id: t.tenant });
  const pinner2 = await open(app, asMember());
  try {
    expect((await purger2.query('delete from snap.snapshot where id = $1', [s2])).rowCount).toBe(1);
    const pin = draftCiting(s2, pinner2).then(
      () => 'pinned',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 150));
    await purger2.query('commit');
    expect(await pin).toBe('23503');
    await pinner2.query('rollback');
  } finally {
    purger2.release();
    pinner2.release();
  }
  const orphans = await db.admin.query(`select count(*)::int as n from snap.pin p where not exists (select 1 from snap.snapshot s where s.id = p.snapshot_id)`);
  expect(orphans.rows[0].n).toBe(0);
  expect((await db.admin.query(`select count(*)::int as n from snap.pin where snapshot_id = $1`, [s1])).rows[0].n).toBe(1);
  expect((await db.admin.query(`select count(*)::int as n from snap.pin where snapshot_id = $1`, [s2])).rows[0].n).toBe(0);
});

it("J2 a pin is written only by its holder's trigger", async () => {
  const id = await mintDisplay(db, t, t.owner);
  const direct = await refused(
    tx(app, asMember(), (c) => c.query(`insert into snap.pin (tenant_id, snapshot_id, holder, holder_id) values ($1, $2, 'draft', $1)`, [t.tenant, id])),
  );
  expect(direct.code).toBe('MS018');
});

it('PUB1 the public role reads only snapshots a release pins, and only release pins', async () => {
  const shown = await mint(app, asMember(), 'release', COLUMNS, rowsOf('8'));
  const hidden = await mintDisplay(db, t, t.owner);
  await tx(app, asMember(), (c) => draftCiting(hidden, c));
  // No release table exists before 14_sites_public.sql, so the release pin is planted.
  await plant(db.admin, `insert into snap.pin (tenant_id, snapshot_id, holder, holder_id) values ($1, $2, 'release', $1)`, [t.tenant, shown]);
  const { rows } = await tx(db.as('munshi_public'), { tenant_id: t.tenant }, async (c) => ({
    rows: [
      (await c.query<{ id: string }>('select id from snap.snapshot')).rows.map((r) => r.id),
      (await c.query<{ holder: string }>('select distinct holder from snap.pin')).rows.map((r) => r.holder),
    ],
  }));
  expect(rows).toEqual([[shown], ['release']]);
});

it('C3 the owner role mints only a release snapshot, with no actor (off live only the owner publishes, the reset)', async () => {
  const mint = (purpose: string, actor?: string) =>
    asOwner(
      db.admin,
      [
        ...(actor ? [`select set_config('munshi.actor_id', '${actor}', false)`] : []),
        `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
         values ('${t.tenant}', 'site.catalogue', '{}', '${purpose}', '${JSON.stringify(COLUMNS)}', '${JSON.stringify(rowsOf('9'))}', '\\x00', '\\x00', 0)`,
      ],
      t.tenant,
    );
  expect((await refused(mint('display'))).code).toBe('MS018');
  expect((await refused(mint('release', t.owner))).code).toBe('MS018');
  await mint('release');
});
