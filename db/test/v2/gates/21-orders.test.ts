// 21_orders.sql: ORD2 (steps follow ref.order_flow, MS019; two taps make one step; ops.order_state is the latest step and
// takes no direct write), ORD5 (the public and webhook roles write no books.order*; a request becomes an order only in
// the order's own transaction, by a person), the request's role shapes, b_order_price, M1 (a contact is erased with its
// measurements, and never while an order or advance of theirs is open), §2.6's other erasure holds and the purge's idle
// year, and the taint list. Red-proofs: test/v2/sabotage/orders.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { type Books, type Filled, fillTenant, plantProbeCommand, signUp } from './fixture.ts';
import { plant, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = db.as('munshi_jobs');
  f = await fillTenant(db, await signUp(db, 'order-shop', { type: 'apparel' }));
  await db.sabotage();
});
afterAll(() => db?.close());

const one = async (c: pg.ClientBase, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const run = <T>(actor: string, command: string | undefined, fn: (c: pg.PoolClient) => Promise<T>) =>
  tx(app, command ? { tenant_id: f.tenant, actor_id: actor, command } : { tenant_id: f.tenant, actor_id: actor }, fn);
let codes = 0;
const code = () => `ORD-T${String(++codes).padStart(3, '0')}`;
async function customerWithPhone(): Promise<{ customer: string; contact: string }> {
  return run(f.owner, 'customer.create', async (c) => {
    const contact = await one(c, `insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Asha', $2) returning id`, [f.tenant, `+9199${String(10000000 + ++codes)}`]);
    const customer = await one(c, 'insert into books.customer (tenant_id) values ($1) returning id', [f.tenant]);
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [f.tenant, customer, contact]);
    return { customer, contact };
  });
}
// order.confirm: the order, one line of the tea at its price, and the confirmed step.
const confirm = (kind = 'goods', customer = f.customer, extra: (c: pg.PoolClient, o: string) => Promise<unknown> = async () => undefined) =>
  run(f.staff, 'order.confirm', async (c) => {
    const o = await one(c, `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values ($1, $2, $3, $4, $5, 'INR') returning id`, [
      f.tenant,
      f.shop,
      customer,
      kind,
      code(),
    ]);
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, o, f.good, f.goodPrice],
    );
    await c.query(`insert into books.order_step (tenant_id, order_id, step_no, step, due_on, at) values ($1, $2, 0, 'confirmed', current_date + 5, now())`, [f.tenant, o]);
    await extra(c, o);
    return o;
  });
const step = (order: string, s: string, command = 'order.step', cols = '', vals: unknown[] = [], c?: pg.PoolClient) => {
  const sql = `insert into books.order_step (tenant_id, order_id, step_no, step, at${cols}) values ($1, $2, 0, $3, now()${vals.map((_, i) => `, $${i + 4}`).join('')})`;
  const actor = command === 'order.cancel' ? f.manager : f.staff;
  return c ? c.query(sql, [f.tenant, order, s, ...vals]) : run(actor, command, (x) => x.query(sql, [f.tenant, order, s, ...vals]));
};
const deliver = (order: string) =>
  run(f.staff, 'sale.record', async (c) => {
    const sale = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency, order_id) values ($1, $2, now(), $3, 25000, 'INR', $4) returning id`, [
      f.tenant,
      f.shop,
      f.customer,
      order,
    ]);
    const line = (await c.query<{ id: string }>('select id from books.order_line where order_id = $1', [order])).rows[0]?.id;
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, order_line_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, sale, f.good, line],
    );
    await step(order, 'delivered', 'sale.record', '', [], c);
  });
const state = async (order: string) => (await db.admin.query('select step, step_no, due_on::text, trial_on::text from ops.order_state where order_id = $1', [order])).rows[0];
const latest = async (order: string) =>
  (await db.admin.query('select step, step_no from books.order_step where order_id = $1 order by step_no desc limit 1', [order])).rows[0];

it('ORD2 an order’s steps follow ref.order_flow for its kind (MS019): confirmed first and once, each step its command’s, a reschedule from any open step, delivered only by its sale, nothing after the end; ops.order_state is always the latest step', async () => {
  const o = await confirm();
  const flow = async (s: string, command = 'order.step', cols = '', vals: unknown[] = []) => {
    const r = await refused(step(o, s, command, cols, vals));
    expect(r.code, `${s} by ${command}`).toBe('MS019');
    return r.message;
  };
  expect(await flow('confirmed', 'order.confirm')).toBe("order step refused: an order's first step, and only its first, is confirmed");
  expect(await flow('out_for_delivery')).toBe('order step refused: out_for_delivery does not follow confirmed for a goods order');
  expect(await flow('cancelled')).toBe('order step refused: a cancelled step is written by order.cancel, not order.step');
  expect(await flow('cutting')).toBe('order step refused: cutting does not follow confirmed for a goods order');
  await step(o, 'packed');
  await step(o, 'rescheduled', 'order.reschedule', ', due_on', ['2030-01-09']);
  expect(await flow('packed')).toBe('order step refused: packed does not follow rescheduled for a goods order'); // the order is still packed
  await step(o, 'ready');
  expect(await flow('delivered', 'sale.record')).toBe('order step refused: an order is delivered only by the sale that names it');
  expect(await flow('rescheduled', 'order.reschedule', ', trial_on', ['2030-01-08'])).toBe('order step refused: a trial date is for stitching and alteration');
  expect(await state(o)).toEqual({ step: 'ready', step_no: 4, due_on: '2030-01-09', trial_on: null });
  await deliver(o);
  expect(await flow('rescheduled', 'order.reschedule')).toBe('order step refused: rescheduled does not follow delivered for a goods order');
  expect(await state(o)).toMatchObject({ step: 'delivered', step_no: 5 });
  const { rows } = await db.admin.query(
    `select count(*)::int as off from ops.order_state st
       cross join lateral (select s.step, s.step_no from books.order_step s
                            where s.tenant_id = st.tenant_id and s.order_id = st.order_id order by s.step_no desc limit 1) l
      where st.tenant_id = $1 and (st.step, st.step_no) is distinct from (l.step, l.step_no)`,
    [f.tenant],
  );
  expect(rows).toEqual([{ off: 0 }]);
  const stepless = await refused(
    run(f.staff, 'order.confirm', async (c) => {
      const x = await one(c, `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values ($1, $2, $3, 'goods', $4, 'INR') returning id`, [
        f.tenant,
        f.shop,
        f.customer,
        code(),
      ]);
      await c.query(
        `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
        [f.tenant, x, f.good, f.goodPrice],
      );
    }),
  );
  expect([stepless.code, stepless.message]).toEqual(['MS019', 'order refused: an order is confirmed with its first step, in its own transaction']);
  const stitched = await confirm('stitching');
  await step(stitched, 'cutting');
  await step(stitched, 'stitching');
  await step(stitched, 'trial');
  await step(stitched, 'stitching'); // back after the trial
  expect((await latest(stitched)).step_no).toBe(5);
  const foreign = await refused(step(stitched, 'ready', 'order.step', ', message_id', [f.reorder]));
  expect([foreign.code, foreign.message]).toEqual(['MS019', "order step refused: a step's update is this order's message, written with it"]);
  // order.reverse voids an order entered in error: the header and its line, under the reversal; then no step.
  const voided = await confirm();
  await run(f.owner, 'order.reverse', async (c) => {
    const r = await one(
      c,
      `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency, reverses_id, reason) select tenant_id, shop_id, customer_id, kind, code, currency, id, 'entered_in_error' from books.order where id = $1 returning id`,
      [voided],
    );
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency, reverses_id, reason)
       select tenant_id, $2, line_no, item_id, item_kind, price_id, -qty_milli, unit_price_minor, -gross_minor, currency, id, 'entered_in_error' from books.order_line where order_id = $1`,
      [voided, r],
    );
  });
  expect((await refused(step(voided, 'packed'))).message).toBe('order step refused: a voided order takes no step');
});

it('ORD2 two taps at once make one step and one refusal (23505); a direct write to ops.order_state is refused', async () => {
  const o = await confirm();
  const [c1, c2] = [await app.connect(), await app.connect()];
  try {
    for (const c of [c1, c2]) {
      await c.query('begin');
      await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'order.step', true)`, [
        f.tenant,
        f.staff,
      ]);
    }
    await step(o, 'packed', 'order.step', '', [], c1);
    const second = step(o, 'packed', 'order.step', '', [], c2).then(
      () => 'stepped',
      (e: { code: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 200)); // the second tap is waiting on the step key
    await c1.query('commit');
    expect(await second).toBe('23505');
    await c2.query('rollback');
  } finally {
    c1.release();
    c2.release();
  }
  expect((await db.admin.query(`select count(*)::int as n from books.order_step where order_id = $1 and step = 'packed'`, [o])).rows).toEqual([{ n: 1 }]);
  const direct = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => c.query(`update ops.order_state set step = 'delivered' where order_id = $1`, [o])));
  expect([direct.code, direct.message]).toEqual(['MS018', 'ops.order_state is written only by its holder\'s trigger']);
});

it('ORD5 the public and webhook roles write no books.order*; a request becomes an order only in the order’s transaction, by a person; it holds a release and lines, or a message, and no personal data', async () => {
  for (const sql of [
    `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values ('${f.tenant}', '${f.shop}', '${f.customer}', 'goods', 'ORD-PUB1', 'INR')`,
    `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency) values ('${f.tenant}', '${f.order}', 9, '${f.good}', 'good', '${f.goodPrice}', 1, 1, 1, 'INR')`,
    `insert into books.order_step (tenant_id, order_id, step_no, step, at) values ('${f.tenant}', '${f.order}', 9, 'packed', now())`,
  ]) {
    // the table's own grant is the fence (the guard's ref types would refuse the role later, for another reason)
    const r = await refused(tx(pub, { tenant_id: f.tenant }, (c) => c.query(sql)));
    expect([r.code, r.message], sql.slice(0, 30)).toEqual(['42501', `permission denied for table ${sql.split(' ')[2]?.replace('books.', '')}`]);
  }
  const ask = (cols: Record<string, unknown>, ctx: Record<string, string> = { tenant_id: f.tenant }, pool = pub) => {
    const all = { shop_id: f.shop, code: code(), channel: 'whatsapp', kind: 'goods', inbound_message_id: f.inbound, ...cols };
    const keys = Object.keys(all);
    const id = randomUUID();
    return tx(pool, ctx, (c) =>
      c.query(`insert into ops.order_request (tenant_id, id, ${keys.join(', ')}) values ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')})`, [f.tenant, id, ...Object.values(all)]),
    ).then(() => id);
  };
  const lines = (n: number, extra: Record<string, unknown> = {}) => JSON.stringify(Array.from({ length: n }, () => ({ itemId: f.good, qtyMilli: 1000, ...extra })));
  const release = (await db.admin.query('select id from ops.site_release where tenant_id = $1', [f.tenant])).rows[0].id;
  for (const [what, cols] of [
    ['21 lines', { channel: 'site', inbound_message_id: null, release_id: release, lines: lines(21) }],
    ['a line with a name in it', { channel: 'site', inbound_message_id: null, release_id: release, lines: lines(1, { name: 'Asha' }) }],
    ['a zero quantity', { channel: 'site', inbound_message_id: null, release_id: release, lines: lines(1, { qtyMilli: 0 }) }],
    ['a site request with no lines', { channel: 'site', inbound_message_id: null, release_id: release }],
  ] as const) {
    expect((await refused(ask(cols))).code, what).toBe('23514');
  }
  const request = await ask({});
  const set = (sql: string, ctx: Record<string, string>, pool: pg.Pool) => tx(pool, { tenant_id: f.tenant, ...ctx }, (c) => c.query(`update ops.order_request set ${sql} where id = $1`, [request]));
  const owner = { actor_id: f.owner };
  const alone = await refused(set(`state = 'confirmed'`, owner, app));
  expect([alone.code, alone.message]).toEqual(['MS007', 'order request refused: a request is confirmed only with the order that names it']);
  expect((await refused(set(`state = 'confirmed'`, {}, jobs))).code, 'the jobs role').toBe('MS007');
  expect((await refused(set(`state = 'expired'`, {}, jobs))).code, 'before it expires').toBe('MS007');
  expect((await refused(set(`state = 'declined', reason = 'not_relevant'`, owner, app))).code, 'a reason of another use').toBe('23503');
  const confirmed = await run(f.staff, 'order.confirm', async (c) => {
    const ord = await one(c, `insert into books.order (tenant_id, shop_id, request_id, customer_id, kind, code, currency) values ($1, $2, $3, $4, 'goods', $5, 'INR') returning id`, [
      f.tenant,
      f.shop,
      request,
      f.customer,
      code(),
    ]);
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, ord, f.good, f.goodPrice],
    );
    await c.query(`insert into books.order_step (tenant_id, order_id, step_no, step, at) values ($1, $2, 0, 'confirmed', now())`, [f.tenant, ord]);
    await c.query(`update ops.order_request set state = 'confirmed' where id = $1`, [request]);
    return ord;
  });
  expect((await db.admin.query('select state, order_id from ops.order_request where id = $1', [request])).rows).toEqual([{ state: 'confirmed', order_id: confirmed }]);
  // No column of a request can hold a name, a phone or a note.
  const { rows } = await db.admin.query(
    `select column_name from information_schema.columns where table_schema = 'ops' and table_name = 'order_request' and data_type in ('text', 'character varying', 'jsonb')
       and column_name not in ('code', 'channel', 'kind', 'lines', 'state', 'reason', 'reason_use')`,
  );
  expect(rows).toEqual([]);
});

it('ROLE1 a request is the public’s or an active member’s, new; a member drafts it under its order.confirm draft or declines it with a decline reason; the jobs role expires it after expires_at', async () => {
  // The public cannot read a request back, so the id is the caller's.
  const ask = (pool: pg.Pool, ctx: Record<string, string>) => {
    const id = randomUUID();
    return tx(pool, ctx, (c) =>
      c.query(`insert into ops.order_request (tenant_id, id, shop_id, code, channel, kind, inbound_message_id) values ($1, $2, $3, $4, 'whatsapp', 'stitching', $5)`, [
        f.tenant,
        id,
        f.shop,
        code(),
        f.inbound,
      ]),
    ).then(() => id);
  };
  expect((await refused(ask(pub, { tenant_id: f.tenant, actor_id: f.owner }))).code, 'the public with an actor').toBe('MS018');
  expect((await refused(ask(jobs, { tenant_id: f.tenant }))).code, 'the jobs role').toBe('42501');
  const r = await ask(app, { tenant_id: f.tenant, actor_id: f.staff });
  const set = (sql: string, ctx: Record<string, string>, pool: pg.Pool, params: unknown[] = []) =>
    tx(pool, { tenant_id: f.tenant, ...ctx }, (c) => c.query(`update ops.order_request set ${sql} where id = $1`, [r, ...params]));
  const otherDraft = await run(f.owner, undefined, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'price.set', '{}', $2, 'member', 0) returning id`, [
      f.tenant,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  expect((await refused(set(`state = 'drafted', draft_id = $2`, { actor_id: f.owner }, app, [otherDraft]))).message).toBe(
    'order request refused: a drafted request names its order.confirm draft',
  );
  const draft = await run(f.owner, undefined, (c) =>
    one(c, `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'order.confirm', '{}', $2, 'member', 0) returning id`, [
      f.tenant,
      JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
    ]),
  );
  await set(`state = 'drafted', draft_id = $2`, { actor_id: f.owner }, app, [draft]);
  expect((await refused(set(`state = 'expired'`, { actor_id: f.owner }, app))).code, 'a member expires').toBe('MS010');
  await plant(db.admin, `update ops.order_request set expires_at = now() - interval '1 second' where id = $1`, [r]);
  expect((await refused(set(`state = 'expired'`, { actor_id: f.owner }, jobs))).code, 'the jobs role with an actor').toBe('MS018');
  await set(`state = 'expired'`, {}, jobs);
  expect((await refused(set(`state = 'declined', reason = 'not_now'`, { actor_id: f.owner }, app))).code, 'after it expired').toBe('MS010');
});

it('b_order_price an order line’s unit price is its price row’s, or its taker’s own typed money quote (MS006)', async () => {
  const line = (cols: string, vals: unknown[], actor = f.staff) =>
    run(actor, 'order.confirm', async (c) => {
      const o = await one(c, `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values ($1, $2, $3, 'stitching', $4, 'INR') returning id`, [
        f.tenant,
        f.shop,
        f.customer,
        code(),
      ]);
      await c.query(
        `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, qty_milli, gross_minor, currency, ${cols}) values ($1, $2, 1, $3, 'good', 1000, 0, 'INR', $4, $5)`,
        [f.tenant, o, f.good, ...vals],
      );
      await c.query(`insert into books.order_step (tenant_id, order_id, step_no, step, at) values ($1, $2, 0, 'confirmed', now())`, [f.tenant, o]);
    });
  const message = "order refused: a line's unit price is its price row's, or its taker's own typed quote";
  expect((await refused(line('price_id, unit_price_minor', [f.goodPrice, 24000]))).message).toBe(message);
  const quote = (member: string) =>
    tx(app, { tenant_id: f.tenant, actor_id: member }, (c) =>
      one(c, `insert into ops.member_input (tenant_id, member_id, path, kind, num, currency, created_txid) values ($1, $2, 'lines[0].price', 'money', 180000, 'INR', 0) returning id`, [
        f.tenant,
        member,
      ]),
    );
  expect((await refused(line('quote_input_id, unit_price_minor', [await quote(f.owner), 180000]))).message, 'someone else’s quote').toBe(message);
  await line('quote_input_id, unit_price_minor', [await quote(f.staff), 180000]);
  await line('price_id, unit_price_minor', [f.goodPrice, 25000]);
});

it('M1 a contact is erased with its measurements and every value, in one transaction, and never while an order of theirs is open or its advance unapplied; an order line keeps the measurement id', async () => {
  const p = await customerWithPhone();
  const measure = () =>
    tx(app, { tenant_id: f.tenant, actor_id: f.staff }, async (c) => {
      const m = await one(c, `insert into ops.measurement (tenant_id, contact_id, note, taken_by, created_txid) values ($1, $2, 'Loose', $3, 0) returning id`, [f.tenant, p.contact, f.owner]);
      await c.query(`insert into ops.measurement_value (tenant_id, measurement_id, point, mm) values ($1, $2, 'chest', 900), ($1, $2, 'neck', 380)`, [f.tenant, m]);
      return m;
    });
  const m = await measure();
  expect((await db.admin.query('select taken_by from ops.measurement where id = $1', [m])).rows).toEqual([{ taken_by: f.staff }]);
  const late = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.staff }, (c) => c.query(`insert into ops.measurement_value (tenant_id, measurement_id, point, mm) values ($1, $2, 'hip', 950)`, [f.tenant, m])));
  expect(late.code).toBe('MS006');
  const order = await run(f.staff, 'order.confirm', async (c) => {
    const ord = await one(c, `insert into books.order (tenant_id, shop_id, customer_id, kind, code, currency) values ($1, $2, $3, 'stitching', $4, 'INR') returning id`, [
      f.tenant,
      f.shop,
      p.customer,
      code(),
    ]);
    await c.query(
      `insert into books.order_line (tenant_id, order_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency, measurement_id) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR', $5)`,
      [f.tenant, ord, f.good, f.goodPrice, m],
    );
    await c.query(`insert into books.order_step (tenant_id, order_id, step_no, step, trial_on, at) values ($1, $2, 0, 'confirmed', current_date + 3, now())`, [f.tenant, ord]);
    return ord;
  });
  const eraseAll = (withMeasurements = true) =>
    tx(app, { tenant_id: f.tenant, actor_id: f.owner }, async (c) => {
      await c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [p.contact, f.owner]);
      if (withMeasurements) {
        await c.query(`update ops.measurement set note = null, erased_at = now() where contact_id = $1`, [p.contact]);
        await c.query(`update ops.measurement_value set mm = null, erased_at = now() where measurement_id = $1`, [m]);
      }
    });
  const hold = 'contact refused: a contact is not erased while a balance of theirs is open';
  expect((await refused(eraseAll())).message, 'an open order').toBe(hold);
  await run(f.owner, 'payment.record', (c) =>
    c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, order_id, paid_at) values ($1, 'in', 'cash', 10000, 'INR', $2, $3, now())`, [
      f.tenant,
      p.customer,
      order,
    ]),
  );
  await step(order, 'cancelled', 'order.cancel', ', reason', ['customer_cancelled']);
  expect((await refused(eraseAll())).message, 'an unapplied advance on a cancelled order').toBe(hold);
  await run(f.owner, 'payment.record', (c) =>
    c.query(`insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, order_id, paid_at) values ($1, 'out', 'cash', 10000, 'INR', $2, $3, now())`, [
      f.tenant,
      p.customer,
      order,
    ]),
  );
  const valueFirst = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => c.query(`update ops.measurement_value set mm = null, erased_at = now() where measurement_id = $1`, [m])));
  expect(valueFirst.message, 'a value before its measurement').toBe('measurement refused: a value is erased with its measurement');
  const early = await refused(tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => c.query(`update ops.measurement set note = null, erased_at = now() where id = $1`, [m])));
  expect(early.message, 'a measurement before its contact').toBe('measurement refused: a measurement is erased with its contact, by an active owner or the jobs purge');
  const alone = await refused(eraseAll(false));
  expect([alone.code, alone.message]).toEqual(['MS007', 'contact refused: a contact is erased with its measurements and every value, in one transaction']);
  await eraseAll();
  const { rows } = await db.admin.query(
    `select (select count(*) from ops.measurement_value where measurement_id = $1 and mm is not null)::int as values_left,
            (select measurement_id from books.order_line where order_id = $2) as kept`,
    [m, order],
  );
  expect(rows).toEqual([{ values_left: 0, kept: m }]);
});

it('RET1 §2.6 holds: a contact is not erased while its credit, package, points, a staff advance or a booking ahead is open; the purge erases one only when every linked row has been idle a year, or the owner asked', async () => {
  const erase = (contact: string, pool = app, ctx: Record<string, string> = { tenant_id: f.tenant, actor_id: f.owner }) =>
    tx(pool, ctx, (c) =>
      c.query(
        pool === jobs
          ? `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where id = $1`
          : `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`,
        pool === jobs ? [contact] : [contact, f.owner],
      ),
    );
  const hold = 'contact refused: a contact is not erased while a balance of theirs is open';
  expect((await refused(erase(f.customerContact))).message, 'the fixture customer’s credit, package, points and order').toBe(hold);
  const staffContact = (await db.admin.query('select contact_id from books.party_contact where staff_id = $1', [f.staffRow])).rows[0].contact_id;
  await run(f.owner, 'advance.give', (c) =>
    c.query(`insert into books.advance (tenant_id, staff_id, amount_minor, currency, given_on) values ($1, $2, 7000, 'INR', current_date)`, [f.tenant, f.staffRow]),
  );
  expect((await refused(erase(staffContact))).message, 'an unrecovered advance').toBe(hold);
  const owing = await customerWithPhone();
  await run(f.owner, 'credit.record', (c) =>
    c.query(`insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, at) values ($1, $2, 1500, 'INR', now())`, [f.tenant, owing.customer]),
  );
  expect((await refused(erase(owing.contact))).message, 'credit alone').toBe(hold);
  // A customer whose only row is a sale a month ago: the purge waits for the idle year, an owner's request does not.
  const p = await customerWithPhone();
  await run(f.staff, 'sale.record', async (c) => {
    const s = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, customer_id, total_minor, currency) values ($1, $2, now(), $3, 25000, 'INR') returning id`, [
      f.tenant,
      f.shop,
      p.customer,
    ]);
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, currency) values ($1, $2, 1, $3, 'good', $4, 1000, 25000, 25000, 'INR')`,
      [f.tenant, s, f.good, f.goodPrice],
    );
  });
  await plant(db.admin, `update ops.contact set created_at = now() - interval '2 years' where id = $1`, [p.contact]);
  const idle = await refused(erase(p.contact, jobs, { tenant_id: f.tenant }));
  expect(idle.message).toBe('contact refused: the purge erases a contact whose every linked row has been idle for a year');
  await plant(db.admin, `update books.sale set created_at = now() - interval '13 months' where customer_id = $1`, [p.customer]);
  await plant(db.admin, `update books.sale_line set created_at = now() - interval '13 months' where sale_id in (select id from books.sale where customer_id = $1)`, [p.customer]);
  await erase(p.contact, jobs, { tenant_id: f.tenant });
});

it('the taint list: a draft from a tainted run is only a recipe a person’s tap starts, order.confirm among them (MS002)', async () => {
  const tainted = await tx(jobs, { tenant_id: f.tenant }, (c) => one(c, `insert into ai.run (tenant_id, trigger, desk) values ($1, 'inbox', 'orders') returning id`, [f.tenant]));
  await tx(jobs, { tenant_id: f.tenant }, (c) => c.query('update ai.run set tainted = true where id = $1', [tainted]));
  const propose = (command: string) =>
    tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) =>
      c.query(`insert into approval.draft (tenant_id, command, payload, based_on, source, run_id, created_txid) values ($1, $2, '{}', $3, 'run', $4, 0)`, [
        f.tenant,
        command,
        JSON.stringify([{ snapshotId: f.snapshot, row: 0, col: 'amount' }]),
        tainted,
      ]),
    );
  const r = await refused(propose('price.set'));
  expect([r.code, r.message]).toEqual(['MS002', 'draft refused: a tainted run proposes only its tapped recipe, not price.set']);
  await propose('order.confirm');
});

it('ORD5 a site request’s lines name goods this shop sells: another shop’s item, a service or an item no longer sold is refused (MS007)', async () => {
  const release = (await db.admin.query('select id from ops.site_release where tenant_id = $1', [f.tenant])).rows[0].id;
  const request = (item: string) =>
    tx(pub, { tenant_id: f.tenant }, (c) =>
      c.query(`insert into ops.order_request (tenant_id, id, shop_id, code, channel, kind, release_id, lines) values ($1, $2, $3, $4, 'site', 'goods', $5, $6)`, [
        f.tenant,
        randomUUID(),
        f.shop,
        code(),
        release,
        JSON.stringify([{ itemId: f.good, qtyMilli: 1000 }, { itemId: item, qtyMilli: 2000 }]),
      ]),
    );
  const other = await fillTenant(db, await signUp(db, 'order-elsewhere'));
  const retired = await run(f.owner, 'item.create', async (c) => {
    const i = await one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'good', 'piece') returning id`, [f.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, sellable, effective_from) values ($1, $2, 'Old stock', false, now())`, [f.tenant, i]);
    return i;
  });
  const message = 'order request refused: each line names a good this shop sells';
  for (const [what, item] of [
    ['another shop’s item', other.good],
    ['a service', f.service],
    ['an item no longer sold', retired],
  ] as const) {
    const r = await refused(request(item));
    expect([r.code, r.message], what).toEqual(['MS007', message]);
  }
  await request(f.good);
});
