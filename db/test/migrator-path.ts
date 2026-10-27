// Stands in for src/migrate.ts's `migrate` in test/migrator.vitest.config.ts (an alias), so the unchanged global setup
// builds its template the hosted way: 0001 as the cluster admin, everything after as munshi_migrator. Every gate then
// runs against a database that role built. MS13_SUPERUSER_MIGRATOR=1 gives the role superuser first (the red-proof).
import pg from 'pg';
import { migrateAsMigrator, migrationsDir } from '../src/migrate-hosted.ts';

export { migrationsDir };

export async function migrate(admin: pg.Client, dir = migrationsDir): Promise<string[]> {
  // pg keeps these on the client but does not type them
  const { host, port, database } = (admin as unknown as { connectionParameters: { host: string; port: number; database: string } }).connectionParameters;
  return migrateAsMigrator(admin, async () => {
    // The role exists only once 0001 has run.
    await admin.query(`alter role munshi_migrator password 'munshi_migrator'`);
    if (process.env.MS13_SUPERUSER_MIGRATOR) await admin.query('alter role munshi_migrator superuser');
    const c = new pg.Client({ host, port, database, user: 'munshi_migrator', password: 'munshi_migrator' });
    await c.connect();
    return c;
  }, dir);
}
