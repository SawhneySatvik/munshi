// 90_seal.sql: the seal passes on the built schema, and raises naming each problem it is planted with: an unforced
// table, a books table with no ref row, a command that writes nothing and has no capability, a pack missing a
// requirement, a function left to PUBLIC with an unpinned search_path, an id not defaulting to ops.uuidv7(), a child of a
// reversible header that does not reverse (the invoice and the package holding are the two the seal exempts). The planted
// problems and the seal run in one transaction that is rolled back. Red-proofs: test/v2/sabotage/seal.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SCHEMA_DIR } from '../../../src/schema-files.ts';
import { openTestDb, type TestDb } from '../db.ts';
import { refused } from './lib.ts';

let db: TestDb;

beforeAll(async () => {
  db = await openTestDb();
  await db.sabotage();
});
afterAll(() => db?.close());

const seal = readFileSync(path.join(SCHEMA_DIR, '90_seal.sql'), 'utf8');

async function runSeal(plantSql = ''): Promise<void> {
  const c = await db.migrator();
  try {
    await c.query('begin');
    await c.query(`set local role munshi_owner; ${plantSql}`);
    await c.query(seal);
  } finally {
    await c.query('rollback');
    await c.end();
  }
}

it('SEAL the seal passes on the built schema, and names every problem planted in it', async () => {
  await runSeal();
  const r = await refused(
    runSeal(`
      create table ops.seal_stray (id uuid primary key default gen_random_uuid());
      create table books.seal_book (n int);
      alter table books.seal_book enable row level security;
      alter table books.seal_book force row level security;
      create policy p on books.seal_book using (true);
      insert into ref.command (command, draft_only) values ('seal.orphan', false);
      delete from ref.pack_capability where business_type = 'kirana' and capability = 'counter';
      create function ops.seal_fn() returns int language sql as 'select 1';
      insert into ref.book_table (rel, parent_rel, parent_col, reversible) values ('books.seal_child', 'books.sale', 'sale_id', false);`),
  );
  const want = [
    'ops.seal_stray: RLS not enabled, RLS not forced, no policy',
    'books.seal_book: no ref.book_table row',
    'command seal.orphan: writes no books table, no ref.command_capability row',
    'pack kirana: credit requires counter, which the pack lacks',
    'function ops.seal_fn(): search_path not pinned, executable by PUBLIC',
    'ops.seal_stray.id: defaults to gen_random_uuid(), not ops.uuidv7()',
    'ref.book_table books.seal_child: a child of reversible books.sale that does not reverse',
  ];
  console.log(`SEAL raised: ${r.message.slice(0, 120)}…`);
  expect(r.code).toBe('P0001');
  for (const w of want) expect(r.message, w).toContain(w);
});
