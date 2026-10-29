// Per-test-file database for the v2 suites: a fresh clone of the template test/v2/global-setup.ts built, pools as the
// real login roles, and the build's own connection. Never mock the database: grants, RLS and the guard are under test.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { builder, SUPERUSER, TEMPLATE } from './global-setup.ts';
import { reportSabotage, sabotageSql } from './sabotage/index.ts';

// The custom settings a transaction may carry (BLUEPRINT §2.3), each as munshi.<key>. Any other key throws: a misspelt
// setting would leave RLS seeing no tenant, and an isolation test would pass for the wrong reason.
const SETTINGS = ['tenant_id', 'actor_id', 'command', 'decision_id', 'via', 'hold_token', 'reset_token', 'operator_id', 'platform_change_id', 'totp_at'];
export type Ctx = Record<string, string>;

export type TestDb = {
  name: string;
  admin: pg.Pool; // superuser: fixtures that need it, catalog reads, tampering
  as: (role: string) => pg.Pool; // a login role; its test password is its name
  migrator: () => Promise<pg.Client>; // the build's connection (global-setup's builder); the caller ends it
  sabotage: () => Promise<void>; // call at the end of beforeAll, after the fixtures (see test/v2/sabotage/index.ts)
  close: () => Promise<void>;
};

export async function openTestDb(): Promise<TestDb> {
  const port = inject('pg17Port');
  const name = `t_${randomBytes(6).toString('hex')}`;
  const server = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', ...SUPERUSER });
  await server.connect();
  await server.query(`create database ${name} template ${TEMPLATE}`);
  // A clone gets the template's objects but a default database ACL, which would drop the bootstrap's grants and revokes
  // on the database (the owner's CREATE, PUBLIC's TEMP): copy the template's.
  await server.query('update pg_database set datacl = (select datacl from pg_database where datname = $1) where datname = $2', [TEMPLATE, name]);
  await server.end();
  const pools = new Map<string, pg.Pool>();
  const pool = (user: string, password: string) => {
    let p = pools.get(user);
    if (!p) {
      p = new pg.Pool({ host: '127.0.0.1', port, database: name, user, password, max: 4 });
      pools.set(user, p);
    }
    return p;
  };
  return {
    name,
    admin: pool(SUPERUSER.user, SUPERUSER.password),
    as: (role) => pool(role, role),
    migrator: async () => {
      const c = new pg.Client({ host: '127.0.0.1', port, database: name, ...builder() });
      await c.connect();
      return c;
    },
    sabotage: async () => {
      const current = process.env.MUNSHI_SABOTAGE;
      if (!current) return;
      try {
        const sql = sabotageSql(current);
        if (!sql) return; // a ts or harness-level case reports itself
        await pool(SUPERUSER.user, SUPERUSER.password).query(sql);
      } catch (err) {
        reportSabotage(current, 'failed', (err as Error).message);
        throw err;
      }
      reportSabotage(current, 'applied');
    },
    close: async () => {
      await Promise.all([...pools.values()].map((p) => p.end()));
      // pool.end() resolves before the sockets close, so wait for the backends to leave; a plain DROP then fails loudly
      // if one stays.
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

// Runs fn in one transaction whose context is transaction-local (set_config(…, true), SET LOCAL semantics), so it never
// leaks to the next transaction on a pooled connection.
export async function tx<T>(pool: pg.Pool, ctx: Ctx, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const [key, value] of Object.entries(ctx)) {
      if (!SETTINGS.includes(key)) throw new Error(`unknown context key ${key}`);
      await client.query('select set_config($1, $2, true)', [`munshi.${key}`, value]);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
