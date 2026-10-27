// Applies db/migrations/*.sql in name order, each in its own transaction, and records a sha256 per file so an
// applied migration that was edited afterwards is refused (fix forward with a new file instead).
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(client: pg.Client, dir = migrationsDir): Promise<string[]> {
  await client.query(
    'create table if not exists public.munshi_migration (name text primary key, sha256 text not null, applied_at timestamptz not null default now())',
  );
  const { rows } = await client.query<{ name: string; sha256: string }>('select name, sha256 from public.munshi_migration');
  const applied = new Map(rows.map((r) => [r.name, r.sha256]));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
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

// CLI: DATABASE_URL comes from the process environment; it is never printed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const ran = await migrate(client);
    console.log(ran.length ? `applied ${ran.join(', ')}` : 'up to date');
  } finally {
    await client.end();
  }
}
