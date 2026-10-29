// A throwaway PostgreSQL 17 for scripts/hero-smoke.ts, built as the v2 suites build their template (global-setup.ts):
// bootstrapped as the superuser, the login roles given their test passwords, then built from db/schema as
// munshi_migrator; stopped by the caller. It removes the two listeners embedded-postgres adds on import (its
// 'beforeExit' one calls process.exit(0), so a failing smoke would exit 0; its 'exit' one throws).
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { bootstrap } from '../../src/bootstrap.ts';
import { build } from '../../src/build.ts';
import { SUPERUSER } from './global-setup.ts';

const DATABASE = 'munshi_smoke';

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no free port'))));
    });
  });

export async function startLiveDb(): Promise<{ app: pg.Pool; agent: pg.Pool; stop: () => Promise<void> }> {
  const before = { beforeExit: process.listeners('beforeExit'), exit: process.listeners('exit') };
  const { default: EmbeddedPostgres } = await import('embedded-postgres-17');
  for (const l of process.listeners('beforeExit')) if (!before.beforeExit.includes(l)) process.removeListener('beforeExit', l);
  for (const l of process.listeners('exit')) if (!before.exit.includes(l)) process.removeListener('exit', l);
  const port = await freePort();
  const cluster = new EmbeddedPostgres({ databaseDir: path.join(tmpdir(), `munshi-smoke-${randomBytes(6).toString('hex')}`), port, ...SUPERUSER, persistent: false, onLog: () => {} });
  await cluster.initialise();
  await cluster.start();
  const client = async (database: string, login: { user: string; password: string }) => {
    const c = new pg.Client({ host: '127.0.0.1', port, database, ...login });
    await c.connect();
    return c;
  };
  try {
    const admin = await client('postgres', SUPERUSER);
    await admin.query(`create database ${DATABASE}`);
    const db = await client(DATABASE, SUPERUSER);
    await bootstrap(db);
    await db.end();
    const { rows } = await admin.query<{ rolname: string }>("select rolname from pg_roles where rolname like 'munshi\\_%' and rolcanlogin");
    for (const { rolname } of rows) await admin.query(`alter role ${rolname} password '${rolname}'`);
    await admin.end();
    const migrator = await client(DATABASE, { user: 'munshi_migrator', password: 'munshi_migrator' });
    await build(migrator);
    await migrator.end();
  } catch (err) {
    await cluster.stop(); // no listener is left to stop it
    throw err;
  }
  const pool = (user: string) => new pg.Pool({ host: '127.0.0.1', port, database: DATABASE, user, password: user, max: 4 });
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
