// Wipes Munshi out of a hosted Supabase database so it can be rebuilt from scratch on the same project: the ten Munshi
// schemas (the deployment row with them), anything else the owner role owns (a stray function in public, its default
// privileges, its CREATE on the database and USAGE on `extensions`), then the eight munshi_* roles. Run as the project's
// admin (`postgres.<ref>` on the session pooler), the login db/src/supabase-roles.ts uses, which then puts the roles
// back. Supabase's own schemas (auth, storage, realtime and the rest), its extensions and anything another role owns
// are never touched: the drop is by owner, and the wipe refuses if a Munshi role owns anything in one of those schemas.
// Refuses a live deployment, as db/src/build.ts does. Prints names and counts, never a URL or password.
//
//   node db/src/hosted-wipe.ts --env=<.env with the project's settings> --confirm=<project ref> [--dry-run] [--keep-roles]
//
// --dry-run prints what would go and changes nothing. --keep-roles drops the objects but keeps the roles (for an admin
// that may not drop them); supabase-roles then checks the kept roles and rotates their passwords.
// Everything runs in one transaction: a refusal or a failed drop leaves the database as it was.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { applyDatabaseTls, databaseTls } from '@munshi/core';
import pg from 'pg';
import { MUNSHI_SCHEMAS } from './build.ts';

export const MUNSHI_ROLES = ['munshi_owner', 'munshi_migrator', 'munshi_app', 'munshi_public', 'munshi_jobs', 'munshi_agent', 'munshi_idp', 'munshi_platform'];

/** Schemas that belong to Supabase (or to PostgreSQL itself): a Munshi role owning anything here stops the wipe. */
export const PROTECTED_SCHEMAS = [
  'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks',
  'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgbouncer', '_analytics', 'pg_catalog', 'information_schema',
];

export type WipePlan = {
  live: boolean;
  roles: string[];
  schemas: string[];
  /** Objects a Munshi role owns outside the Munshi schemas, as `<type> <identity>`. */
  elsewhere: string[];
  /** The same, inside a protected schema: any one refuses the wipe. */
  protectedHits: string[];
};

/** The project ref from the admin's pooler URL (user `postgres.<ref>`), or a refusal. */
export function adminRef(url: string): string {
  const [user, ref] = decodeURIComponent(new URL(url).username).split('.');
  if (user !== 'postgres' || !ref) throw new Error('hosted-wipe: SESSION_POOL_CONNECTION_STRING must log in as postgres.<ref>');
  return ref;
}

export function parseWipeArgs(args: readonly string[]): { env: string; confirm: string; dryRun: boolean; keepRoles: boolean } {
  let env = '';
  let confirm = '';
  let dryRun = false;
  let keepRoles = false;
  for (const a of args) {
    if (a.startsWith('--env=')) env = a.slice(6);
    else if (a.startsWith('--confirm=')) confirm = a.slice(10);
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--keep-roles') keepRoles = true;
    else throw new Error(`hosted-wipe: unknown argument ${a.split('=')[0]}`);
  }
  if (!env || !confirm) throw new Error('hosted-wipe: --env=<file> and --confirm=<project ref> are required');
  return { env, confirm, dryRun, keepRoles };
}

async function readPlan(admin: pg.ClientBase): Promise<WipePlan> {
  const roles = (await admin.query<{ r: string }>('select rolname as r from pg_roles where rolname = any($1) order by 1', [MUNSHI_ROLES])).rows.map((x) => x.r);
  const schemas = (
    await admin.query<{ s: string }>('select nspname as s from pg_namespace where nspname = any($1) order by 1', [MUNSHI_SCHEMAS])
  ).rows.map((x) => x.s);
  // Every object a Munshi role owns in this database, by its owner dependency, outside the Munshi schemas.
  const owned = await admin.query<{ type: string; schema: string | null; identity: string }>(
    `select o.type, o.schema, o.identity
       from pg_shdepend d
       join pg_roles r on r.oid = d.refobjid and r.rolname = any($1)
       cross join lateral pg_identify_object(d.classid, d.objid, d.objsubid) o
      where d.deptype = 'o' and d.dbid = (select oid from pg_database where datname = current_database())
        and not (coalesce(o.schema, '') = any($2))
        and not (o.type = 'schema' and o.identity = any($2))
      order by 1, 3`,
    [MUNSHI_ROLES, MUNSHI_SCHEMAS],
  );
  const elsewhere = owned.rows.map((o) => `${o.type} ${o.identity}`);
  const protectedHits = owned.rows
    .filter((o) => PROTECTED_SCHEMAS.includes(o.schema ?? '') || (o.type === 'schema' && PROTECTED_SCHEMAS.includes(o.identity)))
    .map((o) => `${o.type} ${o.identity}`);
  // Read as the owner, which owns ops: an admin that cannot SET ROLE to it fails here, before anything is dropped.
  let live = false;
  if (roles.includes('munshi_owner') && schemas.includes('ops')) {
    await admin.query('set local role munshi_owner');
    if ((await admin.query<{ t: string | null }>("select to_regclass('ops.deployment')::text as t")).rows[0]?.t) {
      live = (await admin.query("select 1 from ops.deployment where kind = 'live'")).rowCount !== 0;
    }
    await admin.query('reset role');
  }
  return { live, roles, schemas, elsewhere, protectedHits };
}

/**
 * Reads the plan and, unless dryRun, drops it, all in one transaction on the admin's connection. Throws (rolling back)
 * on a live deployment or on a Munshi-owned object in a protected schema.
 */
export async function hostedWipe(admin: pg.Client, { dryRun = false, keepRoles = false } = {}): Promise<WipePlan> {
  await admin.query('begin');
  try {
    const plan = await readPlan(admin);
    if (plan.live) throw new Error("hosted-wipe: refusing a live deployment (ops.deployment.kind = 'live')");
    if (plan.protectedHits.length) throw new Error(`hosted-wipe: refusing: a Munshi role owns ${plan.protectedHits.join(', ')} in a Supabase schema`);
    if (!dryRun && plan.roles.includes('munshi_owner')) {
      await admin.query('set local role munshi_owner');
      // The same drop as the build's, then whatever else the owner holds (no cascade: anything of another role's that
      // depends on it stops the wipe instead of going with it).
      if (plan.schemas.length) await admin.query(`drop schema if exists ${plan.schemas.join(', ')} cascade`);
      await admin.query('drop owned by munshi_owner');
      await admin.query('reset role');
    }
    if (!dryRun && plan.roles.length) {
      // The two grants the bootstrap made as the admin (CREATE on the database, USAGE on `extensions`): only their
      // grantor may revoke them, so the owner's own drop above leaves them.
      const roles = plan.roles.join(', ');
      const db = (await admin.query<{ d: string }>('select current_database() as d')).rows[0]?.d as string;
      await admin.query(`revoke all on database ${admin.escapeIdentifier(db)} from ${roles}`);
      if ((await admin.query(`select 1 from pg_namespace where nspname = 'extensions'`)).rowCount) await admin.query(`revoke all on schema extensions from ${roles}`);
    }
    if (!dryRun && !keepRoles) for (const role of [...plan.roles].reverse()) await admin.query(`drop role ${role}`);
    await admin.query(dryRun ? 'rollback' : 'commit');
    return plan;
  } catch (err) {
    await admin.query('rollback');
    // PostgreSQL names what blocked a drop in the detail, not the message.
    const detail = (err as { detail?: string }).detail;
    if (detail && err instanceof Error) err.message = `${err.message}: ${detail.replaceAll('\n', '; ')}`;
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { env, confirm, dryRun, keepRoles } = parseWipeArgs(process.argv.slice(2));
  const source = parseEnv(readFileSync(env, 'utf8'));
  const url = source.SESSION_POOL_CONNECTION_STRING ?? '';
  const ref = adminRef(url);
  if (confirm !== ref) throw new Error('hosted-wipe: --confirm must equal the project ref in the session pooler URL');
  if (new URL(url).port !== '5432') throw new Error('hosted-wipe: expected the session pooler on 5432');
  applyDatabaseTls(databaseTls(Buffer.from(readFileSync(new URL('../../deploy/supabase-root-2021.crt', import.meta.url), 'utf8')).toString('base64')));
  const admin = new pg.Client({ connectionString: url, application_name: 'munshi_hosted_wipe' });
  await admin.connect();
  try {
    const plan = await hostedWipe(admin, { dryRun, keepRoles });
    const verb = dryRun ? 'would drop' : 'dropped';
    console.log(`hosted-wipe: project ${ref}: ${verb} schemas ${plan.schemas.join(', ') || '(none)'}`);
    for (const o of plan.elsewhere) console.log(`hosted-wipe: ${verb} ${o}`);
    console.log(`hosted-wipe: ${keepRoles ? 'kept' : verb} roles ${plan.roles.join(', ') || '(none)'}`);
    if (dryRun) console.log('hosted-wipe: dry run, nothing changed');
  } finally {
    await admin.end();
  }
}
