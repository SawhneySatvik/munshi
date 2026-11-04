// Red-proofs of the joins between areas (test/v2/core/wire/): each breaks one join or capability check of packages/core/src, and its
// named test must fail.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/core/wire/wire1.test.ts';
const SALE = 'packages/core/src/commands-sale.ts';
const TRADE = 'packages/core/src/commands-trade.ts';

const ORD3 = 'a sale naming an order sells its lines at the promised price, applies the advance it holds, and writes the delivered step with the customer’s update';
const ORD3_EXACT = 'a sale naming an order sells exactly its lines to its customer: another quantity, another customer or a second delivery is refused and writes nothing';
const ORD3_REVERSE = 'a delivery’s reversal leaves the order delivered and holds its advance again, which then goes back as a refund';
const ADVANCE = 'payment.record takes an order’s advance and credit.record keeps what is held as the customer’s credit, as direct commands';
const HOLD = 'a sale naming a held piece marks it sold in the sale’s transaction; a new hold needs holds on, while a decline runs with it off';
const BOOKING = 'a sale naming a confirmed booking marks it done; points are earned only while loyalty is on';
const PARTS = 'a sale’s parts are checked against its input: an udhaar rest needs credit, an offer code offers and points loyalty, each refused by name';
const KIRANA = 'a kirana confirms a goods order but not a stitching one, and makes goods but not services';
const DRAFT = 'an approved draft keeps its rows only while its capability is on: switched off between proposal and approval, it is refused and the draft stays proposed';

const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: V2, ts: { file, from, to } });

export const CORE_WIRE_CASES: Case[] = [
  // the order's promised lines ignored: priced at today's price, naming no order line
  ts('v2-wire-promised-price', ORD3, SALE, 'const o = promised[k];', 'const o = undefined as (typeof promised)[number] | undefined;'),
  // the advance never applied
  ts('v2-wire-advance', ORD3, SALE, 'const applied = i.orderId ? Math.min(await advanceHeld(c, i.orderId), total) : 0;', 'const applied = 0;'),
  // no delivered step
  ts('v2-wire-delivered', ORD3, SALE, 'const delivered = i.orderId ? await orderDelivered(c, i.orderId) : undefined;', 'const delivered = undefined as { stepId: string; messageId: string | null } | undefined;'),
  // another customer's name taken over silently
  ts(
    'v2-wire-customer',
    ORD3_EXACT,
    SALE,
    "if (i.customerId !== undefined && i.customerId !== promised[0]?.customer_id) throw new CoreError('invalid', { fields: ['customerId'] });",
    '',
  ),
  // the reversal names no order, so the advance its delivery used stays spent
  ts(
    'v2-wire-reverse-order',
    ORD3_REVERSE,
    SALE,
    'select tenant_id, $2, shop_id, $3, customer_id, -total_minor, currency, order_id, id, $4 from books.sale where id = $1',
    'select tenant_id, $2, shop_id, $3, customer_id, -total_minor, currency, null::uuid, id, $4 from books.sale where id = $1',
  ),
  // payment.record and credit.record blind to the order forms
  ts('v2-wire-payment-union', ADVANCE, TRADE, "if ('orderId' in i) return recordOrderPayment(ctx, i);", ''),
  ts('v2-wire-credit-union', ADVANCE, TRADE, "if ('paymentId' in i) return keepAdvanceAsCredit(ctx, i);", ''),
  // the held piece left held
  ts('v2-wire-hold-sold', HOLD, SALE, 'if (i.reservationId) await sellHeldPiece(c, i.reservationId);', ''),
  // a new hold with holds off
  ts('v2-wire-holds-off', HOLD, 'packages/core/src/reservations.ts', "    await refuseParts(c, ['holds']);\n", ''),
  // the booking left confirmed
  ts(
    'v2-wire-booking-done',
    BOOKING,
    SALE,
    "if (done.rowCount !== 1) throw new CoreError('conflict', { fields: ['bookingId'] });",
    '',
  ),
  ts('v2-wire-earn-off', BOOKING, SALE, "customerId && rule && (await switchedOn(c, 'loyalty'))", 'customerId && rule'),
  // the parts unchecked
  ts('v2-wire-credit-part', PARTS, SALE, "if (credit > 0) await refuseParts(c, ['credit']);", ''),
  ts('v2-wire-offers-part', PARTS, SALE, "if (codes.length) parts.push('offers');", ''),
  ts('v2-wire-loyalty-part', PARTS, SALE, "if (i.redeemPoints !== undefined) parts.push('loyalty');", ''),
  ts('v2-wire-stitching-part', KIRANA, 'packages/core/src/commands-orders.ts', "if (kind !== 'goods') await refuseParts(c, ['stitching']);", ''),
  ts('v2-wire-item-kind', KIRANA, 'packages/core/src/commands-catalogue.ts', 'await refuseItemKind(c, i.kind);', ''),
  // an approved draft run with its capability off
  ts('v2-wire-decide-capability', DRAFT, 'packages/core/src/approvals.ts', '    await refuseSwitchedOff(c, draft.command);\n', ''),
];

const TAINT = 'reading a bill taints its run (the supplier’s text is untrusted), before the draft, and the run stays tainted';
CORE_WIRE_CASES.push(
  // the bill flow unwrapped: it reads bill.lines without tainting its run
  {
    sabotage: 'v2-wire-bill-taint',
    file: 'test/v2/core/hero/h2-bill-read.test.ts',
    test: TAINT,
    config: V2,
    ts: { file: 'packages/agent/src/bill.ts', from: 'const o = { ...opts, port: tappedPort(opts.port, "purchase.record") };', to: 'const o = opts;' },
  },
  // the test port's taint dropped
  {
    sabotage: 'v2-wire-port-taint',
    file: 'test/v2/core/hero/h2-bill-read.test.ts',
    test: TAINT,
    config: V2,
    ts: { file: 'db/test/v2/core/agent-port.ts', from: "await withTx(db.app, member, (c) => c.query('update ai.run set tainted = true where id = $1', [runId]));", to: '' },
  },
);

const SCHEDULE = 'the back office runs the watchers hourly and a branch’s brief once its morning has come, once a day; two ticks at once run each once';
const SCHEDULED = 'packages/core/src/brief-schedule.ts';
CORE_WIRE_CASES.push(
  // no claim: two ticks run the same hour's watchers twice
  {
    sabotage: 'v2-wire-schedule-claim',
    file: 'test/v2/core/brief/schedule.test.ts',
    test: SCHEDULE,
    config: V2,
    ts: { file: SCHEDULED, from: '  if (!(await claim(pool, job, slot))) return null;\n', to: '' },
  },
  // the brief written before the shop's morning
  {
    sabotage: 'v2-wire-schedule-hour',
    file: 'test/v2/core/brief/schedule.test.ts',
    test: SCHEDULE,
    config: V2,
    ts: { file: SCHEDULED, from: 'if ((!held && shop.hour < BRIEF_HOUR) || Date.now() >= stopAt) continue;', to: 'if (Date.now() >= stopAt) continue;' },
  },
  // any role may run it
  {
    sabotage: 'v2-wire-schedule-role',
    file: 'test/v2/core/brief/schedule.test.ts',
    test: 'the back office runs only on a munshi_jobs connection',
    config: V2,
    ts: { file: SCHEDULED, from: '  await assertJobsRole(pool);\n', to: '' },
  },
);

CORE_WIRE_CASES.push(
  // a "release" minted as a display snapshot: release_check refuses the release
  {
    sabotage: 'v2-wire-release-purpose',
    file: 'test/v2/core/sites/release.test.ts',
    test: 'a release pins a fresh release snapshot of each site.* read, from the books, and the public reads its cells',
    config: V2,
    ts: { file: 'packages/core/src/snapshots.ts', from: "when $6::boolean then 'release'", to: "when false then 'release'" },
  },
  // any read may be published
  {
    sabotage: 'v2-wire-release-any-read',
    file: 'test/v2/core/sites/release.test.ts',
    test: 'a release snapshot is minted only of a site.* read',
    config: V2,
    ts: { file: 'packages/core/src/snapshots.ts', from: "if (release && (!name.startsWith('site.') || runId !== undefined)) throw new CoreError('invalid', { fields: ['name'] });", to: '' },
  },
);
