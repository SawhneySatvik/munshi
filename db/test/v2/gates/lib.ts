// Shared by the v2 gates: the merged manifest (the hand-written, independent list every count comes from), the role
// and schema names, and two catalog readers. Never mock the database: the gates read and write a real clone.
import type pg from 'pg';
import { readSchema } from '../../../src/schema-files.ts';

export const SCHEMAS = ['ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'agent_view', 'idp', 'platform'];
export const RUNTIME_ROLES = ['munshi_app', 'munshi_public', 'munshi_jobs', 'munshi_agent', 'munshi_idp', 'munshi_platform'];

export type Manifest = {
  roles: Record<string, { login: boolean; inherit: boolean }>;
  tables: string[];
  globalTables: string[];
  bookTables: Record<string, string[]>;
  views: string[];
  functions: string[];
  executable: Record<string, string[]>;
  indexes: Record<string, string>;
  grants: Record<string, Record<string, string>>;
  appendOnly: string[];
  policies: Record<string, string[]>;
  uuidv7Ids: string[];
};

const EMPTY: Manifest = {
  roles: {},
  tables: [],
  globalTables: [],
  bookTables: {},
  views: [],
  functions: [],
  executable: {},
  indexes: {},
  grants: {},
  appendOnly: [],
  policies: {},
  uuidv7Ids: [],
};
const merged = readSchema().manifest;
const unknownKeys = Object.keys(merged).filter((k) => !(k in EMPTY));
if (unknownKeys.length) throw new Error(`manifest keys no gate reads: ${unknownKeys.join(', ')}`);
export const MANIFEST = { ...EMPTY, ...merged } as Manifest;
export const TENANT_TABLES = MANIFEST.tables.filter((t) => !MANIFEST.globalTables.includes(t));

export type Refusal = { code: string; message: string };

// The error a statement raised; a statement that succeeds fails the test.
export async function refused(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message: string };
    return { code: err.code ?? '', message: err.message };
  }
  throw new Error('expected a refusal, but the statement succeeded');
}

// A manifest grant ("S I U(a,b) D", "S(id,name)") as the catalog spells it: table-level privileges by name,
// column-level ones as PRIV(col), sorted.
export function expectedPrivileges(spec: string | undefined): string[] {
  const names: Record<string, string> = { S: 'SELECT', I: 'INSERT', U: 'UPDATE', D: 'DELETE' };
  const out: string[] = [];
  for (const m of (spec ?? '').matchAll(/([SIUD])(?:\(([^)]*)\))?/g)) {
    const priv = names[m[1] as string] as string;
    if (m[2] === undefined) out.push(priv);
    else for (const col of m[2].split(',')) out.push(`${priv}(${col.trim()})`);
  }
  return out.sort();
}

// What a role holds on a relation, in expectedPrivileges' spelling: table-level privileges, and column-level ones only
// where the table-level one is not held. TRUNCATE, REFERENCES and TRIGGER count too, so a stray one shows up.
export async function privileges(q: pg.Pool | pg.ClientBase, role: string, rel: string): Promise<string[]> {
  const { rows } = await q.query<{ p: string }>(
    `select t.p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as t(p)
      where has_table_privilege($1::name, $2::text, t.p)
     union all
     select t.p || '(' || a.attname || ')'
       from unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as t(p)
       join pg_attribute a on a.attrelid = $2::text::regclass and a.attnum > 0 and not a.attisdropped
      where not has_table_privilege($1::name, $2::text, t.p) and has_column_privilege($1::name, $2::text, a.attname::text, t.p)`,
    [role, rel],
  );
  return rows.map((r) => r.p).sort();
}

// Runs statements as the owner role on one dedicated connection, optionally under a tenant's context, and resets the
// role and settings before the connection goes back to the pool (a session-level SET ROLE must never leak).
export async function asOwner(pool: pg.Pool, sqls: string[], tenant?: string): Promise<pg.QueryResult[]> {
  const c = await pool.connect();
  try {
    await c.query('set role munshi_owner');
    if (tenant) await c.query(`select set_config('munshi.tenant_id', $1, false)`, [tenant]);
    const out: pg.QueryResult[] = [];
    for (const sql of sqls) out.push(await c.query(sql));
    return out;
  } finally {
    await c.query('reset role; reset all');
    c.release();
  }
}

// Plants a fixture row the guards would refuse (an old date, for the purges and the age rules), as the superuser with
// triggers off, in one transaction on its own connection. Only for setting up a past; never for the write under test.
export async function plant(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}
