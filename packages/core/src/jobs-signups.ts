// The purge of lapsed real sign-ups (D-080, 09_idp_platform.sql): once a day, globally, as munshi_jobs with no actor.
// ops.purge_pending_signups() frees each expired pending shop's slug, revokes and erases its logins, erases its members
// and blanks its names, and returns every identity left with no live membership. A password identity is idp's, which
// the jobs role never writes: the identity adapter erases it, through the eraser the deploy wires here (as the PayPal
// sweep's adapter is wired). The purge commits first (the slot's checkpoint), then each identity is erased in its own
// commit on idp's pool, idempotently, and only if nothing holds it on the committed rows: no shop's live login bound to
// it (another shop, or a sign-up of the same email a moment ago) and not an operator's (the adapter's eraseUnbound,
// under the lock a login's binding takes). The jobs role reads no operator flag, so that check is the adapter's.
// Not retried: an erase that fails after the purge committed leaves that identity unerased (holding no shop), since
// the purge erased the logins that named it; the slot reports failed. With identities to erase and no eraser wired, the
// slot fails before the purge commits, and purges nothing. Like the other jobs files it imports only jobs-core.ts (J1).
import pg from 'pg';
import { type Job, type Removed, registerJob } from './jobs-core.ts';

/** Erases an identity nothing holds; true when it erased, false when it left it (bound, or an operator's). */
export type IdentityEraser = (subject: string) => Promise<boolean>;

let eraser: IdentityEraser | null = null;

/** The deploy's identity eraser (the password adapter's erase); null unwires it. */
export function wireIdentityEraser(erase: IdentityEraser | null): void {
  eraser = erase;
}

/** idp's own pool for the eraser (IDP_DATABASE_URL, role munshi_idp): the web app names no driver outside lib/server/db. */
export function createIdpPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 1, application_name: 'munshi_idp_purge' });
}

export async function purgeSignups(c: pg.PoolClient, checkpoint: () => Promise<void>): Promise<Removed> {
  const { rows } = await c.query<{ provider: string; subject: string }>('select provider, subject from ops.purge_pending_signups()');
  const passwords = rows.filter((r) => r.provider === 'password').map((r) => r.subject);
  const erase = eraser;
  if (passwords.length && !erase) throw new Error('jobs: lapsed sign-ups hold password identities and no identity eraser is wired');
  if (!passwords.length) return {};
  // The purge's revocations commit before any erase reads them: the adapter re-checks on committed rows.
  await checkpoint();
  let erased = 0;
  for (const subject of passwords) if (await (erase as IdentityEraser)(subject)) erased++;
  return { signup_identities: erased, signup_identities_kept: passwords.length - erased };
}

export const SIGNUP_JOBS: Job[] = [registerJob('signups', { every: 'day', perTenant: false, run: purgeSignups })];
