// The deploy check (BLUEPRINT §2.2, §1.3; deploy/supabase.md): run from the operator's machine against a hosted database
// before the app is deployed, with the same variables the deploy will carry plus MIGRATOR_DATABASE_URL. It refuses:
//   - a missing URL, or two variables naming the same URL or the same password;
//   - a URL whose login is not its role (each pool's own, the migrator's), or a login that is a superuser, bypasses
//     RLS, creates roles or databases, owns objects, or (except the migrator) is a member of munshi_owner;
//   - MUNSHI_DEPLOYMENT unset, or not the database's ops.deployment row; no row, or `hosted = false` (a laptop database);
//     a live database not built from migrations (BOOT1); a database not built from the checked-out db/schema;
//   - a demo deployment that names a channel credential (WhatsApp or Instagram settings);
//   - (SUPA1) anon, authenticated, service_role, or any other BYPASSRLS role that is not the admin, holding USAGE on a
//     Munshi schema or any privilege on a Munshi table; the Data API configured to expose a Munshi schema; a Munshi object
//     in schema public.
// It prints the large-object residual (agent_large_objects=possible|none) as a note, never as a refusal.
//
// Nothing here prints a URL, a password or a server's message: a problem names variables, roles and schemas only, and a
// failed connection reports only its error code (pg's messages can carry the host and the user).
import pg from 'pg';
import { channelCredentials, POOL_URL } from '../../packages/config/src/index.ts';
import { MUNSHI_SCHEMAS } from './build.ts';
import { readSchema } from './schema-files.ts';

/** Every URL the check needs, and the role it must log in as. */
export const LOGINS: Record<string, string> = {
  [POOL_URL.app]: 'munshi_app',
  [POOL_URL.jobs]: 'munshi_jobs',
  [POOL_URL.agent]: 'munshi_agent',
  [POOL_URL.platform]: 'munshi_platform',
  [POOL_URL.public]: 'munshi_public',
  [POOL_URL.idp]: 'munshi_idp',
  MIGRATOR_DATABASE_URL: 'munshi_migrator',
};

// Supabase's own API roles (FACT, https://supabase.com/docs/guides/database/postgres/roles), checked by name whatever
// their attributes; any other BYPASSRLS role is checked too.
const API_ROLES = ['anon', 'authenticated', 'service_role'];

export type DeployCheck = { problems: string[]; notes: string[] };

type Who = { me: string; super: boolean; bypass: boolean; createrole: boolean; createdb: boolean; owned: number; member_of_owner: boolean };

const errorCode = (err: unknown): string => {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unreachable';
};

async function connect(url: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000, application_name: 'munshi_deploy_check' });
  c.on('error', () => {});
  try {
    await c.connect();
    return c;
  } catch (err) {
    await c.end().catch(() => {});
    throw err;
  }
}

async function who(c: pg.Client): Promise<Who> {
  const { rows } = await c.query<Who>(
    `select r.rolname as me, r.rolsuper as super, r.rolbypassrls as bypass, r.rolcreaterole as createrole, r.rolcreatedb as createdb,
            (select count(*)::int from pg_class k where k.relowner = r.oid) +
            (select count(*)::int from pg_namespace n where n.nspowner = r.oid) as owned,
            exists (select 1 from pg_roles o where o.rolname = 'munshi_owner') and pg_has_role(r.oid, 'munshi_owner', 'MEMBER') as member_of_owner
       from pg_roles r where r.rolname = current_user`,
  );
  return rows[0] as Who;
}

function judgeLogin(name: string, w: Who, problems: string[]): void {
  const expected = LOGINS[name];
  if (w.me !== expected) problems.push(`${name}: connects as the wrong login, expected ${expected}`);
  if (w.super) problems.push(`${name}: the login is a superuser`);
  if (w.bypass) problems.push(`${name}: the login bypasses row-level security`);
  if (w.createrole || w.createdb) problems.push(`${name}: the login can create roles or databases`);
  if (w.owned > 0) problems.push(`${name}: the login owns database objects`);
  if (name !== 'MIGRATOR_DATABASE_URL' && w.member_of_owner) problems.push(`${name}: the login is a member of munshi_owner`);
}

const password = (url: string): string => {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return '';
  }
};

// The app's connection reads the build (only the app, public and jobs roles may read these two tables).
async function judgeBuild(app: pg.Client, env: Record<string, string | undefined>, schemaSha: string, problems: string[]): Promise<void> {
  let found: { kind: string | null; hosted: boolean | null; source: string | null; sha: string | null; rows: number };
  try {
    const { rows } = await app.query<typeof found>(
      `select (select kind from ops.deployment) as kind, (select hosted from ops.deployment) as hosted, (select count(*)::int from ops.deployment) as rows,
              (select source from ops.schema_version) as source, (select encode(sha256, 'hex') from ops.schema_version) as sha`,
    );
    found = rows[0] as typeof found;
  } catch (err) {
    problems.push(`DATABASE_URL: cannot read ops.deployment or ops.schema_version (${errorCode(err)}): the database is not built from db/schema`);
    return;
  }
  if (found.rows === 0) problems.push('ops.deployment has no row: a hosted database names its deployment before any tenant (deploy/supabase.md)');
  else {
    if (found.kind !== env.MUNSHI_DEPLOYMENT) problems.push(`MUNSHI_DEPLOYMENT is not the database's ops.deployment (${found.kind})`);
    if (found.hosted === false) problems.push('ops.deployment says hosted = false: a laptop database, never served by a hosted app');
  }
  if (found.kind === 'live' && found.source !== 'migrations') problems.push('ops.deployment is live but ops.schema_version.source is not migrations (BOOT1)');
  if (found.sha !== schemaSha) problems.push('ops.schema_version is not the checked-out db/schema: build the database from this commit');
}

// SUPA1, on the migrator's connection: the catalog is readable by any login, and has_*_privilege takes any role.
async function judgeSupabase(m: pg.Client, problems: string[], notes: string[]): Promise<void> {
  const { rows: reach } = await m.query<{ role: string; what: string }>(
    `with candidates as (
       select r.oid, r.rolname from pg_roles r
        where (r.rolname = any($1::text[]) or r.rolbypassrls)
          and not r.rolsuper and r.rolname not like 'munshi\\_%' and r.rolname not like 'pg\\_%'
          and not exists (select 1 from pg_auth_members a join pg_roles o on o.oid = a.roleid
                           where o.rolname = 'munshi_owner' and a.member = r.oid)),
     schemas as (select nspname from pg_namespace where nspname = any($2::text[]))
     select c.rolname as role, 'USAGE on schema ' || s.nspname as what
       from candidates c cross join schemas s where has_schema_privilege(c.oid, s.nspname, 'USAGE')
     union all
     select c.rolname, 'a privilege on ' || n.nspname || '.' || k.relname
       from candidates c cross join pg_class k join pg_namespace n on n.oid = k.relnamespace
      where n.nspname = any($2::text[]) and k.relkind in ('r', 'v', 'm', 'p', 'f')
        and has_table_privilege(c.oid, k.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     order by 1, 2`,
    [API_ROLES, MUNSHI_SCHEMAS],
  );
  for (const r of reach) problems.push(`role ${r.role} holds ${r.what}`);

  // PostgREST's in-database configuration (pgrst.db_schemas on the authenticator role, for every database or this one).
  const { rows: api } = await m.query<{ schemas: string }>(
    `select split_part(c, '=', 2) as schemas
       from pg_db_role_setting s join pg_roles r on r.oid = s.setrole cross join unnest(s.setconfig) c
      where r.rolname = 'authenticator' and s.setdatabase in (0, (select oid from pg_database where datname = current_database()))
        and c like 'pgrst.db\\_schemas=%'`,
  );
  const exposed = api.flatMap((a) => a.schemas.split(',').map((x) => x.trim().replace(/^"|"$/g, ''))).filter((x) => MUNSHI_SCHEMAS.includes(x));
  if (exposed.length) problems.push(`the Data API exposes ${[...new Set(exposed)].join(', ')} (pgrst.db_schemas on authenticator)`);

  const { rows: pub } = await m.query<{ n: number }>(
    `select (select count(*)::int from pg_class k join pg_roles o on o.oid = k.relowner where k.relnamespace = 'public'::regnamespace and o.rolname like 'munshi\\_%') +
            (select count(*)::int from pg_proc p join pg_roles o on o.oid = p.proowner where p.pronamespace = 'public'::regnamespace and o.rolname like 'munshi\\_%') as n`,
  );
  if ((pub[0]?.n ?? 0) > 0) problems.push('schema public holds a Munshi object');

  const { rows: lo } = await m.query<{ possible: boolean }>(
    `select exists (select 1 from pg_proc p where p.pronamespace = 'pg_catalog'::regnamespace
                     and (p.proname like 'lo\\_%' or p.proname in ('loread', 'lowrite'))
                     and has_function_privilege('munshi_agent', p.oid, 'EXECUTE')) as possible`,
  );
  notes.push(`agent_large_objects=${lo[0]?.possible ? 'possible' : 'none'}`);
}

export async function deployCheck(env: Record<string, string | undefined>, { schemaSha = readSchema().sha256 } = {}): Promise<DeployCheck> {
  const problems: string[] = [];
  const notes: string[] = [];
  const names = Object.keys(LOGINS);
  for (const name of names) if (!env[name]) problems.push(`${name} is not set`);
  if (env.MUNSHI_DEPLOYMENT !== 'demo' && env.MUNSHI_DEPLOYMENT !== 'live') problems.push('MUNSHI_DEPLOYMENT is not demo or live');
  const channels = channelCredentials(env);
  if (env.MUNSHI_DEPLOYMENT === 'demo' && channels.length) problems.push(`a demo deployment names no channel credential, but these are set: ${channels.join(', ')}`);
  const given = names.filter((name) => env[name]);
  for (let i = 0; i < given.length; i++) {
    for (let j = i + 1; j < given.length; j++) {
      const [a, b] = [given[i] as string, given[j] as string];
      if (env[a] === env[b]) problems.push(`${a} and ${b} are the same URL: each role has its own login`);
      else if (password(env[a] as string) !== '' && password(env[a] as string) === password(env[b] as string)) problems.push(`${a} and ${b} share a password`);
    }
  }
  if (given.length < names.length) return { problems, notes };

  const clients = new Map<string, pg.Client>();
  const before = problems.length;
  try {
    for (const name of names) {
      try {
        const c = await connect(env[name] as string);
        clients.set(name, c);
        judgeLogin(name, await who(c), problems);
      } catch (err) {
        problems.push(`${name}: cannot connect (${errorCode(err)})`);
      }
    }
    if (problems.length > before) return { problems, notes }; // a wrong login is not asked anything more
    await judgeBuild(clients.get(POOL_URL.app) as pg.Client, env, schemaSha, problems);
    await judgeSupabase(clients.get('MIGRATOR_DATABASE_URL') as pg.Client, problems, notes);
  } catch (err) {
    problems.push(`the check could not finish (${errorCode(err)})`);
  } finally {
    await Promise.all([...clients.values()].map((c) => c.end().catch(() => {})));
  }
  return { problems, notes };
}
