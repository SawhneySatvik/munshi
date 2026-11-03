// The purge of lapsed real sign-ups (D-080, 09_idp_platform.sql): once a day, globally, as munshi_jobs with no actor.
// ops.purge_pending_signups() frees each expired pending shop's slug, revokes and erases its logins, erases its members
// and blanks its names, and returns every identity left with no live membership. A password identity is idp's, which
// the jobs role never writes: the identity adapter erases it, through the eraser the deploy wires here (as the PayPal
// sweep's adapter is wired). The erase runs inside the slot's transaction, before it commits: if it fails the purge
// rolls back and the next day's run finds the same identities again; once committed their logins are erased and the
// purge could never name them again. With identities to erase and no eraser wired, the slot fails and purges nothing.
// Like the other jobs files it imports only jobs-core.ts (gate J1).
import pg from 'pg';
import { type Job, type Removed, registerJob } from './jobs-core.ts';

export type IdentityEraser = (subject: string) => Promise<void>;

let eraser: IdentityEraser | null = null;

/** The deploy's identity eraser (the password adapter's erase); null unwires it. */
export function wireIdentityEraser(erase: IdentityEraser | null): void {
  eraser = erase;
}

/** idp's own pool for the eraser (IDP_DATABASE_URL, role munshi_idp): the web app names no driver outside lib/server/db. */
export function createIdpPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 1, application_name: 'munshi_idp_purge' });
}

export async function purgeSignups(c: pg.PoolClient): Promise<Removed> {
  const { rows } = await c.query<{ provider: string; subject: string }>('select provider, subject from ops.purge_pending_signups()');
  const passwords = rows.filter((r) => r.provider === 'password').map((r) => r.subject);
  const erase = eraser;
  if (passwords.length && !erase) throw new Error('jobs: lapsed sign-ups hold password identities and no identity eraser is wired');
  for (const subject of passwords) await (erase as IdentityEraser)(subject);
  return rows.length ? { signup_identities: rows.length } : {};
}

export const SIGNUP_JOBS: Job[] = [registerJob('signups', { every: 'day', perTenant: false, run: purgeSignups })];
