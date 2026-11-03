// Red-proofs of M7's gates (the migrator): a pending shop is granted no channel and takes no inbound message (PEND3); the
// purge revokes a lapsed sign-up's channel grants from before that rule, chained as its own, and an Instagram account
// counts as held whether or not its shop is listed (PURGE3); the purge takes the chain's lock before a shop's, so it
// never deadlocks with an approval (LOCK2; the seed's order is LOCK3, in tenancy.ts); the console's platform role reads
// the shop's router through ai.shop_models() and ai.shop_features() (ROUTER4, and RT5 on the console); app and jobs read
// only their own shop's budget (SPEND8); an owner's "Default" pick is a NULL alias that follows the shop's default, and
// is refused only when nothing would answer (ROUTER5, MODELS7, MODELS8); the jobs role reads four columns of a draft
// (JOBSDRAFT1).
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const at = (file: string) => (test: string, sabotage: string, sql: string): Case => ({ sabotage, file, test, config: V2, sql });
const pend = at('test/v2/gates/03-pending.test.ts');
const router = at('test/v2/gates/22-shop-router.test.ts');
const spend = at('test/v2/gates/22-ai-spend.test.ts');
const audit = at('test/v2/gates/08-audit.test.ts');

const INBOUND = 'ops.inbound_flow()';
const OPEN = 'ops.inbound_open(uuid)';
const PURGE = 'ops.purge_pending_signups()';
const REVOKE = 'platform.purge_grants(uuid)';
const GUARD = 'platform.platform_guard()';
const AUDIT = 'platform.audit_write()';
const GRANT = 'platform.grant_class()';
const CHANGE = 'platform.change_guard()';
const CHOICE = 'ops.model_choice_guard()';
const CHOICE_AUDIT = 'ops.model_choice_audit()';

const PEND3 =
  'PEND3 a shop waiting for acceptance is granted no channel and stores no inbound message on either channel, even under a grant it holds from before; accepted, it is granted and the same messages are stored';
const PURGE3 =
  'PURGE3 the purge revokes every channel a lapsed sign-up holds, chained as the purge’s with no operator or change; its Instagram account is then free, and an account counts as held whether or not its shop is listed';
const LOCK2 =
  'LOCK2 the purge takes the platform chain’s lock before any shop’s, as an approval does, so they never deadlock: an acceptance racing the purge of a lapsed sign-up that holds a grant is refused, and the purge commits';
const MODELS8 =
  "MODELS8 Default is refused only when modelFor's chain would be empty: a shop default this build does not serve, beside a served build default, takes Default, and the build's answers";
const ROUTER4 =
  'ROUTER4 the console reads a shop’s router through the rule itself: under the shop’s context the platform role’s ai.shop_models() and ai.shop_features() answer as the app’s do; with no shop, nothing is read';
const ROUTER5 =
  'ROUTER5 an owner’s "Default" pick is a NULL alias: the guard takes it from the active owner under model.choose, still checks a named alias, and the entry names no alias';
const SPEND8 = "SPEND8 the app and the jobs role read only their own shop's budget, and ai.spend_month() still reads it there; the console reads every shop's";
const MODELS7 =
  "MODELS7 an owner who picked Default follows the shop's default as it changes: a NULL pick, the build's default first, the operator's later default next";
const JOBSDRAFT1 = 'JOBSDRAFT1 the jobs role reads a draft’s tenant, command, status and payload, and no other column, only for the shop its context names';
const RT5 = "a shop's feature, model list and budget change only once a later request approves the change; each shows beside its change";

export const M7_CASES: Case[] = [
  // 1. A pending shop's inbound: the flow does not ask, or the door says open for a pending shop.
  pend(PEND3, 'v2-m7-pend-inbound', mutate(INBOUND, 'if not ops.inbound_open(new.tenant_id) then', 'if false then')),
  pend(PEND3, 'v2-m7-inbound-open-rule', mutate(OPEN, ' and ops.tenant_open(p_tenant)', '')),
  // ... or granted a channel: at the write, or at the proposal (the root of it: no grant routes to a pending shop).
  pend(PEND3, 'v2-m7-grant-accepted', mutate(GRANT, '\n                                    and exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id)', '')),
  pend(PEND3, 'v2-m7-propose-accepted', mutate(CHANGE, '\n                         and exists (select 1 from platform.tenant_acceptance a where a.tenant_id = d.tenant_id)', '')),
  // 2. The purge's grants: not revoked; revoked for a shop that has not lapsed (the door's check, the guard's); chained
  // as a seed; an unlisted shop's grant not counted; the purge taking a shop's lock before the chain's (a deadlock).
  pend(PURGE3, 'v2-m7-purge-grants-call', mutate(PURGE, '    perform platform.purge_grants(t);\n', '')),
  pend(PURGE3, 'v2-m7-purge-grants-lapsed', mutate(REVOKE, ' or not ops.tenant_lapsed(p_tenant)', '')),
  pend(PURGE3, 'v2-m7-owner-revoke-lapsed', mutate(GUARD, "\n              and ops.tenant_lapsed((r ->> 'tenant_id')::uuid)", '')),
  pend(PURGE3, 'v2-m7-purge-label', mutate(AUDIT, "case when ch is null and tg_table_name = 'channel_grant' then '.purge' when ch is null", 'case when ch is null')),
  pend(
    PURGE3,
    'v2-m7-grant-unlisted',
    mutate(
      GRANT,
      'g.tenant_id <> new.tenant_id\n                  and not exists',
      'g.tenant_id <> new.tenant_id\n                  and exists (select 1 from ops.tenant_directory d where d.tenant_id = g.tenant_id)\n                  and not exists',
    ),
  ),
  pend(LOCK2, 'v2-m7-purge-lock-order', mutate(PURGE, '  end if;\n  perform pg_advisory_xact_lock(10, 0);\n  for t in', '  end if;\n  for t in')),
  // 3. The platform role without the router's functions.
  router(ROUTER4, 'v2-m7-platform-router', 'revoke execute on function ai.shop_models() from munshi_platform; revoke execute on function ai.shop_features() from munshi_platform;'),
  {
    sabotage: 'v2-m7-console-usable',
    file: 'test/console-router.test.tsx',
    test: RT5,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'packages/core/src/views-platform.ts', from: 'usable: usable.rows.some((u) => u.role === role && u.alias === alias),', to: 'usable: true,' },
  },
  {
    sabotage: 'v2-m7-console-default',
    file: 'test/console-router.test.tsx',
    test: RT5,
    dir: 'apps/web',
    config: 'vitest.config.ts',
    ts: { file: 'packages/core/src/views-platform.ts', from: 'shopDefault: dflt?.alias ?? null,', to: 'shopDefault: null,' },
  },
  // 4. Every shop's budget readable by the app and the jobs role.
  spend(SPEND8, 'v2-m7-budget-own-shop', 'drop policy own_shop on platform.ai_budget;'),
  // 6. The outbox sweep's read of a draft: widened to the whole table, or gone.
  audit(JOBSDRAFT1, 'v2-m7-jobs-draft-wide', 'grant select on approval.draft to munshi_jobs;'),
  audit(JOBSDRAFT1, 'v2-m7-jobs-draft-drop', 'revoke select on approval.draft from munshi_jobs;'),
  // 5. Default refused by the guard, or recorded as a word; core recording the default it resolved instead of NULL.
  router(ROUTER5, 'v2-m7-choice-default-guard', mutate(CHOICE, '     or (new.alias is not null and not exists (', '     or (not exists (')),
  router(
    ROUTER5,
    'v2-m7-choice-default-audit',
    mutate(CHOICE_AUDIT, "jsonb_strip_nulls(jsonb_build_object('agent', new.agent, 'alias', new.alias))", "jsonb_build_object('agent', new.agent, 'alias', coalesce(new.alias, 'default'))"),
  ),
  {
    sabotage: 'v2-m7-choose-default-null',
    file: 'test/v2/core/platform/model-choice.test.ts',
    test: MODELS7,
    config: V2,
    ts: {
      file: 'packages/core/src/models.ts',
      from: '[session.tenantId, r.data.agent, alias, session.memberId]',
      to: '[session.tenantId, r.data.agent, alias ?? list.shopDefault ?? cat.defaults[a.role], session.memberId]',
    },
  },
  {
    sabotage: 'v2-m7-choose-default-chain',
    file: 'test/v2/core/platform/model-choice.test.ts',
    test: MODELS8,
    config: V2,
    ts: {
      file: 'packages/core/src/models.ts',
      from: 'alias === null ? allowed.length === 0 : !allowed.includes(alias)',
      to: "!allowed.includes(alias ?? list.shopDefault ?? cat.defaults[a.role] ?? '')",
    },
  },
];
