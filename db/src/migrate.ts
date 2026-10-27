// Applies db/migrations/*.sql in name order, each in its own transaction, and records a sha256 per file so an
// applied migration that was edited afterwards is refused (fix forward with a new file instead).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrateAsMigrator } from './migrate-hosted.ts';

export const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(client: pg.Client, dir = migrationsDir, only: (file: string) => boolean = () => true): Promise<string[]> {
  // The migrator cannot create in `public` (0001 revokes it), so the bookkeeping table is made once, by the bootstrap.
  const { rows: made } = await client.query("select to_regclass('public.munshi_migration') as t");
  if (!made[0].t) {
    await client.query(
      'create table public.munshi_migration (name text primary key, sha256 text not null, applied_at timestamptz not null default now())',
    );
  }
  const { rows } = await client.query<{ name: string; sha256: string }>('select name, sha256 from public.munshi_migration');
  const applied = new Map(rows.map((r) => [r.name, r.sha256]));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && only(f)).sort();
  const ran: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), 'utf8');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    const before = applied.get(file);
    if (before !== undefined) {
      if (before !== sha256) throw new Error(`migration ${file} was edited after it was applied`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('reset role'); // a file's `set local role munshi_owner` must not apply to the bookkeeping
      await client.query('insert into public.munshi_migration (name, sha256) values ($1, $2)', [file, sha256]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
    ran.push(file);
  }
  return ran;
}

// CLI. URLs come from the process environment and are never printed.
//   hosted:  MIGRATOR_DATABASE_URL (munshi_migrator) and, only while 0001 is still to run, ADMIN_DATABASE_URL
//   local:   DATABASE_URL, a superuser connection (what `pnpm dev` and the tests do)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const connect = async (url: string) => {
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    return c;
  };
  const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
  const adminUrl = migratorUrl ? process.env.ADMIN_DATABASE_URL : process.env.DATABASE_URL;
  if (!migratorUrl && !adminUrl) throw new Error('MIGRATOR_DATABASE_URL (hosted) or DATABASE_URL (a local superuser) is not set');
  const admin = adminUrl ? await connect(adminUrl) : undefined;
  try {
    const ran = migratorUrl ? await migrateAsMigrator(admin, () => connect(migratorUrl)) : await migrate(admin as pg.Client);
    console.log(ran.length ? `applied ${ran.join(', ')}` : 'up to date');
  } finally {
    await admin?.end();
  }
}
