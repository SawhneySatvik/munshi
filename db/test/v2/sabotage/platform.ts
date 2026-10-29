// Red-proofs of the identity, reset and platform gates (test/v2/gates/09-idp-platform.test.ts).
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/09-idp-platform.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const IDP1_READ = 'IDP1 no role but munshi_idp reads or writes an identity, an attempt or a reset use';
const IDP1_SHAPE = 'IDP1 an identity is created verified with a 16-byte salt; a password changes with a fresh salt and its stamp; erasure nulls every secret and freezes the row';
const IDP1_SWEEP = 'IDP1 lockout rows are swept a day after their last attempt, unless still locked';
const RESET1 = 'RESET1 an in-app reset only downward for a one-shop identity; used once with its token it bumps the epoch; the idp side takes it once, within 5 minutes';
const F4_OPERATOR = 'F4 an operator identity is never bound to a shop, and an identity with a shop membership never becomes an operator';
const PLAT1_SIGN_IN = 'PLAT1 an operator’s own TOTP step is chained as operator.sign_in, ids only, with no change id even when the session names one';
// core's operator lifecycle (test/v2/core/platform/operator.test.ts) reads every operator entry's label back.
const OPERATOR_LIFECYCLE: Omit<Case, 'sabotage' | 'sql'> = {
  file: 'test/v2/core/platform/operator.test.ts',
  test: 'PLAT1 the first operator is seeded only while none exists; another is added only by an approved change with a fresh code; the last active operator is never deactivated',
  config: V2,
};
const AUDIT = 'platform.audit_write()';
const PLAT1_WRITE = 'PLAT1 no platform table accepts a write without an approved change decided in this transaction, later than its proposal, by this operator, for exactly this write';
const PLAT1_CHAIN = 'PLAT1 every proposal, decision and executed write is in the platform chain, which verifies; a tampered entry is found';
const PLAT1_SESSION = 'PLAT1 an operator session needs an active operator and a TOTP code from the last 5 minutes, at its identity’s epoch, and is revoked once';

export const PLATFORM_CASES: Case[] = [
  // both fences: the schema's USAGE and the table's SELECT
  t(IDP1_READ, 'v2-idp1-app-reads', 'grant usage on schema idp to munshi_app; grant select on idp.identity to munshi_app;'),
  t(IDP1_SHAPE, 'v2-idp1-same-salt', mutate('idp.identity_guard()', 'if new.salt = old.salt or new.password_hash = old.password_hash then', 'if false then')),
  t(IDP1_SHAPE, 'v2-idp1-unfrozen', mutate('idp.identity_guard()', 'if old.erased_at is not null then', 'if false then')),
  t(IDP1_SWEEP, 'v2-idp1-sweep-locked',
    "drop policy attempt_sweep on idp.attempt; create policy attempt_sweep on idp.attempt as restrictive for delete to munshi_idp using (last_at < now() - interval '1 day');"),
  // let a manager reset an owner; bump no epoch; accept any token; take a stale grant
  t(RESET1, 'v2-reset1-downward', mutate('ops.reset_guard()',
    "coalesce((issuer_role = 'owner' and target_role in ('manager', 'staff')) or (issuer_role = 'manager' and target_role = 'staff'), false)", 'issuer_role is not null')),
  t(RESET1, 'v2-reset1-no-epoch', asOwner('drop trigger epoch on ops.reset_grant;')),
  t(RESET1, 'v2-reset1-any-token', mutate('ops.reset_guard()',
    "     or sha256(convert_to(coalesce(nullif(current_setting('munshi.reset_token', true), ''), ''), 'UTF8')) <> old.token_sha256\n", '')),
  t(RESET1, 'v2-reset1-stale-grant', mutate('idp.reset_use_guard()', " and g.used_at > now() - interval '5 minutes'", '')),
  t(F4_OPERATOR, 'v2-f4-operator-bind', mutate('ops.login_bind()',
    'if exists (select 1 from ops.subject_summary s where s.provider = new.provider and s.subject = new.subject and s.is_operator) then', 'if false then')),
  t(PLAT1_WRITE, 'v2-plat1-same-tx', mutate('platform.change_guard()', 'if old.proposed_txid = txid_current() then', 'if false then')),
  t(PLAT1_WRITE, 'v2-plat1-payload', mutate('platform.platform_guard()', '\n       or exists (select 1 from unnest(cols) c where r -> c is distinct from ch.payload -> c)', '')),
  t(PLAT1_WRITE, 'v2-plat1-this-tx', mutate('platform.platform_guard()', ' or ch.decided_txid is distinct from txid_current()', '')),
  t(PLAT1_WRITE, 'v2-plat1-totp', mutate('platform.change_guard()', "and (totp_at is null or totp_at < now() - interval '5 minutes' or totp_at > now()) then", 'and false then')),
  t(PLAT1_CHAIN, 'v2-plat1-verify', mutate('platform.verify_chain()', 'return expected;', 'null;')),
  t(PLAT1_CHAIN, 'v2-plat1-unchained', asOwner('drop trigger audit on platform.shop_config;')),
  // the labels: a sign-in chained as a seed (the bug BP-PLAT-1 found), every update as a deactivation, every insert as a seed
  { ...OPERATOR_LIFECYCLE, sabotage: 'v2-plat1-label-sign-in', sql: mutate(AUDIT, "act := 'operator.sign_in';", "act := 'operator.seed';") },
  { ...OPERATOR_LIFECYCLE, sabotage: 'v2-plat1-label-deactivate', sql: mutate(AUDIT, 'elsif old.active and not new.active then', 'elsif true then') },
  { ...OPERATOR_LIFECYCLE, sabotage: 'v2-plat1-label-seed', sql: mutate(AUDIT, "act := case when ch is null then 'operator.seed' else 'operator.add' end;", "act := 'operator.seed';") },
  t(PLAT1_SIGN_IN, 'v2-plat1-sign-in-change', mutate(AUDIT, "act := 'operator.sign_in';\n        ch := null;", "act := 'operator.sign_in';")),
  t(PLAT1_SESSION, 'v2-plat1-session-totp', mutate('platform.session_guard()',
    "       or totp_at is null or totp_at < now() - interval '5 minutes' or totp_at > now()\n", '')),
  t(PLAT1_CHAIN, 'v2-plat1-chain-seq', mutate('platform.chain()', 'new.seq := coalesce(last_seq, 0) + 1;', 'new.seq := coalesce(last_seq, 0) + 2;')),
];
