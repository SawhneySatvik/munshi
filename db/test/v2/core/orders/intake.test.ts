// Intake (BLUEPRINT §8.12, decision 18) end to end: every channel the SQL admits makes a new ops.order_request with an
// ORD- code and no personal data, from the public role with no actor; a site or widget cart is priced from the latest
// release's cells with the counter's line function, and recomputes from its stored release and lines alone (ORD1, CART1
// carried over); a request becomes an order only by a person's order.confirm (ORD5); and the order_requests job expires
// what nobody handled, per tenant. Red-proofs: test/v2/sabotage/core-orders.ts.
import {
  type CartFigures,
  CoreError,
  command,
  execute,
  intakeInstagram,
  intakePhoto,
  intakeSite,
  intakeVoice,
  intakeWhatsapp,
  intakeWidget,
  parseInput,
  requestFigures,
  resolveRef,
  runCommand,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { asPublic, inbound, ORDER_CODE, type OrderShop, orderShop, publish, SAREE, TEA } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let s: OrderShop;
let other: OrderShop;
let release: string;
const returned = new Map<string, CartFigures>(); // what intake returned, by request: ORD1 compares the recompute to it

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await orderShop(app, 'Intake');
  other = await orderShop(app, 'Intake other');
  // An older release first: a cart is priced from the latest.
  await publish(db, s, [[s.tea, 'Assam tea 250 g', 1]]);
  release = (await publish(db, s, [[s.tea, 'Assam tea 250 g', TEA], [s.saree, 'Cotton saree', SAREE]])).releaseId;
  await publish(db, other, [[other.tea, 'Assam tea 250 g', TEA]]);
  await db.sabotage();
});
afterAll(() => db?.close());

const requests = async (tenantId: string) =>
  (
    await db.admin.query(
      `select id::text as id, code, channel, kind, release_id::text as release_id, lines, inbound_message_id::text as inbound, contact_id, state, handled_by, order_id
         from ops.order_request where tenant_id = $1 order by created_at, id`,
      [tenantId],
    )
  ).rows;

it('INTAKE1 each channel makes a new request from the public, with an ORD- code and no personal data: a cart stores the latest release and its lines, a message channel its inbox message', async () => {
  const cart = { shopId: s.shopId, lines: [{ itemId: s.tea, qtyMilli: 1500 }] };
  const site = await asPublic(db, s.tenantId, (c) => intakeSite(c, cart));
  const widget = await asPublic(db, s.tenantId, (c) => intakeWidget(c, { ...cart, contactId: s.contact }));
  const sent: Record<string, string> = {};
  for (const [channel, intake, kind] of [
    ['whatsapp', intakeWhatsapp, 'text'],
    ['instagram', intakeInstagram, 'text'],
    ['voice', intakeVoice, 'audio'],
    ['photo', intakePhoto, 'image'],
  ] as const) {
    const message = await inbound(db, s.tenantId, kind, kind === 'text' ? 'Two blouses please' : null);
    sent[channel] = message;
    const r = await asPublic(db, s.tenantId, (c) => intake(c, { shopId: s.shopId, kind: 'stitching', inboundMessageId: message }));
    expect(r).toEqual({ requestId: expect.any(String), code: expect.stringMatching(ORDER_CODE) });
  }
  expect(site.code).toMatch(ORDER_CODE);
  const rows = await requests(s.tenantId);
  expect(rows.map((r) => r.channel)).toEqual(['site', 'widget', 'whatsapp', 'instagram', 'voice', 'photo']);
  expect(new Set(rows.map((r) => r.code)).size).toBe(6);
  for (const r of rows) {
    expect(r, r.channel).toMatchObject({ state: 'new', handled_by: null, order_id: null });
    expect(r.code).toMatch(/^ORD-[A-Z0-9]{6}$/);
  }
  expect(rows[0]).toMatchObject({ id: site.requestId, code: site.code, kind: 'goods', release_id: release, lines: cart.lines, inbound: null, contact_id: null });
  expect(rows[1]).toMatchObject({ id: widget.requestId, release_id: release, lines: cart.lines, contact_id: s.contact });
  for (const r of rows.slice(2)) expect(r, r.channel).toMatchObject({ kind: 'stitching', release_id: null, lines: null, inbound: sent[r.channel] });
  // A cart line the latest release does not publish is refused, and nothing is stored.
  const unpublished = await asPublic(db, s.tenantId, (c) => intakeSite(c, { shopId: s.shopId, lines: [{ itemId: s.blouse, qtyMilli: 1000 }] })).catch((e) => e);
  expect(unpublished).toBeInstanceOf(CoreError);
  expect(unpublished).toMatchObject({ code: 'invalid', fields: ['lines.0.itemId'] });
  expect(await requests(s.tenantId)).toHaveLength(6);
  // The public role with an actor writes nothing (order_request_flow).
  const acting = await withTx(db.as('munshi_public'), { kind: 'member', session: s.staff }, (c) => intakeSite(c, cart)).catch((e) => e);
  expect(acting).toMatchObject({ code: 'refused', sqlstate: 'MS018' });
});

it('ORD1 a site or widget request’s figures are the latest release’s price cells through the counter’s line function, with no offer discount, and every stored one recomputes from its release and lines alone to what intake returned', async () => {
  const carts = [
    [{ itemId: s.tea, qtyMilli: 1500 }], // 1.5 × ₹249.99 = ₹374.985: ₹374.99, half away from zero
    [
      { itemId: s.saree, qtyMilli: 2000 },
      { itemId: s.tea, qtyMilli: 333 },
    ], // ₹4,998 + 0.333 × ₹249.99 (₹83.24667: ₹83.25)
  ];
  const expected = [[37_499], [499_800, 8_325]];
  for (const [n, lines] of carts.entries()) {
    const r = await asPublic(db, s.tenantId, (c) => (n === 0 ? intakeSite : intakeWidget)(c, { shopId: s.shopId, lines }));
    returned.set(r.requestId, { releaseId: r.releaseId, lines: r.lines, total: r.total });
    expect(r.releaseId).toBe(release);
    expect(r.lines.map((l) => l.amount.minor)).toEqual(expected[n]);
    expect(r.total.minor).toBe((expected[n] as number[]).reduce((a, b) => a + b, 0));
    for (const [i, l] of r.lines.entries()) {
      expect(l.qty).toEqual({ qtyMilli: (lines[i] as { qtyMilli: number }).qtyMilli, source: 'request' });
      expect(l.amount.from).toEqual([l.price.ref]);
      expect(r.total.from).toContain(l.price.ref);
      // The price is the published cell itself.
      const cell = await withTx(app, { kind: 'member', session: s.owner }, (c) => resolveRef(c, l.price.ref));
      expect(cell).toEqual({ kind: 'money', num: String(l.price.minor), currency: 'INR' });
    }
  }
  // Every stored cart, recomputed from its stored ids only, as the app reads it.
  const stored = (await db.admin.query<{ id: string }>(`select id::text as id from ops.order_request where tenant_id = $1 and release_id is not null`, [s.tenantId])).rows;
  const mine = stored.filter((r) => returned.has(r.id));
  expect(mine.length).toBe(carts.length);
  for (const { id } of mine) {
    expect(await withTx(app, { kind: 'member', session: s.owner }, (c) => requestFigures(c, id))).toEqual(returned.get(id));
  }
});

it('ORD5 the public and webhook roles write no books.order*, nor does a run with no person: a request becomes an order only by a person’s order.confirm, in that order’s transaction', async () => {
  const { requestId, code } = await asPublic(db, s.tenantId, (c) => intakeSite(c, { shopId: s.shopId, lines: [{ itemId: s.saree, qtyMilli: 1000 }] }));
  const input = { requestId, customerId: s.customer };
  const orders = async () => (await db.admin.query('select count(*)::int as n from books.order where tenant_id = $1', [s.tenantId])).rows[0].n as number;
  const before = await orders();
  // The public pool, given a member's session and the command: no grant on the request or the books.
  const pub = await runCommand(db.as('munshi_public'), s.manager, 'order.confirm', input).catch((e) => e);
  expect(pub).toMatchObject({ code: 'refused' });
  // A run or a watcher (a tenant, no actor) on the app's own pool: the guard admits no book row.
  const def = command('order.confirm');
  const run = await withTx(app, { kind: 'system', tenantId: s.tenantId }, (c) => execute(c, def, parseInput(def, input))).catch((e) => e);
  expect(run).toMatchObject({ code: 'refused', sqlstate: 'MS001' });
  // The jobs role holds no insert on books.order.
  const jobs = await tx(db.as('munshi_jobs'), { tenant_id: s.tenantId }, (c) =>
    c.query(`insert into books.order (tenant_id, shop_id, request_id, customer_id, kind, code, currency) values ($1, $2, $3, $4, 'goods', $5, 'INR')`, [
      s.tenantId,
      s.shopId,
      requestId,
      s.customer,
      code,
    ]),
  ).catch((e) => e);
  expect(jobs.code).toBe('42501');
  expect(await orders()).toBe(before);
  expect((await requests(s.tenantId)).find((r) => r.id === requestId)).toMatchObject({ state: 'new', order_id: null });
  // A person confirms it: the order is theirs, and so is the request's handling.
  const r = await runCommand(app, s.manager, 'order.confirm', input);
  const { rows } = await db.admin.query('select request_id::text as request_id, code, created_by, decision_id from books.order where id = $1', [r.orderId]);
  expect(rows).toEqual([{ request_id: requestId, code, created_by: s.manager.memberId, decision_id: null }]);
  expect((await requests(s.tenantId)).find((x) => x.id === requestId)).toMatchObject({ state: 'confirmed', order_id: r.orderId, handled_by: s.manager.memberId });
  // A second confirmation finds it handled.
  expect(await runCommand(app, s.manager, 'order.confirm', input).catch((e) => e)).toMatchObject({ code: 'conflict', fields: ['requestId'] });
  expect(await orders()).toBe(before + 1);
});

it('EXP1 the order_requests job expires every tenant’s unhandled request past expires_at, an exact positive count per tenant, and leaves one not yet due and one confirmed', async () => {
  const cart = (t: OrderShop) => ({ shopId: t.shopId, lines: [{ itemId: t.tea, qtyMilli: 1000 }] });
  const message = await inbound(db, s.tenantId, 'text', 'hi');
  const due = [
    (await asPublic(db, s.tenantId, (c) => intakeSite(c, cart(s)))).requestId,
    (await asPublic(db, s.tenantId, (c) => intakeWhatsapp(c, { shopId: s.shopId, inboundMessageId: message }))).requestId,
    (await asPublic(db, other.tenantId, (c) => intakeSite(c, cart(other)))).requestId,
  ];
  const notDue = (await asPublic(db, s.tenantId, (c) => intakeSite(c, cart(s)))).requestId;
  const confirmed = (await asPublic(db, s.tenantId, (c) => intakeSite(c, cart(s)))).requestId;
  await runCommand(app, s.manager, 'order.confirm', { requestId: confirmed, customerId: s.customer });
  // Every request of this file that is still new is due, bar notDue: the counts are exact.
  await plant(db.admin, `update ops.order_request set expires_at = now() - interval '1 minute' where state = 'new' and id <> $1`, [notDue]);
  await plant(db.admin, `update ops.order_request set expires_at = now() - interval '1 minute' where id = $1`, [confirmed]);
  const { rows: planted } = await db.admin.query<{ tenant_id: string; n: number }>(
    `select tenant_id::text as tenant_id, count(*)::int as n from ops.order_request where state = 'new' and expires_at <= now() group by 1`,
  );
  const want = Object.fromEntries(planted.map((r) => [r.tenant_id, r.n]));
  expect(want[s.tenantId]).toBeGreaterThanOrEqual(2);
  expect(want[other.tenantId]).toBeGreaterThanOrEqual(1);
  const pool = createJobsPool(jobsUrl(db));
  try {
    const runs = await runDueJobs(pool, new Date(), ['order_requests']);
    const ran = Object.fromEntries(runs.map((r) => [r.tenantId, [r.outcome, r.removed]]));
    expect(ran[s.tenantId]).toEqual(['ok', { requests: want[s.tenantId] }]);
    expect(ran[other.tenantId]).toEqual(['ok', { requests: want[other.tenantId] }]);
  } finally {
    await pool.end();
  }
  const state = async (id: string) => (await db.admin.query('select state from ops.order_request where id = $1', [id])).rows[0].state;
  for (const id of due) expect(await state(id)).toBe('expired');
  expect(await state(notDue)).toBe('new');
  expect(await state(confirmed)).toBe('confirmed');
});
