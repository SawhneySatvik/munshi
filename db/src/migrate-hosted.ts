// The hosted migration path (separate from migrate.ts so the test config can swap migrate.ts for it).
import type pg from 'pg';
import { migrate, migrationsDir } from './migrate.ts';

export { migrationsDir };

// 0001 creates the roles and revokes on pg_catalog and the database, so it needs a superuser (or the cluster's admin):
// it is the one bootstrap file. Every later file runs as munshi_migrator (see migrateAsMigrator).
export const BOOTSTRAP = '0001_roles_schemas.sql';

// The hosted path: the bootstrap file as `admin`, then everything else as munshi_migrator, which is not a superuser
// and holds only what the files need (membership of munshi_owner, which owns every object). `admin` is used only when
// the bootstrap is still to run; after that a run needs the migrator connection alone.
export async function migrateAsMigrator(admin: pg.Client | undefined, migrator: () => Promise<pg.Client>, dir = migrationsDir): Promise<string[]> {
  const ran: string[] = [];
  if (admin) {
    ran.push(...(await migrate(admin, dir, (f) => f === BOOTSTRAP)));
    await admin.query('grant select, insert on public.munshi_migration to munshi_migrator');
  }
  const client = await migrator();
  try {
    ran.push(...(await migrate(client, dir, (f) => f !== BOOTSTRAP)));
  } finally {
    await client.end();
  }
  return ran;
}

