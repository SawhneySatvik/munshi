// One PostgreSQL 17 cluster per v2 vitest run (embedded-postgres-17, an alias of embedded-postgres@17), and a template
// database bootstrapped as the superuser, then built from db/schema over a munshi_migrator connection, as on the hosted
// database: a file that needs a superuser fails every suite (BUILD-SUPERUSER). Each test file clones the template
// (test/v2/db.ts). Red-proofs: test/v2/sabotage/harness.ts.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { bootstrap } from '../../src/bootstrap.ts';
import { build } from '../../src/build.ts';
import { SCHEMA_DIR } from '../../src/schema-files.ts';
import { sabotageIs } from './sabotage/index.ts';

export const SUPERUSER = { user: 'postgres', password: 'postgres' };
export const TEMPLATE = 'munshi_template';

declare module 'vitest' {
  interface ProvidedContext {
    pg17Port: number;
  }
}

// The build's connection, for the template and for the tests that call build(): munshi_migrator, never the superuser.
// Test passwords are the role names; production sets its own out of band.
export const builder = (): { user: string; password: string } =>
  sabotageIs('v2-build-superuser') ? SUPERUSER : { user: 'munshi_migrator', password: 'munshi_migrator' };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no free port'))));
    });
  });
}

async function connected(port: number, database: string, login: { user: string; password: string }): Promise<pg.Client> {
  const c = new pg.Client({ host: '127.0.0.1', port, database, ...login });
  await c.connect();
  return c;
}

export default async function setup(project: TestProject) {
  // embedded-postgres registers async-exit-hook on import. Its 'beforeExit' listener calls process.exit(0), which
  // overwrites the exit code vitest sets for a failed test, so a failing run would exit 0; its 'exit' listener throws,
  // so a passing run would exit 1. Remove exactly the one of each it adds, and refuse to start if the count differs.
  // Teardown stops the cluster; our own 'exit' listener below kills it if teardown never ran. Gate G8 red-proves this.
  const listening = () => ({ beforeExit: process.listeners('beforeExit'), exit: process.listeners('exit') });
  const before = listening();
  const { default: EmbeddedPostgres } = sabotageIs('v2-pg18') ? await import('embedded-postgres') : await import('embedded-postgres-17');
  const after = listening();
  const added = {
    beforeExit: after.beforeExit.filter((l) => !before.beforeExit.includes(l)),
    exit: after.exit.filter((l) => !before.exit.includes(l)),
  };
  if (added.beforeExit.length !== 1 || added.exit.length !== 1) {
    throw new Error(`expected embedded-postgres to add one 'beforeExit' and one 'exit' listener, not ${added.beforeExit.length} and ${added.exit.length}`);
  }
  if (!sabotageIs('v2-g8-exit-hook')) {
    for (const l of added.beforeExit) process.removeListener('beforeExit', l);
    for (const l of added.exit) process.removeListener('exit', l);
  }

  const port = await freePort();
  const databaseDir = path.join(tmpdir(), `munshi-pg17-${randomBytes(6).toString('hex')}`);
  const cluster = new EmbeddedPostgres({ databaseDir, port, ...SUPERUSER, persistent: false, initdbFlags: ['--encoding=UTF8'], onLog: () => {} });
  await cluster.initialise();
  await cluster.start();
  process.on('exit', () => {
    try {
      const pid = Number(readFileSync(path.join(databaseDir, 'postmaster.pid'), 'utf8').split('\n')[0]);
      process.kill(pid, 'SIGINT');
    } catch {
      // already stopped by the teardown: postmaster.pid is gone
    }
  });

  try {
    const admin = await connected(port, 'postgres', SUPERUSER);
    try {
      // The schema normalizes text (NFKC), which Postgres does only in a UTF8 database; initdb would otherwise take the
      // machine's locale (SQL_ASCII under a POSIX one, as in a bare container).
      const { rows: enc } = await admin.query<{ server_encoding: string }>('show server_encoding');
      if (enc[0]?.server_encoding !== 'UTF8') throw new Error(`the test cluster's server encoding is ${enc[0]?.server_encoding}, not UTF8`);
      await admin.query(`create database ${TEMPLATE}`);
      const tpl = await connected(port, TEMPLATE, SUPERUSER);
      try {
        await bootstrap(tpl, SCHEMA_DIR);
      } finally {
        await tpl.end();
      }
      // Roles are cluster-wide; the bootstrap made them, so the test passwords are set before the build logs in.
      const { rows } = await admin.query<{ rolname: string }>("select rolname from pg_roles where rolname like 'munshi\\_%' and rolcanlogin order by 1");
      if (!rows.some((r) => r.rolname === 'munshi_migrator')) throw new Error('the bootstrap made no munshi_migrator login');
      for (const { rolname } of rows) await admin.query(`alter role ${rolname} password '${rolname}'`);
      const migrator = await connected(port, TEMPLATE, builder());
      try {
        await build(migrator, { dir: SCHEMA_DIR });
      } finally {
        await migrator.end();
      }
    } finally {
      await admin.end();
    }
  } catch (err) {
    await cluster.stop();
    // vitest prints a global-setup error by mapping its stack frames through vite's module runner, which crashes on
    // these modules ("code.charCodeAt is not a function") and hides the message. So the error goes out with no frames:
    // its message alone, which names the schema file and carries Postgres's own words.
    const plain = new Error(`v2 template build failed: ${(err as Error).message}`);
    plain.stack = plain.message;
    throw plain;
  }

  project.provide('pg17Port', port);
  return async () => {
    await cluster.stop();
  };
}
