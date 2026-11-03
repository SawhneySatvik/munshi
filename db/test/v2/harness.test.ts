// The v2 harness and runner: PostgreSQL 17, and build() over temporary schema directories as munshi_migrator, the
// connection the template is built over. Red-proofs: test/v2/sabotage/harness.ts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { build } from '../../src/build.ts';
import { openTestDb, type TestDb } from './db.ts';

// The ten schemas, written out here rather than imported from build.ts, so the drop list is checked independently.
const MUNSHI_SCHEMAS = ['ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'agent_view', 'idp', 'platform'];

let db: TestDb;
const dirs: string[] = [];

beforeAll(async () => {
  db = await openTestDb();
  await db.sabotage();
});

afterAll(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  await db?.close();
});

function schemaDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-schema-'));
  dirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}

async function asMigrator<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = await db.migrator();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const schemas = async () =>
  (
    await db.admin.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname <> 'information_schema' order by nspname",
    )
  ).rows.map((r) => r.nspname);

it('the harness runs PostgreSQL 17', async () => {
  const { rows } = await db.admin.query<{ major: number }>("select current_setting('server_version_num')::int / 10000 as major");
  expect(rows[0]?.major).toBe(17);
});

it('an empty set builds: the ten Munshi schemas are dropped and no schema is written', async () => {
  await asMigrator(async (c) => {
    for (const s of MUNSHI_SCHEMAS) {
      await c.query(`set role munshi_owner; create schema if not exists ${s}; create table ${s}.leftover (n int); reset role`);
    }
    const before = await schemas();
    expect(before).toEqual(expect.arrayContaining(MUNSHI_SCHEMAS));
    const built = await build(c, { dir: schemaDir({}) });
    expect(built.files).toEqual([]);
    expect(await schemas()).toEqual(before.filter((s) => !MUNSHI_SCHEMAS.includes(s)));
  });
});

it('the build runs as munshi_migrator: a file that needs a superuser fails, naming the file', async () => {
  const dir = schemaDir({ '01_needs_superuser.sql': 'create extension if not exists pg_stat_statements;\n' });
  await asMigrator(async (c) => {
    await expect(build(c, { dir })).rejects.toThrow(/01_needs_superuser\.sql.*permission denied/);
  });
  const { rows } = await db.admin.query("select 1 from pg_extension where extname = 'pg_stat_statements'");
  expect(rows).toHaveLength(0);
});

it('the build refuses a live deployment, naming live, and leaves it standing; a demo one is rebuilt', async () => {
  const empty = schemaDir({});
  const deployment = (kind: string) =>
    `set role munshi_owner;
     create schema ops;
     create table ops.deployment (one bool primary key default true check (one), kind text not null, hosted bool not null,
                                  created_at timestamptz not null default now());
     insert into ops.deployment (kind, hosted) values ('${kind}', true);
     reset role`;
  const deployed = async () => (await db.admin.query("select to_regclass('ops.deployment') as t")).rows[0].t;
  await asMigrator(async (c) => {
    await build(c, { dir: empty }); // a clean slate, whatever the template holds
    await c.query(deployment('demo'));
    await build(c, { dir: empty });
    expect(await deployed()).toBeNull();
    await c.query(deployment('live'));
    await expect(build(c, { dir: empty })).rejects.toThrow(/\blive\b/);
  });
  expect(await deployed()).toBe('ops.deployment');
  expect((await db.admin.query('select kind from ops.deployment')).rows).toEqual([{ kind: 'live' }]);
  await db.admin.query('drop schema ops cascade'); // a live row would refuse every later build in this file
});

it('files apply in name order and 00 is not the build’s; swapped, the build fails naming the file that ran too early', async () => {
  const make = 'set local role munshi_owner;\ncreate schema ops;\ncreate table ops.order_probe (n int);\n';
  const use = 'set local role munshi_owner;\ninsert into ops.order_probe values (1);\n';
  const bootstrap = "do $$ begin raise exception 'the build ran 00_bootstrap.sql'; end $$;\n";
  await asMigrator(async (c) => {
    // Written in reverse, so the directory's own order is not the name order.
    const built = await build(c, { dir: schemaDir({ '02_use.sql': use, '01_make.sql': make, '00_bootstrap.sql': bootstrap }) });
    expect(built.files).toEqual(['01_make.sql', '02_use.sql']);
    expect((await db.admin.query('select count(*)::int as n from ops.order_probe')).rows[0].n).toBe(1);
    const swapped = build(c, { dir: schemaDir({ '02_make.sql': make, '01_use.sql': use }) });
    await expect(swapped).rejects.toThrow(/^schema file 01_use\.sql failed: .*order_probe/);
  });
});
