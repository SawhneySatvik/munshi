// Refuses a hosted deployment whose database logins are wrong, before anything is migrated or served: the app must
// connect as munshi_app (no superuser, no owner, no role powers), the migrator URL must be a different login
// (munshi_migrator, no superuser), and the agent URL, if set, munshi_agent. URLs are never printed: a problem names
// the variable, never its value, and a failed connection reports only the error code.
import pg from 'pg';

type Who = { me: string; super: boolean; bypass: boolean; createrole: boolean; createdb: boolean; owned: number; member_of_owner: boolean };

async function who(url: string): Promise<Who | { error: string }> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await c.connect();
    const { rows } = await c.query<Who>(
      `select r.rolname as me, r.rolsuper as super, r.rolbypassrls as bypass, r.rolcreaterole as createrole, r.rolcreatedb as createdb,
              (select count(*)::int from pg_class k where k.relowner = r.oid) as owned,
              pg_has_role(r.rolname, 'munshi_owner', 'member') as member_of_owner
         from pg_roles r where r.rolname = current_user`,
    );
    return rows[0] as Who;
  } catch (err) {
    return { error: (err as { code?: string }).code ?? 'unreachable' };
  } finally {
    await c.end().catch(() => {});
  }
}

function login(name: string, expected: string, w: Who | { error: string }, problems: string[], isApp: boolean): void {
  if ('error' in w) return void problems.push(`${name}: cannot connect (${w.error})`);
  if (w.me !== expected) problems.push(`${name}: connects as the wrong login, expected ${expected}`);
  if (w.super) problems.push(`${name}: the login is a superuser`);
  if (w.bypass) problems.push(`${name}: the login bypasses row-level security`);
  if (isApp) {
    if (w.createrole || w.createdb) problems.push(`${name}: the login can create roles or databases`);
    if (w.owned > 0) problems.push(`${name}: the login owns database objects`);
    if (w.member_of_owner) problems.push(`${name}: the login is a member of munshi_owner`);
  }
}

export async function deployCheck(env: Record<string, string | undefined>): Promise<string[]> {
  const problems: string[] = [];
  const { DATABASE_URL: app, MIGRATOR_DATABASE_URL: migrator, AGENT_DATABASE_URL: agent } = env;
  if (!app) problems.push('DATABASE_URL is not set');
  if (!migrator) problems.push('MIGRATOR_DATABASE_URL is not set');
  if (!app || !migrator) return problems;
  if (app === migrator) problems.push('DATABASE_URL and MIGRATOR_DATABASE_URL are the same URL: the app must not hold the migrator login');
  login('DATABASE_URL', 'munshi_app', await who(app), problems, true);
  login('MIGRATOR_DATABASE_URL', 'munshi_migrator', await who(migrator), problems, false);
  if (agent) login('AGENT_DATABASE_URL', 'munshi_agent', await who(agent), problems, true);
  return problems;
}
