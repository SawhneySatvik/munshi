// The purge of lapsed real sign-ups (09_idp_platform.sql): once a day, globally, as munshi_jobs with no actor.
// ops.purge_pending_signups() frees each expired pending shop's slug, revokes and erases its logins, erases its members
// and blanks its names, and returns every identity left with no live membership. A password identity is idp's, which
// the jobs role never writes: the identity adapter erases it, through the eraser the deploy wires here (as the PayPal
// sweep's adapter is wired). The purge queues each password identity it frees in ops.identity_erase (never an
// operator's) and commits first (the slot's checkpoint); then every queued identity, this run's and any an earlier run
// failed to erase, is erased in its own commit on idp's pool, idempotently, and only if nothing holds it on the
// committed rows: no shop's live login bound to it (another shop, or a sign-up of the same email a moment ago) and not
// an operator's (the adapter's eraseUnbound, under the lock a login's binding takes). The adapter deletes the queue row
// in that same commit, whether it erased or left the identity, so an erase that fails stays queued and the next run
// retries it. One identity's failure does not stop the rest: each is tried, then the slot reports failed if any threw.
// The purge commits even when no eraser is wired (a lapsed shop is always purged); the slot then fails, and the queue
// keeps every identity for a run that has one. Like the other jobs files it imports only jobs-core.ts
// (db/test/v2/core/jobs/role.test.ts).
import pg from 'pg';
import { type Job, type Removed, registerJob } from './jobs-core.ts';

/** Erases an identity nothing holds, and takes it off ops.identity_erase; true when it erased, false when it left it
 * (bound, or an operator's). */
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
  await c.query('select count(*) from ops.purge_pending_signups()');
  const { rows } = await c.query<{ subject: string }>("select subject from ops.identity_erase where provider = 'password' order by queued_at, subject");
  const passwords = rows.map((r) => r.subject);
  if (!passwords.length) return {};
  // The purge's revocations commit before any erase reads them: the adapter re-checks on committed rows.
  await checkpoint();
  const erase = eraser;
  if (!erase) throw new Error('jobs: lapsed sign-ups hold password identities and no identity eraser is wired');
  let erased = 0;
  let failed = 0;
  for (const subject of passwords) {
    try {
      if (await erase(subject)) erased++;
    } catch {
      failed++; // stays queued; the next run retries it
    }
  }
  if (failed) throw new Error(`jobs: ${failed} of ${passwords.length} queued identities were not erased; they stay queued`);
  return { signup_identities: erased, signup_identities_kept: passwords.length - erased };
}

export const SIGNUP_JOBS: Job[] = [registerJob('signups', { every: 'day', perTenant: false, run: purgeSignups })];
