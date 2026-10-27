// A throwaway embedded Postgres for scripts/hero-smoke.ts: started, migrated, with the login roles' test passwords,
// stopped by the caller. Like global-setup.ts, it removes the two listeners embedded-postgres adds on import (its
// 'beforeExit' one calls process.exit(0), so a failing smoke would exit 0; its 'exit' one throws).
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { migrate } from '../src/migrate.ts';
import { LOGIN_ROLES, SUPERUSER } from './global-setup.ts';

export async function startLiveDb(): Promise<{ app: pg.Pool; agent: pg.Pool; stop: () => Promise<void> }> {
  const before = { beforeExit: process.listeners('beforeExit'), exit: process.listeners('exit') };
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  for (const l of process.listeners('beforeExit')) if (!before.beforeExit.includes(l)) process.removeListener('beforeExit', l);
  for (const l of process.listeners('exit')) if (!before.exit.includes(l)) process.removeListener('exit', l);
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const cluster = new EmbeddedPostgres({ databaseDir: path.join(tmpdir(), `munshi-smoke-${randomBytes(6).toString('hex')}`), port, ...SUPERUSER, persistent: false, onLog: () => {} });
  await cluster.initialise();
  await cluster.start();
  const admin = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', ...SUPERUSER });
  await admin.connect();
  await migrate(admin);
  for (const role of LOGIN_ROLES) await admin.query(`alter role ${role} password '${role}'`);
  await admin.end();
  const pool = (user: string) => new pg.Pool({ host: '127.0.0.1', port, database: 'postgres', user, password: user, max: 4 });
  const app = pool('munshi_app');
  const agent = pool('munshi_agent');
  return {
    app,
    agent,
    stop: async () => {
      await Promise.all([app.end(), agent.end()]);
      await cluster.stop();
    },
  };
}
