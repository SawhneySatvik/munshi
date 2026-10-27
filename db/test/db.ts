// Per-test-file database: a fresh clone of the migrated template, plus pools connected as the real login roles.
// Never mock the database here: grants, RLS and the book guard are the things under test.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import manifest from '../migrations/manifest.json' with { type: 'json' };
import { SUPERUSER, TEMPLATE } from './global-setup.ts';
import { reportSabotage, sabotageIs, sabotageSql } from './sabotage.ts';

export type Ctx = { tenant?: string; actor?: string; decision?: string; command?: string };
type Queryable = pg.Pool | pg.PoolClient;

export type TestDb = {
  name: string;
  admin: pg.Pool; // superuser: fixtures that need it, catalog reads, tampering
  app: pg.Pool; // munshi_app
  agent: pg.Pool; // munshi_agent
  sabotage: () => Promise<void>; // call at the end of beforeAll, after the fixtures (see test/sabotage.ts)
  close: () => Promise<void>;
};

export async function openTestDb(): Promise<TestDb> {
  const port = inject('pgPort');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const server = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', ...SUPERUSER });
  await server.connect();
  await server.query(`create database ${name} template ${TEMPLATE}`);
  // The clone gets every object and object ACL of the template but a default database ACL (PUBLIC: CONNECT, TEMP), which
  // would undo 0001's TEMP revoke; copy the migrated template's ACL so each test database is what the migrations made.
  await server.query('update pg_database set datacl = (select datacl from pg_database where datname = $1) where datname = $2', [TEMPLATE, name]);
  await server.end();
  const pool = (user: string, password: string) =>
    new pg.Pool({ host: '127.0.0.1', port, database: name, user, password, max: 4 });
  const admin = pool(SUPERUSER.user, SUPERUSER.password);
  const app = pool('munshi_app', 'munshi_app');
  const agent = pool('munshi_agent', 'munshi_agent');
  return {
    name,
    admin,
    app,
    agent,
    sabotage: async () => {
      const name = process.env.MUNSHI_SABOTAGE;
      if (!name) return;
      try {
        const sql = sabotageSql(name);
        if (!sql) return; // a ts or harness-level case reports itself
        await admin.query(sql);
      } catch (err) {
        reportSabotage(name, 'failed', (err as Error).message);
        throw err;
      }
      reportSabotage(name, 'applied');
    },
    close: async () => {
      await Promise.all([admin.end(), app.end(), agent.end()]);
      // pool.end() resolves before the sockets close; DROP ... WITH (FORCE) then killed closing backends and their 57P01
      // surfaced as an unhandled error. Wait for the backends to leave instead; a plain DROP fails loudly if one stays.
      const s = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', ...SUPERUSER });
      await s.connect();
      for (let i = 0; i < 250; i++) {
        const { rows } = await s.query('select count(*)::int as n from pg_stat_activity where datname = $1', [name]);
        if (rows[0].n === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await s.query(`drop database ${name}`);
      await s.end();
    },
  };
}

// The context is transaction-local (SET LOCAL semantics via set_config(..., true)), so it can never leak to the next
// transaction on a pooled connection.
export async function setCtx(client: pg.PoolClient, ctx: Ctx, local = true): Promise<void> {
  for (const [key, value] of Object.entries(ctx)) {
    const setting = { tenant: 'munshi.tenant_id', actor: 'munshi.actor_id', decision: 'munshi.decision_id', command: 'munshi.command' }[key];
    if (!setting) throw new Error(`unknown context key ${key}`);
    await client.query('select set_config($1, $2, $3)', [setting, value, local]);
  }
}

// Runs fn in one transaction with ctx. Given a held client instead of a pool, the transaction reuses that connection.
// Sabotage 'g2-session-set' makes a held client's context session-wide (what SET without LOCAL does) to prove G2
// notices the leak.
export async function tx<T>(on: Queryable, ctx: Ctx, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const held = !(on instanceof pg.Pool);
  const client = held ? (on as pg.PoolClient) : await (on as pg.Pool).connect();
  try {
    await client.query('begin');
    await setCtx(client, ctx, !(held && sabotageIs('g2-session-set')));
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    if (!held) client.release();
  }
}

export type Refusal = { code: string; message: string };

export async function refused(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; message: string };
    return { code: e.code ?? '', message: e.message };
  }
  throw new Error('expected a refusal, but the statement succeeded');
}

// The manifest is the independent list every catalog-wide gate counts against.
export const MANIFEST = manifest as { tables: string[]; globalTables: string[]; views: string[]; functions: string[] };
export const TENANT_TABLES = MANIFEST.tables.filter((t) => !MANIFEST.globalTables.includes(t));
export const BOOK_TABLES = MANIFEST.tables.filter((t) => t.startsWith('books.'));
export const SCHEMAS = ['ops', 'books', 'approval', 'snap', 'audit', 'agent_view'];
