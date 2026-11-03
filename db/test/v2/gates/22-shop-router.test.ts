// The superadmin's router per shop: ROUTER1 (a shop uses no model off its list: the list narrows
// the deployment's, a role with no list takes the deployment's, the shop's default reads back, and an owner's pick off
// the list is refused), ROUTER2 (a feature the operator turned off is refused where a write exists: the feature's run,
// the brief's narrated line, a memory note; a brief run and another shop are untouched), ROUTER3 (both lists change only
// through an approved platform change of their kind, for exactly that row, audited and chained; the app and the jobs
// role read only their own shop's rows); MS021 reaches core as CoreError feature_off. The console's platform role
// reads both through the functions under the shop's context (ROUTER4); an owner's "Default" pick is a NULL alias
// (ROUTER5). Red-proofs: test/v2/sabotage/purge-router-and-push.ts and test/v2/sabotage/channel-grants-and-budgets.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { toCoreError } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, sha, signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let a: Filled & Books;
let b: Tenant;
let platform: pg.Pool;
let app: pg.Pool;
let jobs: pg.Pool;
let operator: string;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  platform = db.as('munshi_platform');
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  a = await fillTenant(db, await signUp(db, 'router-a'));
  b = await signUp(db, 'router-b');
  // The first operator, seeded as the owner role while none exists (`pnpm platform:operator`).
  const subject = randomUUID();
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(`insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, '{}', now())`, [
      subject,
      sha(subject),
      randomBytes(64),
      randomBytes(16),
    ]);
    const r = await c.query<{ id: string }>(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Operator One', $2) returning id`, [
      subject,
      randomBytes(32),
    ]);
    operator = r.rows[0]?.id as string;
  } finally {
    await c.query('reset role');
    c.release();
  }
  await db.sabotage();
});
afterAll(() => db?.close());

const op = (extra: Record<string, string> = {}) => ({ operator_id: operator, ...extra });
const propose = (kind: string, tenant: string | null, payload: Record<string, unknown>) =>
  tx(platform, op(), async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ($1, $2, $3, $4, 0) returning id`, [
        kind,
        tenant,
        JSON.stringify(payload),
        operator,
      ])
    ).rows[0]?.id as string,
  );
// Approves the change in a later transaction and runs its write there, as the platform role and this operator.
const decide = (change: string, write: (c: pg.PoolClient) => Promise<unknown>) =>
  tx(platform, op({ platform_change_id: change }), async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [change, operator]);
    await write(c);
  });
const insertAllow = (alias: string, role: string, enabled = true) => (c: pg.PoolClient) =>
  c.query(`insert into platform.model_allow (alias, role, enabled, change_id) values ($1, $2, $3, $4)`, [alias, role, enabled, randomUUID()]);
const allow = async (alias: string, role: string, enabled = true) =>
  decide(await propose('model_allow', null, { alias, role, enabled }), insertAllow(alias, role, enabled));
const insertShopModel = (tenant: string, alias: string, role: string, allowed: boolean, isDefault: boolean) => (c: pg.PoolClient) =>
  c.query(`insert into platform.shop_model (tenant_id, alias, role, allowed, is_default, change_id) values ($1, $2, $3, $4, $5, $6)`, [
    tenant,
    alias,
    role,
    allowed,
    isDefault,
    randomUUID(),
  ]);
const shopModel = async (tenant: string, alias: string, role: string, allowed = true, isDefault = false) =>
  decide(await propose('shop_models', tenant, { alias, role, allowed, is_default: isDefault }), insertShopModel(tenant, alias, role, allowed, isDefault));
const insertFeature = (tenant: string, feature: string, enabled: boolean) => (c: pg.PoolClient) =>
  c.query(`insert into platform.shop_feature (tenant_id, feature, enabled, change_id) values ($1, $2, $3, $4)`, [tenant, feature, enabled, randomUUID()]);
const feature = async (tenant: string, name: string, enabled: boolean) =>
  decide(await propose('shop_features', tenant, { feature: name, enabled }), insertFeature(tenant, name, enabled));
const models = (t: { tenant: string }, pool = app) =>
  tx(pool, { tenant_id: t.tenant }, async (c) => (await c.query('select role, alias, is_default, source from ai.shop_models() order by role, alias')).rows);
const features = (t: { tenant: string }, pool = app) =>
  tx(pool, { tenant_id: t.tenant }, async (c) =>
    Object.fromEntries((await c.query<{ feature: string; enabled: boolean }>('select feature, enabled from ai.shop_features()')).rows.map((r) => [r.feature, r.enabled])),
  );
const choose = (t: Tenant, agent: string, alias: string) =>
  tx(app, { tenant_id: t.tenant, actor_id: t.owner, command: 'model.choose' }, (c) =>
    c.query(`insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, $2, $3, $4)`, [t.tenant, agent, alias, t.owner]),
  );

it('a shop uses no model off its list: its list narrows the deployment’s, a role with no list takes the deployment’s, its default reads back, and an owner’s pick off the list is refused', async () => {
  for (const alias of ['reason-a', 'reason-b', 'reason-c']) await allow(alias, 'reason');
  await allow('vision-a', 'vision');
  const deployment = [
    { role: 'reason', alias: 'reason-a', is_default: false, source: 'deployment' },
    { role: 'reason', alias: 'reason-b', is_default: false, source: 'deployment' },
    { role: 'reason', alias: 'reason-c', is_default: false, source: 'deployment' },
    { role: 'vision', alias: 'vision-a', is_default: false, source: 'deployment' },
  ];
  expect(await models(a)).toEqual(deployment);
  // Shop A's own list for reason: two aliases, reason-b its default; vision keeps the deployment's.
  await shopModel(a.tenant, 'reason-a', 'reason');
  await shopModel(a.tenant, 'reason-b', 'reason', true, true);
  const listed = [
    { role: 'reason', alias: 'reason-a', is_default: false, source: 'shop' },
    { role: 'reason', alias: 'reason-b', is_default: true, source: 'shop' },
    { role: 'vision', alias: 'vision-a', is_default: false, source: 'deployment' },
  ];
  expect(await models(a)).toEqual(listed);
  expect(await models(a, jobs)).toEqual(listed);
  expect(await models(b)).toEqual(deployment); // another shop keeps the deployment's
  // An owner's pick off the shop's list is refused, though the deployment enables it; on the list it is taken.
  expect((await refused(choose(a, 'ask', 'reason-c'))).code).toBe('MS007');
  await choose(a, 'ask', 'reason-a');
  await choose(b, 'ask', 'reason-c');
  // The shop takes reason-a off its list: gone from its models and its picks; the deployment still bounds the shop.
  await shopModel(a.tenant, 'reason-a', 'reason', false);
  await allow('reason-b', 'reason', false);
  expect(await models(a)).toEqual([{ role: 'vision', alias: 'vision-a', is_default: false, source: 'deployment' }]);
  expect((await refused(choose(a, 'ask', 'reason-a'))).code).toBe('MS007');
  expect((await refused(choose(a, 'ask', 'reason-b'))).code).toBe('MS007');
  // A default is an allowed row: never one the shop is not allowed.
  expect((await refused(shopModel(a.tenant, 'reason-c', 'reason', false, true))).code).toBe('23514');
  // Without a shop in the transaction, nothing is read.
  expect((await refused(tx(app, {}, (c) => c.query('select * from ai.shop_models()')))).code).toBe('MS003');
});

it('a feature the operator turned off is refused where a write exists: its run, the brief’s narrated line, a memory note; a brief run and another shop are untouched', async () => {
  const all = { ask: true, campaign_copy: true, inbox_drafts: true, memory: true, narration: true, photos: true, read_aloud: true, voice: true };
  expect(await features(a)).toEqual(all);
  const run = (t: Tenant, trigger: string, desk: string) =>
    tx(app, { tenant_id: t.tenant, actor_id: t.owner }, (c) => c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, $2, $3)`, [t.tenant, trigger, desk]));
  const runs: [string, string, string][] = [
    ['ask', 'question', 'ask'],
    ['photos', 'photo', 'shelf'],
    ['voice', 'voice', 'voice'],
    ['read_aloud', 'speak', 'speak'],
    ['campaign_copy', 'campaign', 'campaigns'],
    ['inbox_drafts', 'inbox', 'replies'],
  ];
  for (const [, trigger, desk] of runs) await run(a, trigger, desk);
  for (const [name] of runs) await feature(a.tenant, name, false);
  await feature(a.tenant, 'narration', false);
  await feature(a.tenant, 'memory', false);
  expect(await features(a)).toEqual(Object.fromEntries(Object.keys(all).map((k) => [k, false])));
  expect(await features(a, jobs)).toEqual(Object.fromEntries(Object.keys(all).map((k) => [k, false])));
  // Core reads the refusal as feature_off (the surface hides, as for a capability switched off), never a 500.
  const thrown = await run(a, 'question', 'ask').catch((e: unknown) => e);
  expect(toCoreError(thrown)).toMatchObject({ code: 'feature_off', sqlstate: 'MS021' });
  for (const [name, trigger, desk] of runs) {
    const r = await refused(run(a, trigger, desk));
    expect([r.code, r.message], name).toEqual(['MS021', `ai.run refused: the operator has turned this shop's ${name} off`]);
    await run(b, trigger, desk); // another shop's are on
  }
  // A brief's run, a watcher's and a recipe's are no feature's.
  await tx(jobs, { tenant_id: a.tenant }, (c) => c.query(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'brief', 'brief')`, [a.tenant]));
  await run(a, 'recipe', 'recipe');
  // The brief's narrated line (the jobs role) is refused; an abstained answer of another kind is not.
  const line = (kind: string) =>
    tx(jobs, { tenant_id: a.tenant }, (c) =>
      c.query(`insert into ai.answer (tenant_id, run_id, kind, verdict) values ($1, $2, $3, 'abstained')`, [a.tenant, a.jobsRun, kind]),
    );
  expect((await refused(line('brief_line'))).code).toBe('MS021');
  await line('explain');
  // A memory note, written as the person would (its words a text of this transaction).
  const note = () =>
    tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
      const t = (
        await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, 'Prefers morning deliveries', 'member', '\\x00') returning id`, [
          a.tenant,
        ])
      ).rows[0]?.id;
      await c.query(`insert into ai.memory (tenant_id, kind, text_id, decision_id, valid_to) values ($1, 'note', $2, $3, now() + interval '30 days')`, [
        a.tenant,
        t,
        a.decision,
      ]);
    });
  expect((await refused(note())).code).toBe('MS021');
  // Turned back on, the latest row wins.
  await feature(a.tenant, 'memory', true);
  await feature(a.tenant, 'ask', true);
  await note();
  await run(a, 'question', 'ask');
});

it('both lists change only through an approved change of their kind for exactly that row, audited and chained; the app and the jobs role read only their own shop’s', async () => {
  // No change, another kind's change, a change for another shop, a payload that differs: refused (MS017).
  expect((await refused(tx(platform, op(), insertFeature(a.tenant, 'voice', true)))).code).toBe('MS017');
  const proposed = await propose('shop_features', a.tenant, { feature: 'voice', enabled: true });
  expect((await refused(tx(platform, op({ platform_change_id: proposed }), insertFeature(a.tenant, 'voice', true)))).code, 'not approved').toBe('MS017');
  const wrongKind = await propose('shop_models', a.tenant, { feature: 'voice', enabled: true });
  expect((await refused(decide(wrongKind, insertFeature(a.tenant, 'voice', true)))).code, 'another kind').toBe('MS017');
  const otherShop = await propose('shop_features', b.tenant, { feature: 'voice', enabled: true });
  expect((await refused(decide(otherShop, insertFeature(a.tenant, 'voice', true)))).code, 'another shop').toBe('MS017');
  const differs = await propose('shop_features', a.tenant, { feature: 'voice', enabled: false });
  expect((await refused(decide(differs, insertFeature(a.tenant, 'voice', true)))).code, 'not the approved payload').toBe('MS017');
  const modelDiffers = await propose('shop_models', a.tenant, { alias: 'reason-a', role: 'reason', allowed: true, is_default: false });
  expect((await refused(decide(modelDiffers, insertShopModel(a.tenant, 'reason-a', 'reason', true, true)))).code).toBe('MS017');
  // A shop-scoped change names its shop.
  expect((await refused(propose('shop_features', null, { feature: 'voice', enabled: true }))).code).toBe('23514');
  // No other role writes either list.
  for (const pool of [app, jobs, db.as('munshi_public'), db.as('munshi_agent')]) {
    expect((await refused(tx(pool, { tenant_id: a.tenant, actor_id: a.owner }, insertFeature(a.tenant, 'voice', true)))).code).toBe('42501');
    expect((await refused(tx(pool, { tenant_id: a.tenant, actor_id: a.owner }, insertShopModel(a.tenant, 'x-model', 'reason', true, false)))).code).toBe('42501');
  }
  // An approved write is chained on the platform chain beside its change, and the chain verifies.
  const ok = await propose('shop_features', a.tenant, { feature: 'voice', enabled: true });
  await decide(ok, insertFeature(a.tenant, 'voice', true));
  const chained = await tx(platform, op(), async (c) =>
    (
      await c.query(`select action, entity from platform.audit_log where change_id = $1 order by seq`, [ok])
    ).rows,
  );
  expect(chained).toEqual([
    { action: 'change.propose', entity: 'platform.change' },
    { action: 'change.approve', entity: 'platform.change' },
    { action: 'shop_feature.insert', entity: 'platform.shop_feature' },
  ]);
  expect((await tx(platform, op(), (c) => c.query('select platform.verify_chain() as broken'))).rows).toEqual([{ broken: null }]);
  // The app and the jobs role read only the transaction's shop's rows; the console reads every shop's. Shop A holds a row
  // of each list (written here, so this test stands alone).
  await shopModel(a.tenant, 'router3-alias', 'reason');
  for (const pool of [app, jobs]) {
    for (const rel of ['platform.shop_feature', 'platform.shop_model']) {
      const { rows } = await tx(pool, { tenant_id: b.tenant }, (c) => c.query(`select count(*)::int as n from ${rel} where tenant_id <> $1`, [b.tenant]));
      expect(rows, rel).toEqual([{ n: 0 }]);
    }
  }
  const { rows } = await tx(platform, op(), (c) => c.query('select count(distinct tenant_id)::int as n from platform.shop_feature'));
  expect(rows[0].n).toBeGreaterThan(0);
});

it('the console reads a shop’s router through the rule itself: under the shop’s context the platform role’s ai.shop_models() and ai.shop_features() answer as the app’s do; with no shop, nothing is read', async () => {
  const c = await signUp(db, 'router4');
  await allow('r4-a', 'reason');
  await allow('r4-b', 'reason');
  await shopModel(c.tenant, 'r4-a', 'reason', true, true);
  await feature(c.tenant, 'voice', false);
  const theirs = await models(c);
  expect(theirs.filter((r) => r.role === 'reason' && r.alias.startsWith('r4-'))).toEqual([{ role: 'reason', alias: 'r4-a', is_default: true, source: 'shop' }]);
  expect(await models(c, platform)).toEqual(theirs);
  expect(await features(c, platform)).toEqual(await features(c));
  expect((await features(c, platform)).voice).toBe(false);
  // Another shop's context reads that shop's, never this one's.
  expect((await models(b, platform)).some((r) => r.alias === 'r4-b' && r.source === 'deployment')).toBe(true);
  for (const fn of ['ai.shop_models()', 'ai.shop_features()']) {
    expect((await refused(tx(platform, {}, (x) => x.query(`select * from ${fn}`)))).code, fn).toBe('MS003');
  }
});

it('an owner’s "Default" pick is a NULL alias: the guard takes it from the active owner under model.choose, still checks a named alias, and the entry names no alias', async () => {
  const c = await signUp(db, 'router5');
  const pick = (member: string, alias: string | null, command = 'model.choose') =>
    tx(app, { tenant_id: c.tenant, actor_id: member, command }, (x) =>
      x.query<{ id: string }>(`insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, 'brief', $2, $3) returning id`, [c.tenant, alias, member]),
    );
  const id = (await pick(c.owner, null)).rows[0]?.id;
  const stored = await tx(app, { tenant_id: c.tenant }, async (x) => ({
    choice: (await x.query('select alias from ops.model_choice where id = $1', [id])).rows,
    entry: (await x.query(`select payload from audit.audit_log where entity_id = $1 and action = 'model.choose'`, [id])).rows,
  }));
  expect(stored).toEqual({ choice: [{ alias: null }], entry: [{ payload: { agent: 'brief' } }] });
  // Default is still the owner's, under model.choose; a named alias is still checked against the lists.
  expect((await refused(pick(c.manager, null))).code).toBe('MS007');
  expect((await refused(pick(c.owner, null, 'customer.create'))).code).toBe('MS007');
  expect((await refused(pick(c.owner, 'r5-nowhere'))).code).toBe('MS007');
});
