// G10: every index the migrations declare exists in pg_index on its table with exactly its columns (never trust
// `create index if not exists`), and tenant_id leads every index and foreign key of every tenant table.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrationsDir } from '../src/migrate.ts';
import { openTestDb, TENANT_TABLES, type TestDb } from './db.ts';

let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
  await db.sabotage();
});
afterAll(() => db.close());

const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'))
  .join('\n');

it('G10 every declared index exists in pg_index with its columns', async () => {
  const mentions = sql.match(/\bcreate\s+(unique\s+)?index\b/gi) ?? [];
  const declared = [
    ...sql.matchAll(/create\s+(unique\s+)?index\s+(?:if\s+not\s+exists\s+)?(\w+)\s+on\s+(\w+)\.(\w+)\s*\(([^)]*)\)\s*(where\b[^;]*)?;/gi),
  ].map((m) => ({
    unique: Boolean(m[1]),
    name: m[2] as string,
    table: `${m[3]}.${m[4]}`,
    columns: (m[5] as string).split(',').map((c) => c.trim()),
    partial: Boolean(m[6]),
  }));
  console.log(`G10 ${declared.length} indexes declared in the migrations (${mentions.length} create index statements)`);
  expect(declared.length).toBeGreaterThan(0);
  expect(declared.length).toBe(mentions.length); // a statement the parser skipped would otherwise pass unseen
  for (const d of declared) {
    const { rows } = await db.admin.query(
      `select tc.relnamespace::regnamespace::text || '.' || tc.relname as table, i.indisunique as unique,
              i.indpred is not null as partial,
              array(select a.attname from unnest(i.indkey) with ordinality k(attnum, ord)
                      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum order by k.ord)::text[] as columns
         from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class tc on tc.oid = i.indrelid
        where ic.relname = $1 and ic.relnamespace = $2::regnamespace`,
      [d.name, d.table.split('.')[0]],
    );
    expect(rows, d.name).toEqual([{ table: d.table, unique: d.unique, partial: d.partial, columns: d.columns }]);
  }
});

it('G10 tenant_id leads every index and foreign key on every tenant table', async () => {
  const { rows } = await db.admin.query<{ rel: string; kind: string; name: string; first: string }>(
    `select i.indrelid::regclass::text as rel, 'index' as kind, ic.relname as name,
            (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0]) as first
       from pg_index i join pg_class ic on ic.oid = i.indexrelid
      where i.indrelid = any($1::regclass[])
     union all
     select c.conrelid::regclass::text, 'foreign key', c.conname,
            (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1])
       from pg_constraint c where c.contype = 'f' and c.conrelid = any($1::regclass[])`,
    [TENANT_TABLES],
  );
  const indexes = rows.filter((r) => r.kind === 'index').length;
  console.log(`G10 ${indexes} indexes and ${rows.length - indexes} foreign keys on ${TENANT_TABLES.length} tenant tables`);
  expect(indexes).toBeGreaterThanOrEqual(TENANT_TABLES.length); // at least each primary key
  expect(rows.filter((r) => r.first !== 'tenant_id')).toEqual([]);
});
