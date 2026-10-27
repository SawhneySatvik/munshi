// Runs only under test/migrator.vitest.config.ts (its name does not match the default include): the template was built
// by munshi_migrator, and that role is what the hosted migration needs and nothing more.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { inject } from 'vitest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrateAsMigrator } from '../src/migrate-hosted.ts';
import { openTestDb, type TestDb } from './db.ts';

// Read from the directory itself, an independent count of what must have been applied.
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
});
afterAll(() => db.close());

it('MS-13 the migrator is no superuser, bypasses no RLS and can create no role or database', async () => {
  const { rows } = await db.admin.query(
    `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit, rolcanlogin from pg_roles where rolname = 'munshi_migrator'`,
  );
  expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolinherit: false, rolcanlogin: true }]);
});

it('MS-13 every migration file was applied, and a second run as the migrator alone is a no-op', async () => {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  const { rows } = await db.admin.query('select count(*)::int as n from public.munshi_migration');
  expect(files.length).toBeGreaterThanOrEqual(9);
  expect(rows[0].n).toBe(files.length);
  const port = inject('pgPort');
  const again = await migrateAsMigrator(undefined, async () => {
    const c = new pg.Client({ host: '127.0.0.1', port, database: db.name, user: 'munshi_migrator', password: 'munshi_migrator' });
    await c.connect();
    return c;
  });
  expect(again).toEqual([]);
});
