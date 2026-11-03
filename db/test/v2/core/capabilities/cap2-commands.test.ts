// CAP2, core's half: with a capability off, its `start` commands refuse (capability_off) and its `finish` commands run,
// every `*.reverse` included. The check (refuseSwitchedOff) reads each command's rows from ref.command_capability, so no
// command file names a capability; it runs in runCommand, inside the command's own transaction, after the body (and so
// after a replay returns).
// The independent expectations are BLUEPRINT §2.10.14's: the commands with only `finish` rows, and the two commands whose
// extra `start` rows are parts of their input (an udhaar amount, a code, points, a package line; a stitching order),
// which the command body checks, not runCommand.
import { CoreError, createTenant, recordSale, runCommand, type Session, switchCapability } from '@munshi/core';
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { refuseSwitchedOff } from '../../../../../packages/core/src/capabilities.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let owner: Session; // a bare kirana, for the checks that run in rolled-back transactions
let commands: string[];
let rows: { command: string; capability: string; use: 'start' | 'finish' }[];
let requires: { capability: string; requires: string }[];
beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  owner = (
    await createTenant(app, {
      kind: 'sample',
      name: 'CAP2 General Store (synthetic)',
      slug: `cap-${randomBytes(6).toString('hex')}`,
      shopName: 'Main counter',
      ownerName: 'Owner',
      identity: { provider: 'password', subject: randomUUID() },
    })
  ).session;
  commands = (await db.admin.query<{ command: string }>('select command from ref.command order by command')).rows.map((r) => r.command);
  rows = (await db.admin.query('select command, capability, use from ref.command_capability')).rows;
  requires = (await db.admin.query('select capability, requires from ref.capability_requires')).rows;
  await db.sabotage();
});
afterAll(() => db.close());

const FINISH_ONLY = [
  'advance.reverse',
  'consent.record',
  'credit.reverse',
  'holiday.reverse',
  'leave.reverse',
  'offer.end',
  'order.cancel',
  'order.reschedule',
  'order.reverse',
  'order.step',
  'package.expire',
  'package.redeem',
  'payment.reverse',
  'paypal.cancel',
  'purchase.reverse',
  'sale.reverse',
  'settlement.reverse',
  'stock.reverse',
  'wages.pay',
];
const PARTS: Record<string, string[]> = { 'sale.record': ['credit', 'offers', 'loyalty', 'packages'], 'order.confirm': ['stitching'] };

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => {
      if (!(e instanceof CoreError)) throw e;
      return e;
    },
  );
const outcome = (c: pg.PoolClient, command: string) =>
  refuseSwitchedOff(c, command).then(
    () => 'runs',
    (e: CoreError) => `${e.code}:${(e.fields ?? []).join(',')}`,
  );

// fn as the owner in one transaction that is rolled back, so the switches it writes never leave it.
async function rolledBack<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [owner.tenantId, owner.memberId]);
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}
const set = (c: pg.PoolClient, capability: string, on: boolean) =>
  c.query('insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, $2, $3)', [owner.tenantId, capability, on]);

// A capability and every capability that requires it, dependants first: the order switching off must take (CAP4).
function offOrder(capability: string, out: string[] = []): string[] {
  for (const r of requires) if (r.requires === capability) offOrder(r.capability, out);
  if (!out.includes(capability)) out.push(capability);
  return out;
}

it('CAP2 with every capability off, each command with a start row refuses and each finish-only command runs, every *.reverse included', async () => {
  const seen = await rolledBack(async (c) => {
    const { rows: on } = await c.query<{ capability: string }>(
      `select p.capability from ref.pack_capability p join ops.tenant t on t.business_type = p.business_type
        order by exists (select 1 from ref.capability_requires r where r.capability = p.capability) desc, p.capability`,
    );
    expect(on.length).toBe(11); // the kirana pack (BLUEPRINT §2.5)
    for (const { capability } of on) await set(c, capability, false);
    const out = new Map<string, string>();
    for (const command of commands) out.set(command, await outcome(c, command));
    return out;
  });
  const runs = [...seen].filter(([, o]) => o === 'runs').map(([n]) => n);
  expect(runs).toEqual(FINISH_ONLY);
  expect(runs.filter((n) => n.endsWith('.reverse')).length).toBe(10);
  const refused = [...seen].filter(([, o]) => o !== 'runs');
  expect(commands.length).toBe(58); // BLUEPRINT §2.10.14's commands plus settlement.import, surplus.give (W2-B) and paypal.request and paypal.cancel (24)
  expect(refused.length).toBe(58 - FINISH_ONLY.length);
  expect(refused.every(([, o]) => o.startsWith('capability_off:'))).toBe(true);
  console.log(`CAP2 all off: ${refused.length} of ${commands.length} commands refused, ${runs.length} finish-only commands run`);
});

it("CAP2 with one capability off, a command refuses only on its own start row for it; its parts and finish rows run", async () => {
  let refusals = 0;
  let ranWithOff = 0;
  const { rows: all } = await db.admin.query<{ code: string }>(
    'select code from ref.capability order by exists (select 1 from ref.capability_requires r where r.capability = code), code',
  );
  expect(all.length).toBe(21);
  for (const { code: capability } of all) {
    const off = offOrder(capability);
    const seen = await rolledBack(async (c) => {
      for (const { code } of all) await set(c, code, true); // requirements first
      for (const code of off) await set(c, code, false);
      const out = new Map<string, string>();
      for (const command of commands) out.set(command, await outcome(c, command));
      return out;
    });
    for (const command of commands) {
      const mine = rows.filter((r) => r.command === command && off.includes(r.capability));
      const blocking = mine.filter((r) => r.use === 'start' && !(PARTS[command] ?? []).includes(r.capability)).map((r) => r.capability);
      const expected = blocking.length ? `capability_off:${blocking.sort().join(',')}` : 'runs';
      expect(seen.get(command), `${command} with ${off.join(', ')} off`).toBe(expected);
      if (blocking.length) refusals++;
      else if (mine.length) ranWithOff++;
    }
  }
  expect(refusals).toBeGreaterThan(40);
  expect(ranWithOff).toBeGreaterThan(20);
  console.log(`CAP2 one off at a time: ${refusals} refusals, ${ranWithOff} runs with an off finish row or part`);
});

const day = () => new Date().toISOString().slice(0, 10);
const bill = (s: Shop, billNo: string) => ({ supplierId: s.supplier, billNo, billDate: day(), lines: [{ itemId: s.biscuits, qtyMilli: 12_000, unitCostMinor: 850 }] });
const count = async (s: Shop, rel: string) =>
  (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(`select count(*)::int as n from ${rel}`))).rows[0].n as number;

it('CAP2 through runCommand: with buying off its start commands refuse and write nothing; switched on again, the latest switch wins', async () => {
  const s = await smallShop(app, 'CAP2-buying');
  await switchCapability(app, s.owner, 'buying', false);
  const purchases = await count(s, 'books.purchase');
  const starts: [string, unknown][] = [
    ['purchase.record', bill(s, 'OFF-1')],
    ['supplier.create', { name: 'Late Traders (simulated)' }],
    ['reorder.place', { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: 24_000 }] }],
  ];
  for (const [name, input] of starts) expect(await failure(runCommand(app, s.owner, name, input)), name).toMatchObject({ code: 'capability_off', fields: ['buying'] });
  expect(await count(s, 'books.purchase')).toBe(purchases);
  expect(await count(s, 'books.supplier')).toBe(1);
  expect(await count(s, 'books.outbound_message')).toBe(0);
  // Switched on again, the same requests run: the refusals above were the capability's, not the requests'.
  await switchCapability(app, s.owner, 'buying', true);
  for (const [name, input] of starts) expect(Object.keys(await runCommand(app, s.owner, name, input)).length, name).toBeGreaterThan(0);
  expect(await count(s, 'books.purchase')).toBe(purchases + 1);
  expect(await count(s, 'books.supplier')).toBe(2);
  expect(await count(s, 'books.outbound_message')).toBe(1);
});

it('CAP2 a finish command runs with its capability off: a repayment with credit off, a supplier payment with buying off, a sale with no loyalty, packages, holds or bookings', async () => {
  const s = await smallShop(app, 'CAP2-finish');
  await recordSale(app, s.staff, { shopId: s.shopId, customerId: s.customer, lines: [{ itemId: s.biscuits, qtyMilli: 3000 }], payments: [] }); // ₹30 udhaar
  await switchCapability(app, s.owner, 'credit', false);
  expect(await failure(runCommand(app, s.owner, 'credit.record', { customerId: s.customer, amountMinor: 500 }))).toMatchObject({ code: 'capability_off', fields: ['credit'] });
  expect(await runCommand(app, s.owner, 'payment.record', { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: 3000 })).toEqual({
    paymentId: expect.any(String),
  });
  await switchCapability(app, s.owner, 'buying', false);
  expect(await runCommand(app, s.owner, 'payment.record', { direction: 'out', supplierId: s.supplier, method: 'bank', amountMinor: 10_000 })).toEqual({
    paymentId: expect.any(String),
  });
  // The kirana pack never switched these on; sale.record names them as parts (loyalty, packages) and finishes (holds, bookings).
  const { rows: never } = await tx(app, { tenant_id: s.owner.tenantId }, (c) =>
    c.query(`select count(*)::int as n from ops.capability_switch where capability in ('loyalty', 'packages', 'holds', 'bookings')`),
  );
  expect(never[0].n).toBe(0);
  expect(await recordSale(app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 1000 }], payments: [{ method: 'cash', amountMinor: 1000 }] })).toEqual({
    saleId: expect.any(String),
  });
});

it("CAP2 the check runs in the command's own transaction after a replay returns: a recorded request replays with buying off, a refused one claims no key", async () => {
  const s = await smallShop(app, 'CAP2-replay');
  const first = await runCommand(app, s.owner, 'purchase.record', bill(s, 'R-1'), 'cap-replay-0001');
  await switchCapability(app, s.owner, 'buying', false);
  expect(await runCommand(app, s.owner, 'purchase.record', bill(s, 'R-1'), 'cap-replay-0001')).toEqual(first);
  expect(await failure(runCommand(app, s.owner, 'purchase.record', bill(s, 'R-2'), 'cap-replay-0002'))).toMatchObject({ code: 'capability_off' });
  const { rows: keys } = await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(`select key from ops.idempotency where key like 'cap-replay-%' order by key`));
  expect(keys).toEqual([{ key: 'cap-replay-0001' }]);
  await switchCapability(app, s.owner, 'buying', true);
  expect(await runCommand(app, s.owner, 'purchase.record', bill(s, 'R-2'), 'cap-replay-0002')).toEqual({ purchaseId: expect.any(String) });
});

it('CAP2 a command waits for a switch in flight and, once the switch-off commits, is refused', async () => {
  const s = await smallShop(app, 'CAP2-race');
  const purchases = await count(s, 'books.purchase');
  const first = await app.connect();
  try {
    await first.query('begin');
    await first.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true)`, [s.owner.tenantId, s.owner.memberId]);
    await first.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'buying', false)`, [s.owner.tenantId]);
    let settled = false;
    const purchase = runCommand(app, s.manager, 'purchase.record', bill(s, 'RACE-1'))
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await new Promise((r) => setTimeout(r, 300));
    expect(settled).toBe(false);
    await first.query('commit');
    expect(await purchase).toMatchObject({ code: 'capability_off', fields: ['buying'] });
  } finally {
    first.release();
  }
  expect(await count(s, 'books.purchase')).toBe(purchases);
});
