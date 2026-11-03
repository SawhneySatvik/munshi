// 22_ai_controls.sql's spend ledger and money cap (W1-C, M1): SPEND1 (a call's spend row, by whom, stamped now), SPEND2
// (append-only), SPEND3 (another shop neither reads nor writes it, RLS forced), SPEND4 (a cost needs its currency),
// SPEND5 (a shop's budget only under an approved ai_budget change for exactly that payload) and SPEND6 (ai.spend_month():
// under, soft at 80% and hard at 100%, exactly, for the transaction's own shop) and SPEND7 (only against the writer's own
// open run), SPEND8 (M7: the app and the jobs role read only their own shop's budget). Red-proofs:
// test/v2/sabotage/spend.ts and test/v2/sabotage/m7.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { sha, signUp, type Tenant } from './fixture.ts';
import { asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
let runA: string;
let runB: string;
let jobsRunA: string;
let staffRunA: string;
let platform: pg.Pool;
let operator: string;

const newRun = (pool: pg.Pool, t: Tenant, actor?: string) =>
  tx(pool, actor ? { tenant_id: t.tenant, actor_id: actor } : { tenant_id: t.tenant }, async (c) =>
    (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, $2, 'ask') returning id`, [t.tenant, actor ? 'question' : 'watcher']))
      .rows[0]?.id as string,
  );

beforeAll(async () => {
  db = await openTestDb();
  platform = db.as('munshi_platform');
  a = await signUp(db, 'spend-a');
  b = await signUp(db, 'spend-b');
  runA = await newRun(db.as('munshi_app'), a, a.owner);
  runB = await newRun(db.as('munshi_app'), b, b.owner);
  jobsRunA = await newRun(db.as('munshi_jobs'), a);
  staffRunA = await newRun(db.as('munshi_app'), a, a.staff);
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
    const r = await c.query<{ id: string }>(`insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, 'Founder', $2) returning id`, [
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

type Spend = { role?: string; alias?: string; tokens_in?: number; tokens_out?: number; tokens_cached?: number; cost?: string | null; currency?: string | null; at?: string };
const SPEND = `insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out, tokens_cached, cost_minor_e6, currency, at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now())) returning id::text, at::text, (at > now() - interval '1 minute') as fresh`;
// The same insert with no RETURNING: a RETURNING row must also pass the policy's USING, so only this form leaves the
// WITH CHECK as the sole barrier.
const SPEND_BARE = SPEND.slice(0, SPEND.indexOf(' returning '));
const params = (t: Tenant, run: string, s: Spend = {}) => [
  t.tenant,
  run,
  s.role ?? 'reason',
  s.alias ?? 'muse-spark',
  s.tokens_in ?? 1000,
  s.tokens_out ?? 100,
  s.tokens_cached ?? 0,
  s.cost === undefined ? '1250000' : s.cost,
  s.currency === undefined ? 'USD' : s.currency,
  s.at ?? null,
];
const spendAs = (t: Tenant, actor: string, s: Spend = {}, run = t === a ? runA : runB) =>
  tx(db.as('munshi_app'), { tenant_id: t.tenant, actor_id: actor }, (c) => c.query<{ id: string; at: string; fresh: boolean }>(SPEND, params(t, run, s)));

it('SPEND1 a call writes its spend row, as the app with an active member or the jobs role with no actor, stamped at now', async () => {
  const app = await spendAs(a, a.owner, { at: '2020-01-01T00:00:00Z' });
  expect(app.rows[0]?.fresh).toBe(true);
  const jobs = await tx(db.as('munshi_jobs'), { tenant_id: a.tenant }, (c) => c.query<{ fresh: boolean }>(SPEND, params(a, jobsRunA)));
  expect(jobs.rows[0]?.fresh).toBe(true);
  // The jobs role with an actor, the app with none, the agent, and the platform role: refused.
  expect((await refused(tx(db.as('munshi_jobs'), { tenant_id: a.tenant, actor_id: a.owner }, (c) => c.query(SPEND, params(a, jobsRunA))))).code).toBe('MS018');
  // The jobs role with an actor is refused as a writer, even on that actor's own run.
  expect((await refused(tx(db.as('munshi_jobs'), { tenant_id: a.tenant, actor_id: a.owner }, (c) => c.query(SPEND, params(a, runA))))).code).toBe('MS018');
  expect((await refused(tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) => c.query(SPEND, params(a, runA))))).code).toBe('MS018');
  for (const role of ['munshi_agent', 'munshi_platform', 'munshi_public', 'munshi_idp']) {
    expect((await refused(tx(db.as(role), { tenant_id: a.tenant }, (c) => c.query(SPEND, params(a, runA))))).code, role).toBe('42501');
  }
  // A run of another shop is not this shop's run.
  expect((await refused(spendAs(a, a.owner, {}, runB))).code).toBe('23503');
  // The app's actor is an active member of the row's shop: an inactive member of this shop is refused; so is shop B's
  // owner, under A's context (A's rows only) and under B's own (where B's members are visible, so only the guard's
  // tenant scope refuses it, before the policy would).
  await plant(db.admin, 'update ops.member set active = false, deactivated_at = now() where tenant_id = $1 and id = $2', [a.tenant, a.staff]);
  expect((await refused(spendAs(a, a.staff, {}, staffRunA))).code, 'inactive member, on their own run').toBe('MS018');
  expect((await refused(spendAs(a, b.owner))).code, "B's owner under A").toBe('MS018');
  const underB = await refused(tx(db.as('munshi_app'), { tenant_id: b.tenant, actor_id: b.owner }, (c) => c.query(SPEND, params(a, runA))));
  expect(underB.code, "B's owner under B, writing A's row").toBe('MS018');
});

it('SPEND2 no role updates or deletes a spend row', async () => {
  await spendAs(a, a.owner);
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_platform', 'munshi_agent']) {
    const ctx = role === 'munshi_app' ? { tenant_id: a.tenant, actor_id: a.owner } : { tenant_id: a.tenant };
    expect((await refused(tx(db.as(role), ctx, (c) => c.query('update ai.spend set tokens_in = 0')))).code, `${role} update`).toBe('42501');
    expect((await refused(tx(db.as(role), ctx, (c) => c.query('delete from ai.spend')))).code, `${role} delete`).toBe('42501');
  }
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ai.spend where tenant_id = $1 and tokens_in = 0', [a.tenant]);
  expect(rows[0]?.n).toBe(0);
});

it("SPEND3 another shop neither reads nor writes a shop's spend rows, the table's owner included (RLS forced)", async () => {
  await spendAs(a, a.owner);
  await spendAs(b, b.owner);
  const own = (await db.admin.query<{ n: number }>('select count(*)::int as n from ai.spend where tenant_id = $1', [b.tenant])).rows[0]?.n;
  expect(own).toBeGreaterThan(0);
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_platform']) {
    const { rows } = await tx(db.as(role), { tenant_id: b.tenant }, (c) =>
      c.query<{ own: number; other: number }>('select count(*) filter (where tenant_id = $1)::int as own, count(*) filter (where tenant_id <> $1)::int as other from ai.spend', [b.tenant]),
    );
    expect(rows[0], role).toEqual({ own, other: 0 });
  }
  const [owner] = await asOwner(db.admin, [`select count(*)::int as n from ai.spend where tenant_id = '${a.tenant}'`], b.tenant);
  expect(owner?.rows[0]?.n).toBe(0);
  // Writing shop A's row under shop B's context. The app's write is refused first by the stamp guard (its actor is no
  // member of A); the jobs role with no actor passes the guard, so the policy's WITH CHECK alone refuses its insert
  // (with no RETURNING, which USING would also refuse).
  const app = await refused(tx(db.as('munshi_app'), { tenant_id: b.tenant, actor_id: b.owner }, (c) => c.query(SPEND, params(a, runA))));
  expect(app.code).toBe('MS018');
  const jobs = await refused(tx(db.as('munshi_jobs'), { tenant_id: b.tenant }, (c) => c.query(SPEND_BARE, params(a, jobsRunA))));
  expect(jobs).toEqual({ code: '42501', message: 'new row violates row-level security policy for table "spend"' });
  const { rows } = await tx(db.as('munshi_jobs'), {}, (c) => c.query<{ n: number }>('select count(*)::int as n from ai.spend'));
  expect(rows[0]?.n).toBe(0);
});

it('SPEND4 a cost needs its currency and a currency its cost; an unpriced call has neither; nothing is negative, no cost past 10^15', async () => {
  const unpriced = await spendAs(a, a.owner, { cost: null, currency: null });
  expect(unpriced.rows).toHaveLength(1);
  expect((await spendAs(a, a.owner, { cost: '1000000000000000' })).rows).toHaveLength(1);
  for (const [s, why] of [
    [{ cost: '1250000', currency: null }, 'a cost without a currency'],
    [{ cost: null, currency: 'USD' }, 'a currency without a cost'],
    [{ cost: '-1' }, 'a negative cost'],
    [{ cost: '1000000000000001' }, 'a cost past 10^15 millionths (a units bug)'],
    [{ currency: 'usd' }, 'a currency that is not an ISO code'],
    [{ tokens_in: -1 }, 'negative tokens in'],
    [{ tokens_out: -1 }, 'negative tokens out'],
    [{ tokens_cached: -1 }, 'negative cached tokens'],
    [{ role: 'painter' }, 'a role ai.usage does not take'],
    [{ alias: 'Some_Provider/Model' }, 'an alias model_allow could not spell'],
  ] as [Spend, string][]) {
    expect((await refused(spendAs(a, a.owner, s))).code, why).toBe('23514');
  }
});

const op = (extra: Record<string, string> = {}) => ({ operator_id: operator, ...extra });
// Proposed in one transaction; decided, then `write` run, in a later one, as the platform role and this operator.
async function approved(kind: string, tenant: string | null, payload: Record<string, unknown>, write: (c: pg.PoolClient) => Promise<unknown>) {
  const id = await tx(platform, op(), async (c) =>
    (
      await c.query<{ id: string }>(`insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid) values ($1, $2, $3, $4, 0) returning id`, [
        kind,
        tenant,
        JSON.stringify(payload),
        operator,
      ])
    ).rows[0]?.id as string,
  );
  await tx(platform, op({ platform_change_id: id }), async (c) => {
    await c.query(`update platform.change set verdict = 'approved', decided_by = $2, decided_at = now(), decided_txid = 0 where id = $1`, [id, operator]);
    await write(c);
  });
  return id;
}
type Budget = { monthly_minor: number | null; currency: string | null };
const writeBudget = (t: Tenant, budget: Budget) => (c: pg.PoolClient) =>
  c.query(`insert into platform.ai_budget (tenant_id, monthly_minor, currency, change_id) values ($1, $2, $3, $4)`, [t.tenant, budget.monthly_minor, budget.currency, randomUUID()]);
const setBudget = (t: Tenant, budget: Budget) => approved('ai_budget', t.tenant, budget, writeBudget(t, budget));

it('SPEND5 a shop’s AI budget is written only under an approved ai_budget change for exactly that payload, and chained', async () => {
  const budget = { monthly_minor: 50000, currency: 'USD' };
  // No change, a change of another kind, another amount, another shop: refused.
  expect((await refused(tx(platform, op(), (c) => writeBudget(a, budget)(c)))).code).toBe('MS017');
  const shopConfig = { ai_enabled: true, ai_daily_calls: 60, media_daily_calls: 20, site_verified: false };
  expect((await refused(approved('shop_config', a.tenant, shopConfig, writeBudget(a, budget)))).code).toBe('MS017');
  // A shop_config change whose payload is exactly the budget's keys: refused by its kind alone.
  expect((await refused(approved('shop_config', a.tenant, budget, writeBudget(a, budget)))).code, 'another kind, same keys').toBe('MS017');
  expect((await refused(approved('ai_budget', a.tenant, budget, writeBudget(a, { ...budget, monthly_minor: 100000 })))).code).toBe('MS017');
  expect((await refused(approved('ai_budget', a.tenant, budget, writeBudget(b, budget)))).code).toBe('MS017');
  for (const role of ['munshi_app', 'munshi_jobs']) {
    expect((await refused(tx(db.as(role), { tenant_id: a.tenant }, (c) => writeBudget(a, budget)(c)))).code, role).toBe('42501');
  }
  // An ai_budget change names its shop, and its payload is bounded like every change's (CH1): 100000 minor units.
  expect((await refused(tx(platform, op(), (c) => c.query(`insert into platform.change (kind, payload, proposed_by, proposed_txid) values ('ai_budget', $1, $2, 0)`, [JSON.stringify(budget), operator])))).code).toBe('23514');
  expect((await refused(approved('ai_budget', a.tenant, { monthly_minor: 500000, currency: 'INR' }, writeBudget(a, { monthly_minor: 500000, currency: 'INR' })))).code).toBe('23514');

  const id = await setBudget(a, budget);
  const { rows } = await tx(db.as('munshi_app'), { tenant_id: a.tenant }, (c) =>
    c.query('select monthly_minor::int, currency, change_id::text from platform.ai_budget where tenant_id = $1 order by effective_from desc, id desc limit 1', [a.tenant]),
  );
  expect(rows).toEqual([{ monthly_minor: 50000, currency: 'USD', change_id: id }]);
  const chain = await db.admin.query<{ action: string }>(`select action from platform.audit_log where change_id = $1 order by seq`, [id]);
  expect(chain.rows.map((r) => r.action)).toEqual(['change.propose', 'change.approve', 'ai_budget.insert']);
  // The same change, a transaction later: refused.
  expect((await refused(tx(platform, op({ platform_change_id: id }), (c) => writeBudget(a, budget)(c)))).code).toBe('MS017');
});

type Month = { budget_minor: string | null; currency: string | null; spent_minor_e6: string | null; spent_minor: string | null; calls: number; unpriced_calls: number; other_currency_calls: number; state: string };
const month = (t: Tenant, role = 'munshi_app') =>
  tx(db.as(role), { tenant_id: t.tenant }, async (c) => (await c.query<Month>('select * from ai.spend_month()')).rows);

// The shop's month, computed here from the IANA zone (Intl), independently of the SQL: the instants of local midnight on
// this month's 1st and the next month's 1st.
const offsetMs = (instant: number, zone: string) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return Date.UTC(p.year as number, (p.month as number) - 1, p.day, p.hour, p.minute, p.second) - instant;
};
const localMidnight = (year: number, month0: number, zone: string) => {
  const wall = Date.UTC(year, month0, 1);
  return wall - offsetMs(wall - offsetMs(wall, zone), zone);
};
const monthOf = (zone: string, now = Date.now()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return { from: localMidnight(p.year as number, (p.month as number) - 1, zone), to: localMidnight(p.year as number, p.month as number, zone) };
};
const windowOf = async (t: Tenant) => {
  const r = (await tx(db.as('munshi_app'), { tenant_id: t.tenant }, (c) => c.query<{ f: Date; t: Date }>('select month_from as f, month_to as t from ai.spend_month()'))).rows[0];
  return { from: r?.f.getTime(), to: r?.t.getTime() };
};

it('SPEND6 ai.spend_month() reads under, soft from 80% and hard from 100% of the budget, exactly, in its currency, for this shop only', async () => {
  // The month is the shop's own: an IST shop's, and a New York shop's (its zone planted), each to the millisecond.
  const ny = await signUp(db, 'spend-month-ny');
  await plant(db.admin, `update ops.tenant set time_zone = 'America/New_York' where tenant_id = $1`, [ny.tenant]);
  expect(await windowOf(ny), 'America/New_York').toEqual(monthOf('America/New_York'));
  expect(await windowOf(a), 'Asia/Kolkata').toEqual(monthOf('Asia/Kolkata'));
  expect(monthOf('America/New_York').from).not.toBe(monthOf('Asia/Kolkata').from);

  const shop = await signUp(db, 'spend-month');
  const run = await newRun(db.as('munshi_app'), shop, shop.owner);
  const spend = (cost: string | null, currency: string | null = 'USD') =>
    tx(db.as('munshi_app'), { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query(SPEND, params(shop, run, { cost, currency })));
  const state = async () => (await month(shop))[0];

  // No budget: no money cap.
  await spend('5000000');
  expect(await state()).toMatchObject({ budget_minor: null, currency: null, spent_minor_e6: null, calls: 1, other_currency_calls: 1, state: 'under' });

  await setBudget(shop, { monthly_minor: 1000, currency: 'USD' });
  // A row of last month, a second before the shop's month began (planted: the guard stamps now()), is not this month's.
  const from = new Date(monthOf('Asia/Kolkata').from).toISOString();
  await plant(
    db.admin,
    `insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out, cost_minor_e6, currency, at)
     values ($1, $2, 'reason', 'muse-spark', 1, 1, 900000000, 'USD', $3::timestamptz - interval '1 second')`,
    [shop.tenant, run, from],
  );
  // 5.000000 so far; to 799.999999: under, shown rounded up as 800.
  await spend('794999999');
  expect(await state()).toMatchObject({ budget_minor: '1000', currency: 'USD', spent_minor_e6: '799999999', spent_minor: '800', calls: 2, state: 'under' });
  // An unpriced call and a call priced in another currency are counted apart, never summed.
  await spend(null, null);
  await spend('900000000', 'INR');
  expect(await state()).toMatchObject({ spent_minor_e6: '799999999', calls: 4, unpriced_calls: 1, other_currency_calls: 1, state: 'under' });
  await spend('1');
  expect(await state()).toMatchObject({ spent_minor_e6: '800000000', spent_minor: '800', state: 'soft' });
  await spend('199999999');
  expect(await state()).toMatchObject({ spent_minor_e6: '999999999', spent_minor: '1000', state: 'soft' });
  await spend('1');
  expect(await state()).toMatchObject({ spent_minor_e6: '1000000000', spent_minor: '1000', state: 'hard' });

  // A budget of 0 is hard at once; a later NULL budget lifts the cap (latest wins).
  await setBudget(shop, { monthly_minor: 0, currency: 'USD' });
  expect((await state())?.state).toBe('hard');
  await setBudget(shop, { monthly_minor: null, currency: null });
  expect(await state()).toMatchObject({ budget_minor: null, state: 'under' });

  // Each role allow() and the console run as reads it; the shop's own figures only; no context, no answer.
  for (const role of ['munshi_jobs', 'munshi_platform']) expect((await month(shop, role))[0]?.calls, role).toBe(7);
  expect((await month(b))[0]).toMatchObject({ budget_minor: null, state: 'under' });
  expect((await refused(tx(db.as('munshi_app'), {}, (c) => c.query('select * from ai.spend_month()')))).code).toBe('MS003');
  for (const role of ['munshi_agent', 'munshi_public', 'munshi_idp']) {
    expect((await refused(tx(db.as(role), { tenant_id: shop.tenant }, (c) => c.query('select * from ai.spend_month()')))).code, role).toBe('42501');
  }
});

it("SPEND7 a call's spend is written only against the writer's own open run", async () => {
  const shop = await signUp(db, 'spend-run');
  const app = db.as('munshi_app');
  const ownerRun = await newRun(app, shop, shop.owner);
  const managerRun = await newRun(app, shop, shop.manager);
  const jobsRun = await newRun(db.as('munshi_jobs'), shop);
  const asMember = (actor: string, run: string) =>
    tx(app, { tenant_id: shop.tenant, actor_id: actor }, (c) => c.query<{ id: string }>(SPEND, params(shop, run)));
  const asJobs = (run: string) => tx(db.as('munshi_jobs'), { tenant_id: shop.tenant }, (c) => c.query<{ id: string }>(SPEND, params(shop, run)));

  // Each writer on its own open run: taken (the jobs role's is how a brief's narration is billed, inside its open run).
  expect((await asMember(shop.owner, ownerRun)).rows).toHaveLength(1);
  expect((await asJobs(jobsRun)).rows).toHaveLength(1);
  // Another member's run, a jobs run for the app, and a member's run for the jobs role: refused.
  expect((await refused(asMember(shop.owner, managerRun))).code, "the manager's run").toBe('MS018');
  expect((await refused(asMember(shop.owner, jobsRun))).code, 'a jobs run, by the app').toBe('MS018');
  expect((await refused(asJobs(ownerRun))).code, "the owner's run, by the jobs role").toBe('MS018');
  // Once a run has ended, no more spend on it, by its own starter either.
  await tx(app, { tenant_id: shop.tenant, actor_id: shop.owner }, (c) => c.query(`update ai.run set ended_at = now(), outcome = 'answered' where id = $1`, [ownerRun]));
  await tx(db.as('munshi_jobs'), { tenant_id: shop.tenant }, (c) => c.query(`update ai.run set ended_at = now(), outcome = 'raised' where id = $1`, [jobsRun]));
  expect((await refused(asMember(shop.owner, ownerRun))).code, "the owner's ended run").toBe('MS010');
  expect((await refused(asJobs(jobsRun))).code, 'an ended jobs run').toBe('MS010');
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ai.spend where tenant_id = $1', [shop.tenant]);
  expect(rows[0]?.n).toBe(2);
});

it("SPEND8 the app and the jobs role read only their own shop's budget, and ai.spend_month() still reads it there; the console reads every shop's", async () => {
  const [one, two] = [await signUp(db, 'spend-own-one'), await signUp(db, 'spend-own-two')];
  await setBudget(one, { monthly_minor: 700, currency: 'USD' });
  await setBudget(two, { monthly_minor: 900, currency: 'USD' });
  const read = (role: string, ctx: Record<string, string>) =>
    tx(db.as(role), ctx, async (c) =>
      (await c.query<{ tenant_id: string; monthly_minor: string }>('select tenant_id::text, monthly_minor::text from platform.ai_budget where tenant_id = any($1) order by monthly_minor', [[one.tenant, two.tenant]])).rows,
    );
  for (const role of ['munshi_app', 'munshi_jobs']) {
    expect(await read(role, { tenant_id: one.tenant }), role).toEqual([{ tenant_id: one.tenant, monthly_minor: '700' }]);
    expect(await read(role, {}), `${role} with no shop`).toEqual([]);
    expect((await month(two, role))[0]?.budget_minor, role).toBe('900');
  }
  expect(await read('munshi_platform', op())).toEqual([
    { tenant_id: one.tenant, monthly_minor: '700' },
    { tenant_id: two.tenant, monthly_minor: '900' },
  ]);
  const { rows } = await db.admin.query<{ qual: string; roles: string[]; permissive: boolean; cmd: string }>(
    `select pg_get_expr(p.polqual, p.polrelid) as qual, array(select r::regrole::text from unnest(p.polroles) r order by 1) as roles, p.polpermissive as permissive, p.polcmd::text as cmd
       from pg_policy p where p.polrelid = 'platform.ai_budget'::regclass and p.polname = 'own_shop'`,
  );
  expect(rows).toEqual([
    { qual: "(tenant_id = ( SELECT (NULLIF(current_setting('munshi.tenant_id'::text, true), ''::text))::uuid AS \"nullif\"))", roles: ['munshi_app', 'munshi_jobs'], permissive: false, cmd: 'r' },
  ]);
});
