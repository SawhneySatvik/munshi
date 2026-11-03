// Red-proofs of sign-in and the fence (BP-AUTH-1, test/v2/core/auth): each removes one rule from the password identity,
// core's sign-in paths or the session check, or, where the database still holds the line behind core, the database's
// half, so each gate is shown to depend on what it names.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/auth';
const PASSWORD = 'packages/adapters/identity/password.ts';
const LOGINS = 'packages/core/src/logins.ts';
const SESSION = 'packages/core/src/session.ts';
const sql = (file: string, test: string, sabotage: string, body: string): Case => ({ sabotage, file: `${DIR}/${file}`, test, config: V2, sql: body });
const ts = (file: string, test: string, sabotage: string, target: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: target, from, to },
});

const F4 = 'F4 an invite binds a login only through its own link, once, before it expires; a mismatched email, a used, an expired or another shop’s link is 404 and makes no identity';
const F7_EMAIL = 'F7 no email survives a used invite, and the identity keeps only the email’s HMAC';
const VERIFIED = 'IDP1 an identity is made only from an invite whose link and email were verified, stamped verified, and only that identity signs in';
const AUTH3 = 'AUTH3 an invite for an email that already has an account and one for a new email take the same work and give the same answers: a right password opens a session, every failure the same answer';
const SALT = 'IDP1 passwords are scrypt with a per-identity salt and their parameters on the row; a seeded operator’s identity signs in through the adapter';
const BAND = 'IDP1 a wrong password and an unknown email take the same path and time band, and return the same null';
const LOCK = 'IDP1 five failures lock the pair for 15 minutes, doubling up to a day; the right password is refused while it is locked';
const PAIR = 'LOCK1 five failures from one IP lock only that (identity, IP) pair: the owner signs in from another IP at once; three failures across IPs require the bot check';
const SCRYPT_ALWAYS = 'LOCK1 a locked or unknown email still runs scrypt (timing band asserted)';
const PER_IP = 'IDP1 per-IP limits: the eleventh sign-in attempt from one IP within 10 minutes is refused, another IP’s is not, and a sixth sample shop from one IP in a day';
const SCAN = 'IDP1 no password or hash in any log, error, trace or other table (a scan)';
const RESET_IDP = 'IDP1 the reset sets the password once, for a grant used on its link within 5 minutes; a change with no used grant, or a second one, is refused';
const F1 = 'F1 a demo-minted cookie for a live tenant gives no session: a demo or sandbox claim naming a real row is refused, and so is a demo row planted on a live tenant';
const F5 = 'F5 a revoked session, an expired one, another member’s, or a deactivated member’s has no session on the next request';
const F6 = 'F6 the memberships lookup returns id, name and role only, and nothing for an unbound subject; a revoked login or an inactive member is left out';
const AUTH1 = 'AUTH1 real sign-in is refused on a demo deployment: no real session, no identity made from an invite, and the database refuses a real row';
const AUTH2 = 'AUTH2 a sign-in with no matching invite or membership writes nothing';
const F7_VIA = 'F7 a session’s via rides into its transactions as munshi.via, which the release and delivery rules read; openSession’s carries none';
const RESET_REFUSED = 'RESET1 an in-app reset is refused for an owner, for a peer or higher role, for an identity with a second membership, for an operator, and across shops';
const EPOCH = 'RESET1 a used reset ends every session opened under the older epoch and opens one that records its grant; the link is single-use and expires';
const CLI = 'RESET1 pnpm identity:reset sets the password of an owner of two shops, and of an operator, and ends every session of each identity, in each shop and in the console';
const F3 = 'F3 the picker lists the demo’s synthetic and showcase shops, and never a planted live tenant or a sandbox';
const F2 = 'F2 on a live deployment a real shop opens no demo session for any member and is never listed; a sandbox is a sample shop there too (D-080)';
const SANDBOX = 'SANDBOX1 a sample shop is a synthetic sandbox with its pack’s switches and no login, opened as a 7-day sandbox session the picker never offers';
const SANDBOX_GONE = 'SANDBOX1 a whole sandbox is deleted as the owner in one transaction off live; the same delete of a sample shop that is not a sandbox is refused';
const SRC = 'AUTH-SRC no web source opens a session itself, and only lib/server/session.ts builds the identity port';
const PROCESS = 'RESET1 the identity:reset process takes its answers on stdin, ends the identity’s sessions and prints no password; a refused password exits 1, a stray argument or a missing setting 2';

const EMAIL_CHECK = 'if (!inv || !same(sha256(foldEmail(input.email)), sha256(foldEmail(inv.email)))) return NOT_FOUND;';
const SIGN_IN_OK = 'const ok = (await matches(input.password, s)) && open(s, ctx);';
const OPEN = 'const open = (s: State, ctx: RequestCtx) => !s.locked && (s.recent < 3 || ctx.botCheck);';
const RESUME_LIVE = 'where s.id = $1 and s.revoked_at is null and s.expires_at > now()`';

export const CORE_AUTH_CASES: Case[] = [
  // invites
  ts('invite.test.ts', F4, 'v2-auth-invite-email', LOGINS, EMAIL_CHECK, 'if (!inv) return NOT_FOUND;'),
  ts('invite.test.ts', F4, 'v2-auth-invite-expiry', LOGINS, 'and i.used_at is null and i.erased_at is null and i.expires_at > now()', 'and i.used_at is null and i.erased_at is null'),
  ts('invite.test.ts', F7_EMAIL, 'v2-auth-invite-keeps-email', LOGINS, 'set used_at = now(), email = null, erased_at = now()', 'set used_at = now()'),
  ts('invite.test.ts', VERIFIED, 'v2-auth-unverified-identity', LOGINS, EMAIL_CHECK, 'if (!inv) return NOT_FOUND;'),
  // answer differently: a new email whose password the rules refuse is created anyway
  ts('invite.test.ts', AUTH3, 'v2-auth3-answer', PASSWORD, 'if (s.id || !allowed || !open(s, ctx)) {', 'if (s.id) {'),
  // skip scrypt for a known account's refused password: that answer comes back faster
  ts('invite.test.ts', AUTH3, 'v2-auth3-timing', PASSWORD, 'const ok = (await matches(input.password, s)) && allowed && open(s, ctx);', 'const ok = allowed && (await matches(input.password, s)) && open(s, ctx);'),
  // the password identity
  ts('password.test.ts', SALT, 'v2-idp1-one-salt', PASSWORD, 'const salt = randomBytes(16);\n        const hash = await derive(input.password, salt, params);', 'const salt = dummySalt;\n        const hash = await derive(input.password, salt, params);'),
  ts('password.test.ts', BAND, 'v2-idp1-unknown-fast', PASSWORD, 'const key = await derive(password, s.id?.salt ?? dummySalt, s.id?.params ?? params);', 'const key = s.id ? await derive(password, s.id.salt, s.id.params) : dummyHash;'),
  ts('password.test.ts', BAND, 'v2-idp1-unknown-uncounted', PASSWORD, '&& open(s, ctx);\n        await settle(mac, ctx, ok);', '&& open(s, ctx);\n        if (s.id) await settle(mac, ctx, ok);'),
  ts('password.test.ts', LOCK, 'v2-idp1-no-doubling', PASSWORD, "interval '15 minutes' * power(2, (a.failures + 1) / 5 - 1)", "interval '15 minutes'"),
  ts('password.test.ts', LOCK, 'v2-idp1-locked-opens', PASSWORD, OPEN, 'const open = (s: State, ctx: RequestCtx) => s.recent < 3 || ctx.botCheck;'),
  // lock the identity everywhere: the pair's lock read by email alone
  ts('password.test.ts', PAIR, 'v2-lock1-everywhere', PASSWORD, 'where a.email_hmac = $1 and a.ip_hash = $2), false) as locked', 'where a.email_hmac = $1 order by a.locked_until desc nulls last limit 1), false) as locked'),
  ts('password.test.ts', PAIR, 'v2-lock1-no-bot-check', PASSWORD, OPEN, 'const open = (s: State, _ctx: RequestCtx) => !s.locked;'),
  ts('password.test.ts', SCRYPT_ALWAYS, 'v2-lock1-skip-scrypt', PASSWORD, SIGN_IN_OK, 'const ok = open(s, ctx) && (await matches(input.password, s));'),
  ts('password.test.ts', PER_IP, 'v2-idp1-no-limit', LOGINS, 'return (rows[0] as { hits: number }).hits <= limit.hits;', 'return rows.length > 0;'),
  // log the request body
  ts('password.test.ts', SCAN, 'v2-idp1-logged', PASSWORD, 'signIn: (input: SignInInput, ctx: RequestCtx) =>\n      guarded(async () => {', "signIn: (input: SignInInput, ctx: RequestCtx) =>\n      guarded(async () => {\n        console.info('sign-in', JSON.stringify(input));"),
  ts('password.test.ts', RESET_IDP, 'v2-idp1-reset-no-grant', PASSWORD, "await c.query('insert into idp.reset_use (grant_id, tenant_id, subject, used_txid) values ($1, $2, $3, 0)', [grant.grantId, grant.tenantId, grant.subject]);", ''),
  sql('password.test.ts', RESET_IDP, 'v2-idp1-reset-stale', mutate('idp.reset_use_guard()', "and g.used_at is not null and g.used_at > now() - interval '5 minutes'", 'and g.used_at is not null')),
  // sessions
  ts('session.test.ts', F1, 'v2-f1-via-claim', SESSION, 'if (r.member !== claim.memberId || r.via !== claim.via) return null;', 'if (r.member !== claim.memberId) return null;'),
  ts('session.test.ts', F1, 'v2-f1-via-class', SESSION, "if (r.via !== 'real' && (r.data_class === 'live' || r.deployed === 'live')) return null;", ''),
  ts('session.test.ts', F5, 'v2-f5-active', SESSION, 'if (!r.active) return null;', ''),
  ts('session.test.ts', F5, 'v2-f5-revoked', SESSION, RESUME_LIVE, 'where s.id = $1 and s.expires_at > now()`'),
  ts('session.test.ts', F5, 'v2-f5-expired', SESSION, RESUME_LIVE, 'where s.id = $1 and s.revoked_at is null`'),
  ts('session.test.ts', F6, 'v2-f6-member-id', LOGINS, 'if (m) found.push({ id: l.tenant, name: m.name, role: m.role });', 'if (m) found.push({ id: l.tenant, name: m.name, role: m.role, memberId: l.member } as Membership);'),
  ts('session.test.ts', F6, 'v2-f6-revoked', LOGINS, 'where provider = $1 and subject = $2 and revoked_at is null and erased_at is null order by created_at', 'where provider = $1 and subject = $2 and erased_at is null order by created_at'),
  ts('session.test.ts', F6, 'v2-f6-inactive', LOGINS, 'where m.id = $1 and m.active', 'where m.id = $1'),
  ts('session.test.ts', AUTH1, 'v2-auth1-core', LOGINS, "if ((await deploymentKind(pool)) !== 'live') return NOT_FOUND;\n  const inv = await findInvite", 'const inv = await findInvite'),
  sql('session.test.ts', AUTH1, 'v2-auth1-database', mutate('ops.session_via()', "if t.data_class is distinct from 'live' or live_login.id is null", 'if live_login.id is null')),
  // a success counted as a failure: the sign-in writes an attempt row
  ts('session.test.ts', AUTH2, 'v2-auth2-writes', PASSWORD, 'pool.query(ok ? CLEARED : FAILED, [mac, ctx.ipHash])', 'pool.query(FAILED, [mac, ctx.ipHash])'),
  ts('session.test.ts', F7_VIA, 'v2-f7-via-unset', SESSION, "member?.session.via ?? '',", "'',"),
  // resets
  sql('reset.test.ts', RESET_REFUSED, 'v2-reset1-peer', mutate('ops.reset_guard()',
    "(issuer_role = 'owner' and target_role in ('manager', 'staff')) or (issuer_role = 'manager' and target_role = 'staff')", "issuer_role in ('owner', 'manager')")),
  sql('reset.test.ts', RESET_REFUSED, 'v2-reset1-memberships', mutate('ops.reset_guard()', 'and s.memberships = 1 and', 'and')),
  ts('reset.test.ts', EPOCH, 'v2-reset1-epoch-unchecked', SESSION, "r.current_epoch === null || r.epoch !== r.current_epoch)) return null;", 'r.current_epoch === null)) return null;'),
  // bump no epoch
  sql('reset.test.ts', EPOCH, 'v2-auth-reset-no-epoch', mutate('ops.reset_epoch()', 'set epoch = s.epoch + 1', 'set epoch = s.epoch')),
  ts('reset.test.ts', CLI, 'v2-reset1-cli-sessions', LOGINS,
    "sessionsEnded += (await c.query('delete from ops.login_session where tenant_id = $1 and member_id = $2', [l.tenant, l.member])).rowCount ?? 0;", ''),
  // the spawned process loads its code from disk, so its case is the database's: the owner's session delete matches nothing
  sql('cli.test.ts', PROCESS, 'v2-auth-cli-process-sessions',
    asOwner('create policy keep_sessions on ops.login_session as restrictive for delete to munshi_owner using (false);')),
  // the demo
  ts('demo.test.ts', F3, 'v2-f3-every-tenant', LOGINS, "if (r && (r.data_class === 'synthetic' || r.data_class === 'showcase') && !r.sandbox) shops.push", 'if (r) shops.push'),
  sql('demo.test.ts', F2, 'v2-f2-demo-on-live', mutate('ops.session_via()', "if new.via = 'demo' and (t.sandbox or t.data_class is null or t.data_class not in ('synthetic', 'showcase')) then", "if new.via = 'demo' and t.sandbox then")),
  // the pack's switches read but never written
  ts('demo.test.ts', SANDBOX, 'v2-sandbox1-switches', LOGINS, '`insert into ops.capability_switch (tenant_id, capability, is_on)\n         select $1', '`select $1'),
  // drop the sandbox clause: a book row of a sample shop that is not a sandbox deletes too
  sql('demo.test.ts', SANDBOX_GONE, 'v2-sandbox1-clause', mutate('books.write()', ' and exists (select 1 from ops.tenant t where t.tenant_id = old.tenant_id and t.sandbox) then', ' then')),
  // harness-level: a page that opens a session from ids joins the scan
  { sabotage: 'v2-auth-web-mints', file: `${DIR}/scan.test.ts`, test: SRC, config: V2 },
];
