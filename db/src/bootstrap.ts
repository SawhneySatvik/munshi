// pnpm db:bootstrap — db/schema/00_bootstrap.sql as the cluster's admin (a local superuser, or `postgres` on Supabase),
// once per database: the eight roles, the owner's CREATE on the database, schema extensions, the PUBLIC revokes
// (BLUEPRINT §2.2). The file is idempotent, so a second run changes nothing.
import { fileURLToPath } from 'node:url';
import { databaseTls, applyDatabaseTls } from '@munshi/core';
import pg from 'pg';
import { applyFile, readSchema, SCHEMA_DIR } from './schema-files.ts';

export async function bootstrap(admin: pg.Client, dir = SCHEMA_DIR): Promise<void> {
  const file = readSchema(dir).bootstrap;
  if (!file) throw new Error(`bootstrap: ${dir} has no 00_bootstrap.sql`);
  await applyFile(admin, file);
}

// CLI: ADMIN_DATABASE_URL from the environment, never printed. No flags.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root (deploy/supabase.md)
  if (process.argv.length > 2) throw new Error(`bootstrap takes no arguments, not ${process.argv.slice(2).join(' ')}`);
  const url = process.env.ADMIN_DATABASE_URL;
  if (!url) throw new Error('ADMIN_DATABASE_URL (the cluster admin) is not set');
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await bootstrap(admin);
    console.log('bootstrap: 00_bootstrap.sql applied');
  } finally {
    await admin.end();
  }
}
