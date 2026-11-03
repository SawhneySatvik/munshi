// The password identity (BLUEPRINT §6.2, 09_idp_platform.sql). Hashes and salts live in idp.identity, which only
// munshi_idp reads, through the pool this module is given; the email is kept only as its HMAC under
// MUNSHI_IDENTITY_SECRET; failures are counted per (email HMAC, IP hash) in idp.attempt, so nobody can lock an owner out
// from another network. scrypt runs on every attempt, against the stored hash or a dummy, locked or not, so a wrong
// password, an unknown email and a locked pair take one path and return one null (review N2). Every error leaves as one
// fixed message: a database error's DETAIL can print a row, and no password or hash may reach a log.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Identity, IdentityPort, InviteProof, RequestCtx, SignInInput, UsedReset } from './index.ts';

export type ScryptParams = { N: number; r: number; p: number; keylen: number };
// §6.2's parameters, stored on each row so they can be raised later. Measured on the build laptop (29 Oct, node 22):
// 248 ms a hash at N = 2^17 (29 ms at 2^14, 503 ms at 2^18), so N stays at 2^17.
export const SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };

type Result = { rows: unknown[]; rowCount: number | null };
type Queryable = { query(text: string, values?: unknown[]): Promise<Result> };
export type IdpClient = Queryable & { release(destroy?: boolean): void };
// munshi_idp's pool; a pg.Pool fits. The adapter package holds no driver of its own.
export type IdpPool = Queryable & { connect(): Promise<IdpClient> };

// The same folding as `pnpm platform:operator`'s seed, so a seeded operator signs in here.
export const foldEmail = (email: string) => email.normalize('NFKC').toLowerCase().trim();
export const emailHmac = (email: string, secret: string) => createHmac('sha256', secret).update(foldEmail(email)).digest();

// 10 to 128 characters, and none of `avoid` (the email, the shop's name), folded as the email is.
export function passwordAllowed(password: string, avoid: string[]): boolean {
  return password.length >= 10 && password.length <= 128 && avoid.every((a) => foldEmail(a) !== foldEmail(password));
}

export const derive = (password: string, salt: Buffer, p: ScryptParams) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, p.keylen, { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r }, (err, key) => (err ? reject(err) : resolve(key))),
  );

const fail = () => new Error('identity: the identity store refused the request or is unreachable');

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    throw fail();
  }
}

type Stored = { subject: string; password_hash: Buffer; salt: Buffer; params: ScryptParams };
type State = { id: Stored | null; locked: boolean; recent: number };

// The identity (if any) and the pair's lock, read in one statement; `recent` is the email's failures from any IP in the
// last hour, which ask for the bot check once there are three.
const STATE = `select i.subject::text as subject, i.password_hash, i.salt, i.params,
                      coalesce((select a.locked_until > now() from idp.attempt a where a.email_hmac = $1 and a.ip_hash = $2), false) as locked,
                      (select coalesce(sum(a.failures), 0)::int from idp.attempt a where a.email_hmac = $1 and a.last_at > now() - interval '1 hour') as recent
                 from (select 1) one left join idp.identity i on i.email_hmac = $1 and i.erased_at is null`;

// A failure counts against the pair; every fifth locks it, for 15 minutes doubling up to a day. A success clears a pair
// that has failures, and writes nothing otherwise.
const FAILED = `insert into idp.attempt as a (email_hmac, ip_hash, failures, last_at) values ($1, $2, 1, now())
                on conflict (email_hmac, ip_hash) do update
                  set failures = a.failures + 1, last_at = now(),
                      locked_until = case when (a.failures + 1) % 5 = 0
                                          then now() + least(interval '15 minutes' * power(2, (a.failures + 1) / 5 - 1), interval '1 day')
                                          else a.locked_until end`;
const CLEARED = `update idp.attempt set failures = 0, locked_until = null, last_at = now()
                  where email_hmac = $1 and ip_hash = $2 and (failures > 0 or locked_until is not null)`;

export function passwordIdentity(opts: { pool: IdpPool; identitySecret: string; params?: ScryptParams }): IdentityPort {
  const { pool, identitySecret } = opts;
  const params = opts.params ?? SCRYPT;
  const dummySalt = randomBytes(16);
  const dummyHash = randomBytes(params.keylen);

  const state = async (mac: Buffer, ctx: RequestCtx): Promise<State> => {
    if (ctx.ipHash.length !== 32) throw fail();
    const r = (await pool.query(STATE, [mac, ctx.ipHash])).rows[0] as Stored & { subject: string | null; locked: boolean; recent: number };
    return { id: r.subject ? r : null, locked: r.locked, recent: r.recent };
  };
  const open = (s: State, ctx: RequestCtx) => !s.locked && (s.recent < 3 || ctx.botCheck);
  // scrypt against the stored hash, or the dummy for an unknown email: the same work either way.
  const matches = async (password: string, s: State) => {
    const key = await derive(password, s.id?.salt ?? dummySalt, s.id?.params ?? params);
    const stored = s.id?.password_hash ?? dummyHash;
    return key.length === stored.length && timingSafeEqual(key, stored) && s.id !== null;
  };
  const settle = (mac: Buffer, ctx: RequestCtx, ok: boolean) => pool.query(ok ? CLEARED : FAILED, [mac, ctx.ipHash]);
  const identity = (subject: string): Identity => ({ provider: 'password', subject });

  // An invite's or a real shop's sign-up: a new email makes the identity, stamped with how its email was vouched for
  // (09: 'invite', or 'email' for a claim Supabase Auth verified); an existing one is returned only with its right
  // password. Either way after the same work, and null for every failure. `avoid`: what a new password may not be.
  const enrol = (input: SignInInput, avoid: string[], ctx: RequestCtx, via: 'invite' | 'email') =>
    guarded(async () => {
        const mac = emailHmac(input.email, identitySecret);
        const s = await state(mac, ctx);
        const allowed = passwordAllowed(input.password, [input.email, ...avoid]);
        if (s.id || !allowed || !open(s, ctx)) {
          const ok = (await matches(input.password, s)) && allowed && open(s, ctx);
          await settle(mac, ctx, ok);
          return ok && s.id ? { identity: identity(s.id.subject), created: false } : null;
        }
        const salt = randomBytes(16);
        const hash = await derive(input.password, salt, params);
        const made = await pool.query(
          `insert into idp.identity (email_hmac, password_hash, salt, params, verified_at, verified_via) values ($1, $2, $3, $4, now(), $5)
           on conflict (email_hmac) do nothing returning subject::text as subject`,
          [mac, hash, salt, JSON.stringify(params), via],
        );
        const subject = (made.rows[0] as { subject: string } | undefined)?.subject;
        await settle(mac, ctx, subject !== undefined);
        return subject ? { identity: identity(subject), created: true } : null;
    });

  return {
    signIn: (input: SignInInput, ctx: RequestCtx) =>
      guarded(async () => {
        const mac = emailHmac(input.email, identitySecret);
        const s = await state(mac, ctx);
        const ok = (await matches(input.password, s)) && open(s, ctx);
        await settle(mac, ctx, ok);
        return ok && s.id ? identity(s.id.subject) : null;
      }),

    acceptInvite: async (invite: InviteProof, input: SignInInput, ctx: RequestCtx) => (await enrol(input, [invite.shopName], ctx, 'invite'))?.identity ?? null,

    signUpOwner: (input: SignInInput & { avoid: string[] }, ctx: RequestCtx, via: 'invite' | 'email') =>
      enrol({ email: input.email, password: input.password }, input.avoid, ctx, via),

    setPasswordFromReset: (grant: UsedReset, password: string, shopName: string) =>
      guarded(async () => {
        if (!passwordAllowed(password, [shopName])) return false;
        const salt = randomBytes(16);
        const hash = await derive(password, salt, params);
        const c = await pool.connect();
        let broken = false;
        try {
          await c.query('begin');
          // idp.reset_use's guard reads the grant under its tenant's context: used on the reset link in the last 5
          // minutes, for this identity; its primary key makes it once.
          await c.query(`select set_config('munshi.tenant_id', $1, true)`, [grant.tenantId]);
          await c.query('insert into idp.reset_use (grant_id, tenant_id, subject, used_txid) values ($1, $2, $3, 0)', [grant.grantId, grant.tenantId, grant.subject]);
          const set = await c.query('update idp.identity set password_hash = $2, salt = $3, params = $4 where subject = $1::uuid and erased_at is null', [
            grant.subject,
            hash,
            salt,
            JSON.stringify(params),
          ]);
          if (set.rowCount !== 1) throw fail();
          await c.query('commit');
          return true;
        } catch {
          await c.query('rollback').catch(() => (broken = true));
          return false;
        } finally {
          c.release(broken);
        }
      }),

    erase: (subject: string) => eraseIdentity(pool, subject),
    eraseUnbound: (subject: string) => eraseUnboundIdentity(pool, subject),
  };
}

// The erase of an identity nothing holds (IdentityPort.eraseUnbound): in one transaction on idp's pool, under the lock
// class 11 that ops.login_guard takes on (provider, subject) while it binds a login, the identity is erased only if its
// summary counts no live membership and it is not an operator's (ops.subject_summary, which munshi_idp reads; a login's
// binding and revocation keep its count). A login a moment from committing waits for this lock, or this waits for it.
export async function eraseUnboundIdentity(pool: IdpPool, subject: string): Promise<boolean> {
  return guarded(async () => {
    const c = await pool.connect();
    let broken = false;
    try {
      await c.query('begin');
      await c.query(`select pg_advisory_xact_lock(11, hashtext('password:' || $1))`, [subject]);
      const r = await c.query(
        `update idp.identity set email_hmac = null, password_hash = null, salt = null, params = null, erased_at = now()
          where subject = $1::uuid and erased_at is null
            and not exists (select 1 from ops.subject_summary s
                             where s.provider = 'password' and s.subject = $1::text and (s.memberships > 0 or s.is_operator))`,
        [subject],
      );
      await c.query('commit');
      return r.rowCount === 1;
    } catch (err) {
      await c.query('rollback').catch(() => (broken = true));
      throw err;
    } finally {
      c.release(broken);
    }
  });
}

// Erasure (BLUEPRINT §6.2): the hash, salt, parameters and email HMAC go; the row stays, erased. Also the purge of lapsed
// real sign-ups' (core's jobs-signups.ts, wired by the tick route on idp's own pool), which needs no other part of the
// port. Once: an erased identity is left as it is.
export function eraseIdentity(pool: Queryable, subject: string): Promise<void> {
  return guarded(async () => {
    await pool.query(
      'update idp.identity set email_hmac = null, password_hash = null, salt = null, params = null, erased_at = now() where subject = $1::uuid and erased_at is null',
      [subject],
    );
  });
}

// The operator's `pnpm identity:reset`, inside the caller's transaction as the owner role (identity_guard admits it):
// a new hash and a fresh salt for the identity of this email. The identity's subject, or null when there is none.
export async function setPasswordAsOwner(c: Queryable, email: string, password: string, identitySecret: string): Promise<string | null> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, SCRYPT);
  return guarded(async () => {
    const r = await c.query('update idp.identity set password_hash = $2, salt = $3, params = $4 where email_hmac = $1 and erased_at is null returning subject::text as subject', [
      emailHmac(email, identitySecret),
      hash,
      salt,
      JSON.stringify(SCRYPT),
    ]);
    return (r.rows[0] as { subject: string } | undefined)?.subject ?? null;
  });
}
