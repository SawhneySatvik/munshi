// Red-proofs of the tenancy gates (test/v2/gates/03-tenancy.test.ts): each removes one rule from a 03_tenancy.sql trigger.
import type { Case } from '../../sabotage.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/03-tenancy.test.ts';
const LOCK = 'perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const T1_CLASS = 'T1 a live tenant exists only on a live deployment, and a sandbox only off live and synthetic';
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
const F7_VIA = 'F7 a demo session only on a sample shop off live, a sandbox session only on a sandbox, a real one only on live with a live login at the current epoch';
const F7_TWO = 'F7 two owners deactivating each other at once leave one active owner';
const CAP4 = 'CAP4 a switch-on with a requirement off and a switch-off while a dependant is on are refused; only an active owner switches; no actor only at creation';
const CAP4_RACE = "CAP4 two switches of one tenant at once never both pass against each other's old state";

export const TENANCY_CASES: Case[] = [
  t(T1_CLASS, 'v2-t1-class', mutate('ops.tenant_class()', "if (new.data_class = 'live') <> (deployed = 'live') then", 'if false then')),
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
];
