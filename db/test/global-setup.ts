// Starts one embedded Postgres cluster per vitest run, migrates a template database once, and hands the port to the
// test files; each file clones the template into its own fresh database (test/db.ts).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../src/migrate.ts';
import { sabotageIs } from './sabotage.ts';

export const SUPERUSER = { user: 'postgres', password: 'postgres' };
// Test-only passwords for the login roles; production sets its own out of band.
export const LOGIN_ROLES = ['munshi_app', 'munshi_agent', 'munshi_migrator'] as const;
export const TEMPLATE = 'munshi_template';

declare module 'vitest' {
  interface ProvidedContext {
    pgPort: number;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

export default async function setup(project: TestProject) {
  // embedded-postgres registers async-exit-hook. Its 'beforeExit' listener calls process.exit(0), overwriting the
  // exitCode vitest sets when a test fails, so a failing run would exit 0; its 'exit' listener then throws (it calls
  // a callback it was not given), so a passing run would exit 1. Remove exactly those two listeners; teardown stops
  // the cluster, and our own 'exit' listener below kills it if teardown never ran. Gate G8 red-proves this.
  const listening = () => ({ beforeExit: process.listeners('beforeExit'), exit: process.listeners('exit') });
  const before = listening();
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const after = listening();
  const added = {
    beforeExit: after.beforeExit.filter((l) => !before.beforeExit.includes(l)),
    exit: after.exit.filter((l) => !before.exit.includes(l)),
  };
  if (added.beforeExit.length !== 1 || added.exit.length !== 1) {
    throw new Error(`expected embedded-postgres to add one 'beforeExit' and one 'exit' listener`);
  }
  if (!sabotageIs('g8-exit-hook')) {
    for (const l of added.beforeExit) process.removeListener('beforeExit', l);
    for (const l of added.exit) process.removeListener('exit', l);
  }

  const port = await freePort();
  const databaseDir = path.join(tmpdir(), `munshi-pg-${randomBytes(6).toString('hex')}`);
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
    const admin = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', ...SUPERUSER });
    await admin.connect();
    await admin.query(`create database ${TEMPLATE}`);
    const tpl = new pg.Client({ host: '127.0.0.1', port, database: TEMPLATE, ...SUPERUSER });
    await tpl.connect();
    try {
      await migrate(tpl);
    } finally {
      await tpl.end();
    }
    // Roles are cluster-wide and 0001 creates them, so their passwords are set after migrating.
    for (const role of LOGIN_ROLES) await admin.query(`alter role ${role} password '${role}'`);
    await admin.end();
  } catch (err) {
    await cluster.stop();
    throw err;
  }

  project.provide('pgPort', port);
  return async () => {
    await cluster.stop();
  };
}
