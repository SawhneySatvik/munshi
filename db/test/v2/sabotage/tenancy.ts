// Red-proofs of the tenancy gates (test/v2/gates/03-tenancy.test.ts): each removes one rule from a 03_tenancy.sql trigger.
// And of the pending-shop gates (test/v2/gates/03-pending.test.ts, D-079, D-080): each removes one rule of acceptance,
// of a pending shop's refusals, of the purge of expired sign-ups, or of an identity's verified_via.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/03-tenancy.test.ts';
const LOCK = 'perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const p = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: 'test/v2/gates/03-pending.test.ts', test, config: V2, sql });
const PEND1 = 'PEND1 a pending real shop refuses every write but its creation and every session but its owner’s; accepted, the same writes and sessions go through';
const ACCEPT1 =
  'ACCEPT1 a real shop is accepted only by an approved tenant_accept change for it, decided later by an operator, once and chained; never a sample shop or an expired sign-up';
const ACCEPT2 = 'ACCEPT2 the owner role (the operator’s provisioning) accepts a real shop with no change, chained as a seed';
const PURGE1 =
  'PURGE1 the purge frees only an expired pending real shop’s slug and erases its owner and logins; a fresh pending, an accepted or a sample shop is untouched';
const SQUAT1 = 'SQUAT1 one identity holds one pending real sign-up: a second is refused until the first is accepted or expires';
const IDP2 = 'IDP2 an identity says how its email was vouched for (an invite, a verified email claim, the operator’s seed), and never changes it; only the owner role seeds';
const GRANT1 = 'GRANT1 a channel is granted only to a real shop: never proposed for a sample shop, never written once the sign-up is purged; a sample shop lists no recipient';
const PEND2 = 'PEND2 a pending real shop’s app inserts into no other tenant table (a_open on every one but the creation’s and the self-guarded); an open shop’s pass it';
const PURGE2 = 'PURGE2 a lapsed sign-up leaves no personal string anywhere: every row naming the tenant, and every global row, holds none of what its owner typed';
const LOCK1 = 'LOCK1 an acceptance and the purge of one sign-up never both commit: the purge waits on the tenant’s lock and re-reads the acceptance';
const SQUAT2 = 'SQUAT2 two sign-ups of one identity at once: the second waits on the identity’s lock and is refused';
const G13_GRANTS = "G13 the global tables are exactly the manifest's, each with RLS forced, and every role holds exactly its declared privileges";
const waits = (what: string) => `raise exception '${what} refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';`;

const T1_CLASS = 'T1 one database holds sample and real shops: a sandbox is synthetic, and on a hosted or live deployment self-serve makes only a real shop or a sandbox';
const T1_FIXED = 'T1 the deployment and schema rows are written only as the owner, before any tenant, and never change';
const T1_GUARD = 'T1 only an active owner changes the tenant, only its name and count_max_age, audited; and only an active owner changes a shop';
const SIGNUP1 = 'SIGNUP1 a directory row or a first-owner login is accepted only in the transaction that created the tenant';
const SLUG1 = 'SLUG1 a reserved slug, a look-alike of a reserved or taken slug, or a route word is refused at self-serve sign-up; the owner role takes a reserved slug';
const G12_ADD = 'G12 the first member is the owner adding themself; then only an active owner adds an owner or a manager, and owners or managers add staff';
const G12_AUDIT = 'G12 every member added is audited under the member who added them, with ids and the role only';
const F4_INVITE = 'F4 an invite is made by an active owner, or a manager for staff, used once by the invited member before it expires; the purge erases only an expired one';
const F7_EMAIL = 'F7 no email survives a used invite: using one without erasing its email is refused';
const F4_LOGIN = 'F4 a login is bound only by the member, in the transaction that used the invite it names, and an invite binds once';
const F5_SESSION = 'F5 a session is opened by its own member, signed out once by that member or an active owner, and never signed back in';
const F5_DEACTIVATE = 'F5 a member is deactivated once, by an active owner, never the last active owner, and never re-activated';
const F5_PURGE = 'F5 the purge erases a member only a year after deactivation, with no live login, leaving no audit entry';
const F7_VIA = 'F7 a session follows the tenant class on any deployment: demo only on a sample shop, sandbox only on a sandbox, real only on a real shop with a live login at the current epoch';
const F7_TWO = 'F7 two owners deactivating each other at once leave one active owner';
const CAP4 = 'CAP4 a switch-on with a requirement off and a switch-off while a dependant is on are refused; only an active owner switches; no actor only at creation';
const CAP4_RACE = "CAP4 two switches of one tenant at once never both pass against each other's old state";

export const TENANCY_CASES: Case[] = [
  t(T1_CLASS, 'v2-t1-class', mutate('ops.tenant_class()', "if current_user = 'munshi_app' and served and not (new.data_class = 'live' or new.sandbox) then", 'if false then')),
  t(T1_CLASS, 'v2-t1-hosted', mutate('ops.tenant_class()', "d.kind = 'live' or d.hosted", "d.kind = 'live'")),
  t(T1_CLASS, 'v2-t1-sandbox-synthetic', mutate('ops.tenant_class()', "if new.sandbox and new.data_class <> 'synthetic' then", 'if false then')),
  t(T1_FIXED, 'v2-t1-fixed', mutate('ops.build_row()', "if tg_op <> 'INSERT' then", 'if false then')),
  t(T1_GUARD, 'v2-t1-tenant-guard', mutate('ops.tenant_guard()', "and m.role = 'owner' and m.active) then", ') then')),
  t(SIGNUP1, 'v2-signup1-txid', mutate('ops.directory_guard()',
    'or not exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.created_txid = txid_current()) then', 'then')),
  // the reserved check compares slugs, not skeletons: a look-alike gets through
  t(SLUG1, 'v2-slug1-skeleton', mutate('ops.directory_guard()', 'where r.skeleton = skel;', 'where r.slug = new.slug;')),
  t(G12_ADD, 'v2-g12-owner-only', mutate('ops.member_guard()',
    "coalesce(actor_role = 'owner' or (actor_role = 'manager' and new.role = 'staff'), false)", "coalesce(actor_role in ('owner', 'manager'), false)")),
  t(G12_AUDIT, 'v2-g12-audit', mutate('ops.member_audit()', 'if act is not null and ctx_actor is not null then', 'if false then')),
  t(F4_INVITE, 'v2-f4-invite-role', mutate('ops.invite_guard()',
    "coalesce(actor_role = 'owner' or (actor_role = 'manager' and invited_role = 'staff'), false)", 'actor_role is not null')),
  t(F7_EMAIL, 'v2-f7-email', mutate('ops.invite_guard()', 'elsif new.erased_at is null then', 'elsif false then')),
  t(F4_LOGIN, 'v2-f4-invite-txid', mutate('ops.login_bind()', 'and i.used_txid = txid_current()', '')),
  t(F5_SESSION, 'v2-f5-session-own', mutate('ops.session_via()', 'if new.member_id is distinct from ctx_actor or new.revoked_at is not null', 'if new.revoked_at is not null')),
  t(F5_DEACTIVATE, 'v2-f5-last-owner', mutate('ops.member_guard()', "if old.role = 'owner' and not exists (", "if false and not exists (")),
  // the purge's age clause dropped (RET1's red-proof for the member rule)
  t(F5_PURGE, 'v2-f5-purge-age', mutate('ops.member_guard()', "and a.created_at < now() - interval '365 days'", '')),
  t(F7_VIA, 'v2-f7-via-demo', mutate('ops.session_via()', "if new.via = 'demo' and (", "if false and (")),
  t(F7_VIA, 'v2-f7-via-real-class', mutate('ops.session_via()', "if t.data_class is distinct from 'live' or live_login.id is null", 'if live_login.id is null')),
  t(F7_TWO, 'v2-f7-member-lock', mutate('ops.member_guard()', LOCK, '')),
  t(CAP4, 'v2-cap4-requires', mutate('ops.capability_guard()',
    "raise exception 'switch refused: % requires %, which is off', new.capability, blocker using errcode = 'MS019';", 'null;')),
  t(CAP4, 'v2-cap4-dependant', mutate('ops.capability_guard()',
    "raise exception 'switch refused: % requires %, so % stays on', blocker, new.capability, new.capability using errcode = 'MS019';", 'null;')),
  t(CAP4, 'v2-cap4-owner', mutate('ops.capability_guard()', "and m.role = 'owner' and m.active) then", 'and m.active) then')),
  t(CAP4_RACE, 'v2-cap4-lock', mutate('ops.capability_guard()', LOCK, '')),
  // DB-1's functions no case named (BP-DB-2's coverage scan): the audit labels, the shop and hours guards, the login summary
  t(T1_GUARD, 'v2-t1-tenant-audit', mutate('ops.tenant_audit()', "'tenant.update', 'ops.tenant',", "'tenant.change', 'ops.tenant',")),
  t(T1_GUARD, 'v2-t1-shop-guard', mutate('ops.shop_guard()', "and m.role = 'owner' and m.active))", 'and m.active))')),
  t(T1_GUARD, 'v2-t1-shop-audit', mutate('ops.shop_audit()', "'shop.update', 'ops.shop',", "'shop.change', 'ops.shop',")),
  t(T1_GUARD, 'v2-t1-hours-guard', mutate('ops.hours_guard()', "m.role in ('owner', 'manager') and m.active) then", 'm.active) then')),
  t(F4_LOGIN, 'v2-f4-login-summary', mutate('ops.login_summary()', 'member_role, now())', "'owner', now())")),
  t(CAP4, 'v2-cap4-audit-payload', mutate('ops.capability_audit()', "jsonb_build_object('capability', new.capability, 'is_on', new.is_on)", "jsonb_build_object('capability', new.capability)")),
  // D-080: a pending real shop's refusals, one per guard
  p(PEND1, 'v2-pend1-book', mutate('books.write()', waits('book write'), 'null;')),
  p(PEND1, 'v2-pend1-draft', mutate('approval.stamp_draft()', waits('draft'), 'null;')),
  p(PEND1, 'v2-pend1-decision', mutate('approval.stamp_decision()', waits('decision'), 'null;')),
  p(PEND1, 'v2-pend1-snapshot', mutate('snap.snap_check()', waits('snapshot'), 'null;')),
  p(PEND1, 'v2-pend1-member', mutate('ops.member_guard()', waits('member'), 'null;')),
  p(PEND1, 'v2-pend1-invite', mutate('ops.invite_guard()', waits('invite'), 'null;')),
  p(PEND1, 'v2-pend1-switch', mutate('ops.capability_guard()', waits('switch'), 'null;')),
  p(PEND1, 'v2-pend1-tenant', mutate('ops.tenant_guard()', waits('tenant'), 'null;')),
  p(PEND1, 'v2-pend1-shop', mutate('ops.shop_guard()', waits('shop'), 'null;')),
  p(PEND1, 'v2-pend1-hours', mutate('ops.hours_guard()', waits('hours'), 'null;')),
  p(PEND1, 'v2-pend1-session', mutate('ops.session_via()', "raise exception 'session refused: a pending shop signs in only its owner, until the sign-up expires' using errcode = 'MS020';", 'null;')),
  // acceptance: no change, or another shop's, admits it; a sample shop or an expired sign-up is accepted; no owner seed
  p(ACCEPT1, 'v2-accept1-no-change', mutate('platform.platform_guard()', "if current_user = 'munshi_owner' and tg_op = 'INSERT' and ctx_change is null", "if current_user in ('munshi_owner', 'munshi_platform') and tg_op = 'INSERT' and ctx_change is null")),
  p(ACCEPT1, 'v2-accept1-other-shop', mutate('platform.platform_guard()', "       or (r ? 'tenant_id' and (r ->> 'tenant_id')::uuid is distinct from ch.tenant_id)\n", '')),
  p(ACCEPT1, 'v2-accept1-class', mutate('platform.acceptance_check()', " and t.data_class = 'live'", '')),
  p(ACCEPT1, 'v2-accept1-expiry', mutate('platform.acceptance_check()', "\n     or ops.tenant_lapsed(new.tenant_id)", '')),
  p(ACCEPT2, 'v2-accept2-seed', mutate('platform.platform_guard()', "tg_table_name in ('reserved_slug', 'tenant_acceptance')", "tg_table_name in ('reserved_slug')")),
  // the purge: the guards' age or acceptance clause dropped, or the slug kept
  // the lapsed rule: its age or its acceptance clause dropped, or a jobs branch that no longer asks it (MINOR-4)
  p(PURGE1, 'v2-lapsed-age', mutate('ops.tenant_lapsed(uuid)', " and t.created_at < now() - interval '14 days')", ')')),
  p(PURGE1, 'v2-lapsed-accepted', mutate('ops.tenant_lapsed(uuid)', "\n     and not exists (select 1 from platform.tenant_acceptance a where a.tenant_id = p_tenant)", '')),
  p(PURGE1, 'v2-purge1-slug-branch', mutate('ops.directory_guard()', "old.live and ops.tenant_lapsed(old.tenant_id) then", 'old.live then')),
  p(PURGE1, 'v2-purge1-login-branch', mutate('ops.login_bind()', "old.tenant_id = ctx_tenant and ops.tenant_lapsed(old.tenant_id) then", 'old.tenant_id = ctx_tenant then')),
  p(PURGE1, 'v2-purge1-member-branch', mutate('ops.member_guard()', "ctx_actor is null and ops.tenant_lapsed(new.tenant_id) then", 'ctx_actor is null then')),
  p(PURGE1, 'v2-purge1-keeps-slug', mutate('ops.purge_pending_signups()', '    delete from ops.tenant_directory d where d.tenant_id = t;\n', '')),
  p(PURGE1, 'v2-purge1-expired-session', mutate('ops.session_via()', "(ops.tenant_lapsed(new.tenant_id) or not exists (", '(not exists (')),
  // the purge leaves a personal string: the shop's, the tenant's or the owner's
  p(PURGE2, 'v2-purge2-shop', mutate('ops.purge_pending_signups()', "    update ops.shop x set name = 'Lapsed', area = null, address = null where x.tenant_id = t;\n", '')),
  p(PURGE2, 'v2-purge2-tenant', mutate('ops.purge_pending_signups()', "    update ops.tenant x set name = 'Lapsed sign-up' where x.tenant_id = t;\n", '')),
  p(PURGE2, 'v2-purge2-members', mutate('ops.purge_pending_signups()', "    update ops.member m set display_name = null, phone_e164 = null, erased_at = now() where m.tenant_id = t and m.erased_at is null;\n", '')),
  // a pending shop's app writes: the helper says open, or a_open lets it through
  p(PEND1, 'v2-open-helper', mutate('ops.tenant_open(uuid)', "or exists (select 1 from ops.tenant t where t.tenant_id = p_tenant and t.data_class <> 'live')", 'or true')),
  p(PEND2, 'v2-pend2-a-open', mutate('ops.open_write()', "raise exception '%.% refused: the shop waits for the operator''s acceptance', tg_table_schema, tg_table_name using errcode = 'MS020';", 'null;')),
  // acceptance and purge race: no lock on either side, or no re-check after it
  p(LOCK1, 'v2-lock1-acceptance', mutate('platform.acceptance_check()', '  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));\n', '')),
  p(LOCK1, 'v2-lock1-purge', mutate('ops.purge_pending_signups()', '    perform pg_advisory_xact_lock(1, hashtext(t::text));\n', '')),
  // one pending sign-up per identity, until accepted or expired
  p(SQUAT1, 'v2-squat1-identity', mutate('ops.login_bind()', "raise exception 'login refused: this identity already has a real shop waiting for acceptance' using errcode = 'MS020';", 'null;')),
  p(SQUAT1, 'v2-squat1-revoke', mutate('ops.login_bind()', 'if old.first_owner and not ops.tenant_open(old.tenant_id) then', 'if false then')),
  p(SQUAT2, 'v2-squat2-lock', mutate('ops.login_bind()', "      perform pg_advisory_xact_lock(11, hashtext(new.provider || ':' || new.subject));\n", '')),
  p(SQUAT1, 'v2-squat1-expiry', mutate('ops.login_bind()', " and d.created_at > now() - interval '14 days'", '')),
  // a channel grant for a sample shop: proposed, or written for a shop whose real sign-up was purged
  p(GRANT1, 'v2-grant1-proposal', mutate('platform.change_guard()', "raise exception 'change refused: a channel is granted only to a real shop' using errcode = 'MS017';", 'null;')),
  p(GRANT1, 'v2-grant1-table', mutate('platform.grant_class()', "raise exception 'grant refused: a channel is granted only to a real shop' using errcode = 'MS017';", 'null;')),
  // verified_via: the seed not stamped, or the column not frozen
  p(IDP2, 'v2-idp2-seed', mutate('idp.identity_guard()', "new.verified_via := 'seed';", 'null;')),
  p(IDP2, 'v2-idp2-frozen', mutate('idp.identity_guard()', ' or new.verified_via <> old.verified_via', '')),
  // MINOR-5: the public reads the directory's slug and tenant only
  { sabotage: 'v2-dir-public-columns', file: 'test/v2/gates/manifest.test.ts', test: G13_GRANTS, config: V2, sql: asOwner('grant select on ops.tenant_directory to munshi_public;') },
];
