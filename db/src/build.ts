// pnpm db:build — rebuilds the Munshi schemas from db/schema (no migrations while building, D-043): refuses a live
// deployment, drops the ten schemas, applies 01–90 in name order, each file in one transaction, then records the build
// in ops.schema_version (and ops.deployment, when given one) if the files made those tables.
//
// Runs as munshi_migrator. Each file starts with its own `set local role munshi_owner`; the runner never switches role
// for a file, so a file that needs more than the owner fails here as it would on the hosted database (BUILD-SUPERUSER).
// The runner's own steps (the live check, the drop, the record) run as munshi_owner, which owns every schema; the
// migrator holds nothing directly (NOINHERIT).
import { fileURLToPath } from 'node:url';
import { databaseTls, applyDatabaseTls } from '@munshi/core';
import pg from 'pg';
import { applyFile, readSchema, SCHEMA_DIR } from './schema-files.ts';

export const MUNSHI_SCHEMAS = ['ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'agent_view', 'idp', 'platform'];

export type Deployment = { kind: 'demo' | 'live'; hosted: boolean };
export type Built = { files: string[]; sha256: string };

async function asOwner(client: pg.Client, fn: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await client.query('set local role munshi_owner');
    await fn();
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

const exists = async (client: pg.Client, table: string) =>
  (await client.query<{ t: string | null }>('select to_regclass($1) as t', [table])).rows[0]?.t != null;

export async function build(client: pg.Client, { dir = SCHEMA_DIR, deployment }: { dir?: string; deployment?: Deployment } = {}): Promise<Built> {
  const schema = readSchema(dir);
  await asOwner(client, async () => {
    // Before the drop, in its transaction. A deployment table the owner cannot read throws: the check fails closed.
    if (await exists(client, 'ops.deployment')) {
      const { rows } = await client.query<{ kind: string }>('select kind from ops.deployment');
      const live = rows.some((r) => r.kind === 'live');
      if (live) throw new Error("build: refusing a live deployment (ops.deployment.kind = 'live'): live is built once, then only migrated");
    }
    await client.query(`drop schema if exists ${MUNSHI_SCHEMAS.join(', ')} cascade`);
  });
  for (const file of schema.files) await applyFile(client, file);
  await asOwner(client, async () => {
    if (await exists(client, 'ops.schema_version')) {
      await client.query("insert into ops.schema_version (one, source, sha256) values (true, 'schema', $1)", [Buffer.from(schema.sha256, 'hex')]);
    }
    if (deployment && (await exists(client, 'ops.deployment'))) {
      await client.query('insert into ops.deployment (one, kind, hosted) values (true, $1, $2)', [deployment.kind, deployment.hosted]);
    }
  });
  return { files: schema.files.map((f) => f.name), sha256: schema.sha256 };
}

/**
 * The CLI's arguments: none (no ops.deployment row; absent counts as demo, BLUEPRINT §1.3), or `--deployment demo|live`
 * in either spelling (`--deployment=demo` too), which records a hosted deployment row after the build. Anything else is
 * refused, so a mistyped flag never silently builds without its row (Munim gotcha 17).
 */
export function parseBuildArgs(args: readonly string[]): { deployment?: Deployment } {
  if (args.length === 0) return {};
  const value = args.length === 1 && args[0]?.startsWith('--deployment=') ? args[0].slice('--deployment='.length)
    : args.length === 2 && args[0] === '--deployment' ? args[1] : undefined;
  if (value !== 'demo' && value !== 'live') throw new Error(`build takes only --deployment demo|live, not ${args.join(' ')}`);
  return { deployment: { kind: value, hosted: true } };
}

// CLI: MIGRATOR_DATABASE_URL (munshi_migrator; on Supabase the session pooler) from the environment, never printed.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root (deploy/supabase.md)
  const { deployment } = parseBuildArgs(process.argv.slice(2));
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error('MIGRATOR_DATABASE_URL (munshi_migrator) is not set');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const built = await build(client, deployment ? { deployment } : {});
    console.log(`build: applied ${built.files.length} schema file(s), sha256 ${built.sha256.slice(0, 12)}${deployment ? `, deployment ${deployment.kind} (hosted)` : ''}`);
  } finally {
    await client.end();
  }
}
