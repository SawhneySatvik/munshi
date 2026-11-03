// D-082, one rule for what each role may read, over the real database: core's map (packages/core/src/read-roles.ts) is
// enforced where every snapshot is minted, so counter staff are refused the office's reads (salary, settlements, the
// report) and anything minted under a switched-off capability is refused for everyone; the map names every registered
// read, and Ask's desks offer each role only reads that role may make; a staff question the router sends to a desk
// outside their role abstains and reads nothing. Model turns are hand-written and replayed from
// packages/agent/fixtures/d082 (packages/agent/test/script.ts). Red-proofs: test/v2/sabotage/roles.ts.
import {
  ASK_DESKS,
  askerIn,
  businessDate,
  CAPABILITIES,
  CoreError,
  hiddenColumns,
  MEMBER_ROLES,
  mintSnapshot,
  READ_ROLES,
  roleMayRead,
  rowsFor,
  SCREENS,
  type Session,
  storedSnapshots,
  switchCapability,
  WATCHERS,
  withPage,
  withTx,
} from '@munshi/core';
import { paypalAuthority } from '@munshi/core/paypal';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { AskerScope, FindingRow } from '../../../../../packages/agent/src/port.ts';
import { RECIPE_READS, RECIPES } from '../../../../../packages/agent/src/recipes.ts';
import { ask, EXPLAINED_KINDS, FINDING_DESK } from '../../../../../packages/agent/src/run.ts';
import { DESK_TOOLS, DESKS, toolsFor } from '../../../../../packages/agent/src/tools.ts';
import { prepare, scripted, type Turn } from '../../../../../packages/agent/test/script.ts';
import { PAYPAL_QUERIES } from '../../../../../packages/core/src/queries-paypal.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { mintIn } from '../../../../../packages/core/src/snapshots.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { type Shop, smallShop } from '../shop.ts';

const SUITE = 'd082';
// The business date a question is asked on: fixed, since the desk's prompt (and so its recorded fixture) names it.
const ASKED_ON = '2026-10-27';

let db: TestDb;
let app: pg.Pool;
let a: Shop;
let today: string;
beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  app = db.as('munshi_app');
  a = await smallShop(app, 'A');
  const tz = (await db.admin.query<{ tz: string }>('select time_zone as tz from ops.tenant where tenant_id = $1', [a.owner.tenantId])).rows[0]?.tz;
  today = businessDate(new Date(), tz);
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const mint = (s: Session, name: string, params: unknown) => mintSnapshot(app, { kind: 'member', session: s }, name, params);
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const snapshots = async () =>
  Number((await db.admin.query<{ n: string }>('select count(*)::text as n from snap.snapshot where tenant_id = $1', [a.owner.tenantId])).rows[0]?.n);
const day = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

it('R1 counter staff are refused the salary, settlement and report reads in core; the office makes them; nothing is minted', async () => {
  const office: [string, Record<string, unknown>][] = [
    ['settlements.reconcile', { from: day(-7), to: day(-1) }],
    ['sales.week_total', { from: day(-6), to: today }],
    ['sales.by_day', { from: day(-1), to: day(-1) }], // yesterday's report: not the counter's window
    ['sales.by_item', { from: day(-90), to: day(-1), limit: 10 }],
    ['purchases.last_prices', {}],
  ];
  const before = await snapshots();
  for (const [name, params] of [...office, ['salary.preview', { period_start: day(-30), period_end: day(-1) }] as const, ['staff.advances', { staff_id: a.supplier }] as const]) {
    const e = await failure(mint(a.staff, name, params));
    expect(e, name).toBeInstanceOf(CoreError);
    expect(e, name).toMatchObject({ code: 'not_for_role' });
  }
  expect(await snapshots()).toBe(before);
  // The owner and a manager make the office's reads.
  for (const s of [a.owner, a.manager]) for (const [name, params] of office) expect((await mint(s, name, params)).name, name).toBe(name);
  // Staff still read the counter's window (today's takings, the quick tiles), the credit book and stock.
  for (const [name, params] of [
    ['sales.by_day', { from: today, to: today }],
    ['sales.by_item', { from: day(-27), to: today, limit: 8 }],
    ['credit.balances', { as_of: today }],
    ['stock.on_hand', { item_id: a.biscuits }],
  ] as const) {
    expect((await mint(a.staff, name, params)).name, name).toBe(name);
  }
  // The same gate holds for a staff member's agent run (evidence snapshots): the run's read is refused.
  const runId = await startRun({ app, agent: db.as('munshi_agent') }, a.staff);
  const { port } = agentPort({ app, agent: db.as('munshi_agent') }, a.staff, runId);
  expect(await failure(port.read('settlements.reconcile', { from: day(-7), to: day(-1) }))).toMatchObject({ code: 'not_for_role' });
  // Fail closed: a transaction core's withTx did not open, its context naming the staff member, is gated all the same
  // (the actor read from the transaction's own context).
  const raw = (actor: string) =>
    tx(app, { tenant_id: a.owner.tenantId, actor_id: actor }, (c) => mintIn(c, 'settlements.reconcile', { from: day(-7), to: day(-1) }));
  expect(await failure(raw(a.staff.memberId))).toMatchObject({ code: 'not_for_role' });
  expect((await raw(a.manager.memberId)).name).toBe('settlements.reconcile');
  expect(await snapshots()).toBeGreaterThan(before);
});

it("R3 every named read has a role entry, and Ask's desks offer each role only reads it may make", async () => {
  const registered = [...QUERIES.keys(), ...PAYPAL_QUERIES.map(([name]) => name)].sort();
  expect(Object.keys(READ_ROLES).sort()).toEqual([...new Set(registered)].sort());
  for (const [name, rule] of Object.entries(READ_ROLES)) {
    expect(rule.roles.length, name).toBeGreaterThan(0);
    expect(rule.roles, name).toContain('owner');
    for (const r of rule.roles) expect(MEMBER_ROLES, name).toContain(r);
    if (rule.cap !== null) expect(CAPABILITIES, name).toContain(rule.cap);
  }
  // A watcher's read keys on the capability that runs it.
  for (const w of WATCHERS) expect(READ_ROLES[w.query]?.cap, w.query).toBe(w.needs);
  expect(Object.keys(ASK_DESKS).sort()).toEqual([...DESKS].sort());
  for (const role of MEMBER_ROLES) {
    // Every capability on: the widest scope a role can have, built as core's askerIn builds it.
    const scope: AskerScope = {
      reads: new Set(Object.keys(READ_ROLES).filter((n) => roleMayRead(role, n))),
      desks: new Set(Object.entries(ASK_DESKS).flatMap(([d, rule]) => ((rule.roles as readonly string[]).includes(role) ? [d] : []))),
    };
    for (const desk of DESKS) {
      const tools = toolsFor(desk, scope);
      if (!scope.desks.has(desk)) continue;
      // A desk open to the role keeps a read of its own for it (not only one it shares with another desk).
      const own = tools.filter((t) => DESKS.every((d) => d === desk || !DESK_TOOLS[d].includes(t)));
      expect(own.length, `${role} ${desk}`).toBeGreaterThan(0);
      for (const t of tools) expect(roleMayRead(role, t.query), `${role} ${desk} ${t.name}`).toBe(true);
    }
    expect([...scope.desks].sort(), role).toEqual(role === 'staff' ? ['credit', 'stock'] : ['credit', 'sales', 'stock']);
    // Whoever sees a finding whole (Why? hands a model its row) may ask its desk.
    for (const kind of EXPLAINED_KINDS) {
      const w = WATCHERS.find((x) => x.kind === kind);
      if (w && roleMayRead(role, w.query) && hiddenColumns(role, w.query).length === 0) expect(scope.desks.has(FINDING_DESK[kind] as string), `${role} ${kind}`).toBe(true);
    }
    // No tool hands a role a column it is not sent.
    for (const desk of DESKS) for (const t of toolsFor(desk, scope)) expect(hiddenColumns(role, t.query), `${role} ${t.name}`).toEqual([]);
  }
  const staff = { reads: new Set(Object.keys(READ_ROLES).filter((n) => roleMayRead('staff', n))), desks: new Set(['stock', 'credit']) };
  expect(toolsFor('stock', staff).map((t) => t.name)).toEqual(['items_list', 'stock_on_hand', 'stock_below_reorder']);
  // Staff: the counter, the credit book and stock; the stock findings without what the stock cost.
  expect([...staff.reads].sort()).toEqual(
    [
      'count.shelf',
      'credit.balance',
      'credit.balances',
      'items.list',
      'items.price',
      'loyalty.balance',
      'package.balance',
      'sale.quote',
      'sale.quote_offers',
      'sale.receipt',
      'stock.available',
      'stock.below_reorder',
      'stock.on_hand',
      'watch.dead_stock',
      'watch.expiry',
      'watch.shrinkage',
    ].sort(),
  );
  expect(hiddenColumns('staff', 'watch.shrinkage')).toEqual(['unit_cost', 'loss']);
  expect(hiddenColumns('staff', 'watch.expiry')).toEqual(['unit_cost', 'at_risk_value']);
  expect(hiddenColumns('staff', 'watch.dead_stock')).toEqual(['unit_cost', 'stock_value']);
  for (const role of ['owner', 'manager']) for (const q of QUERIES.keys()) expect(hiddenColumns(role, q)).toEqual([]);
  // The screens with no read of their own are in the map too, the office's, and named apart from every read.
  for (const [name, rule] of Object.entries(SCREENS)) {
    expect(name.startsWith('screen.') && !QUERIES.has(name), name).toBe(true);
    expect(rule.roles, name).not.toContain('staff');
  }
  // RECIPE_READS names every read each recipe's source can make, read statically from recipes.ts.
  const source = readFileSync(new URL('../../../../../packages/agent/src/recipes.ts', import.meta.url), 'utf8');
  const wired = Object.fromEntries([...(/RECIPES[^=]*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '').matchAll(/(\w+):\s*(\w+)/g)].map((m) => [m[1], m[2]]));
  expect(Object.keys(wired).sort()).toEqual(Object.keys(RECIPES).sort());
  for (const [kind, fn] of Object.entries(wired)) {
    const body = new RegExp(`const ${fn}: Recipe = [\\s\\S]*?\\n};`).exec(source)?.[0] ?? '';
    expect(body, kind).not.toBe('');
    const reads = [...new Set([...body.matchAll(/read\("([a-z_.]+)"/g)].map((m) => m[1]))].sort();
    expect(reads, kind).toEqual([...(RECIPE_READS[kind] ?? [])].sort());
  }
  // And each recipe, run down every branch, asks for nothing else.
  const t = (txt: string) => ({ kind: 'text', txt }) as const;
  const money = { kind: 'money', num: '1000', currency: 'INR' } as const;
  const f: FindingRow = {
    id: a.customer,
    kind: '',
    snapshotId: a.customer,
    row: 0,
    cells: { item_id: t(a.biscuits), customer_id: t(a.customer), holding_id: t(a.customer), days_left: { kind: 'integer', num: '3' } },
    status: 'open',
    current: true,
    openDraft: false,
  };
  for (const [kind, recipe] of Object.entries(RECIPES)) {
    // Before and after a package's expiry (its two branches), with rows and with none.
    for (const days of ['3', '-3'])
      for (const empty of [false, true]) {
        const asked: string[] = [];
        await recipe({ ...f, kind, cells: { ...f.cells, days_left: { kind: 'integer', num: days } } }, async (query) => {
          asked.push(query);
          const row = { supplier_id: t(a.supplier), qty: { kind: 'quantity', num: '1000', unit: 'pack' }, on_hand: { kind: 'quantity', num: '1', unit: 'pack' }, balance: money, value_left: money } as const;
          return { snapshotId: a.customer, rows: empty ? [] : [row] };
        });
        for (const q of asked) expect(RECIPE_READS[kind], `${kind} ${q}`).toContain(q);
      }
  }
});

const route = (desk: string): Turn => ({ json: { desk } });
const call = (name: string, args: unknown = {}): Turn => ({ tools: [{ name, args }] });

it('R4 a staff question routed to a desk outside their role abstains and reads nothing; their stock desk offers no bill read', async () => {
  const pools = { app, agent: db.as('munshi_agent') };
  const staffRun = async () => {
    const runId = await startRun(pools, a.staff);
    const { port, events } = agentPort(pools, a.staff, runId);
    const scope = async (): Promise<AskerScope> => {
      const asker = await withTx(app, { kind: 'member', session: a.staff }, (c) => askerIn(c));
      return { reads: asker?.reads ?? new Set(), desks: asker?.desks ?? new Set() };
    };
    return { runId, port: { ...port, scope }, events };
  };
  const minted = async (runId: string) => Number((await db.admin.query<{ n: string }>('select count(*)::text as n from snap.snapshot where run_id = $1', [runId])).rows[0]?.n);

  // The router (shown only stock and credit) sends the question to sales anyway: abstained, nothing read.
  const first = await staffRun();
  const s1 = scripted(SUITE, [route('sales')]);
  const reply = await ask('What were the takings last month?', { port: first.port, asOf: ASKED_ON, deps: s1.deps });
  expect(s1.left()).toBe(0);
  expect(reply).toEqual({ kind: 'abstain', specialist: null, missing: ['not_for_role'] });
  expect(first.events.map((e) => [e.kind, e.label])).toContainEqual(['abstain', 'not_for_role']);
  expect(first.events.some((e) => e.kind === 'read')).toBe(false);
  expect(await minted(first.runId)).toBe(0);

  // On their own desk, a bill read is no tool of theirs: refused before any read.
  const second = await staffRun();
  const s2 = scripted(SUITE, [route('stock'), call('bills_recent', { days: 7 }), { text: 'No read answered it.' }, { json: { segments: [] } }]);
  const again = await ask('What did we buy this week?', { port: second.port, asOf: ASKED_ON, deps: s2.deps });
  expect(s2.left()).toBe(0);
  expect(again).toEqual({ kind: 'abstain', specialist: 'stock', missing: ['no_answer'] });
  expect(second.events.map((e) => [e.kind, e.label])).toContainEqual(['read', 'unknown_tool']);
  expect(await minted(second.runId)).toBe(0);
});

it('R7 a stored snapshot reaches a member only if their role may read it, each row cut to their columns; staff get no "Record this payment"', async () => {
  const office = await mint(a.owner, 'purchases.last_prices', {});
  const theirs = await mint(a.staff, 'stock.on_hand', { item_id: a.biscuits });
  const stored = (s: Session) => withPage(app, s, (c) => storedSnapshots(c, [office.id, theirs.id]));
  // However the id reaches a view (a draft's ref, a photo replayed, a PayPal draft's figure), the office's is dropped.
  expect((await stored(a.staff)).map((s) => s.query)).toEqual(['stock.on_hand']);
  expect((await stored(a.manager)).map((s) => s.query)).toEqual(['purchases.last_prices', 'stock.on_hand']);
  expect(rowsFor('staff', 'watch.shrinkage', [{ item: 1, missing: 4, unit_cost: 2, loss: 3 }])).toEqual([{ item: 1, missing: 4 }]);
  expect(rowsFor('manager', 'watch.shrinkage', [{ item: 1, unit_cost: 2 }])).toEqual([{ item: 1, unit_cost: 2 }]);
  // Staff hold payment.record (the counter takes payments) but may not read PayPal's notification a record cites.
  const authority = (s: Session) => withPage(app, s, (c) => paypalAuthority(c, s.memberId));
  expect((await authority(a.staff)).canRecord).toBe(false);
  expect((await authority(a.manager)).canRecord).toBe(true);
});

it("R6 a switched-off capability's read is refused for every role, the owner too", async () => {
  await switchCapability(app, a.owner, 'loyalty', true);
  for (const s of [a.owner, a.manager, a.staff]) expect((await mint(s, 'loyalty.balance', { customer_id: a.customer })).name).toBe('loyalty.balance');
  await switchCapability(app, a.owner, 'loyalty', false);
  const before = await snapshots();
  for (const s of [a.owner, a.manager, a.staff]) expect(await failure(mint(s, 'loyalty.balance', { customer_id: a.customer }))).toMatchObject({ code: 'capability_off', fields: ['loyalty'] });
  expect(await snapshots()).toBe(before);
});
