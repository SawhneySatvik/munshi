// Red-proofs of orders (BP-F5, test/v2/core/orders/): each breaks one protection of packages/core/src/{intake,
// commands-orders,queries-orders,jobs-orders}.ts, or the one key or grant its end-to-end test leans on, and the named
// test must fail.
import type { Case } from '../../sabotage.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const DIR = 'test/v2/core/orders';
const INTAKE = 'packages/core/src/intake.ts';
const ORDERS = 'packages/core/src/commands-orders.ts';
const QUERIES = 'packages/core/src/queries-orders.ts';
const JOBS = 'packages/core/src/jobs-orders.ts';

const INTAKE1 =
  'INTAKE1 each channel makes a new request from the public, with an ORD- code and no personal data: a cart stores the latest release and its lines, a message channel its inbox message';
const ORD1_CART =
  'ORD1 a site or widget request’s figures are the latest release’s price cells through the counter’s line function, with no offer discount, and every stored one recomputes from its release and lines alone to what intake returned';
const ORD5 =
  'ORD5 the public and webhook roles write no books.order*, nor does a run with no person: a request becomes an order only by a person’s order.confirm, in that order’s transaction';
const EXP1 =
  'EXP1 the order_requests job expires every tenant’s unhandled request past expires_at, an exact positive count per tenant, and leaves one not yet due and one confirmed';
const ORD1 =
  'ORD1 order.confirm prices each line by the books.price in effect or the taker’s own typed quote, labelled as theirs; every order line recomputes from stored ids; the confirmed step and the customer’s update come with it';
const ORD4 =
  'ORD4 an AI-drafted order’s quantities are spans the database re-parsed, each cited beside its item; a free digit, a quantity from another message or item, and a typed quote in a draft are refused; the approval writes the order as the approver';
const ORD4_WORDS =
  'ORD4 a quantity span in words, which the database stores on trust, is read again by core: a draft citing one misread is refused, one read right is proposed';
const ORD2 =
  'ORD2 each step is a person’s own command under ref.order_flow, writing the customer’s update where its template has one; a refused move writes nothing; ops.order_state equals every order’s latest step';
const ORD2_RACE = 'ORD2 two taps at once make one step and one conflict (23505)';
const ADV1 =
  'ADV1 an advance is payment.record naming the order, against customer_advance; order.cancel takes a reason and writes no money; what is held goes back as a refund or stays as the customer’s credit, never more than is held';
const M1 =
  'M1 a measurement is taken through the vault and an order line keeps its id; the contact’s erasure is held while the order is open or its advance unapplied, then erases the measurement and every value with it';
const ORD3 =
  'ORD3 orderDelivered, inside a sale naming the order with exactly its lines, writes the delivered step and the customer’s update; a sale short of a line, or no sale, is refused';
const BOARD = 'BOARD the board lists every live order at an open step from ops.order_state, as cells with no person’s name; a delivered, cancelled or voided order is off it';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file: `${DIR}/${file}`,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file: `${DIR}/${file}`, test, config: V2, sql: text });

export const CORE_ORDERS_CASES: Case[] = [
  // a cart priced from the oldest release, not the latest
  ts('v2-f5-intake-latest', 'intake.test.ts', INTAKE1, INTAKE, 'order by published_at desc, id desc limit 1', 'order by published_at, id limit 1'),
  // the cart's line amount drifts from the counter's line function (the recompute uses the same code, the test does not)
  ts('v2-f5-cart-line-function', 'intake.test.ts', ORD1_CART, INTAKE, 'amount: { minor: lineAmount(l.qtyMilli, price.minor)', 'amount: { minor: lineAmount(l.qtyMilli, price.minor) + 1'),
  // the stored lines are not the lines intake priced: the recompute from stored ids no longer matches what it returned
  ts('v2-f5-cart-stored-lines', 'intake.test.ts', ORD1_CART, INTAKE, 'qtyMilli: l.qtyMilli })))', 'qtyMilli: l.qtyMilli + 1 })))'),
  // a request already handled is confirmed again
  ts('v2-f5-ord5-confirm-twice', 'intake.test.ts', ORD5, ORDERS, "if (request && request.state !== 'new' && request.state !== 'drafted') throw new CoreError('conflict', { fields: ['requestId'] });", ''),
  sql('v2-f5-ord5-jobs-grant', 'intake.test.ts', ORD5, 'grant insert on books.order to munshi_jobs;'),
  // the job reaches requests not yet due (the flow trigger then fails the slot), or runs once with no tenant context
  ts('v2-f5-expiry-rule', 'intake.test.ts', EXP1, JOBS, 'expires_at <= now()', "expires_at <= now() + interval '8 days'"),
  ts('v2-f5-expiry-per-tenant', 'intake.test.ts', EXP1, JOBS, 'perTenant: true,', 'perTenant: false,'),
  // an order line's amount drifts from the counter's line function; the oldest price wins over the one in effect
  ts('v2-f5-order-line-function', 'confirm.test.ts', ORD1, ORDERS, 'gross: lineAmount(l.qtyMilli, unit)', 'gross: lineAmount(l.qtyMilli, unit) + 1'),
  ts('v2-f5-order-price-in-effect', 'confirm.test.ts', ORD1, ORDERS, 'order by p.item_id, p.effective_from desc', 'order by p.item_id, p.effective_from'),
  // ORD4: no draft check at all; a quantity from another message's read; a typed quote in a draft
  ts('v2-f5-ord4-no-checks', 'confirm.test.ts', ORD4, ORDERS, '      draftedLines,\n', ''),
  ts('v2-f5-ord4-other-message', 'confirm.test.ts', ORD4, ORDERS, 'snap.params.message_id !== message || ', ''),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of commands-orders.ts, not a template
  ts('v2-f5-ord4-quote', 'confirm.test.ts', ORD4, ORDERS, "if (l.quoteMinor !== undefined) bad.push(`lines[${n}].quoteMinor`);", ''),
  // core no longer reads a span again: a quantity in words the database took on trust backs a draft
  ts(
    'v2-f5-ord4-words',
    'confirm.test.ts',
    ORD4_WORDS,
    ORDERS,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of commands-orders.ts, not a template
    "} else if (!(await readsAs(c, await resolveRef(c, { ...ref, col: 'extract_id' }), l.qtyMilli))) {\n      bad.push(`lines[${n}].qtyMilli`);\n    }",
    '}',
  ),
  // a step with a template writes no customer's update; the projection keeps the first step
  ts('v2-f5-ord2-no-update', 'steps.test.ts', ORD2, ORDERS, 'const messageId = await customerUpdate(ctx, order, i.step);', 'const messageId = null;'),
  sql('v2-f5-ord2-projection', 'steps.test.ts', ORD2, mutate('books.order_state()', 'set step = excluded.step, step_no = excluded.step_no', 'set step = s.step, step_no = s.step_no')),
  sql('v2-f5-ord2-step-key', 'steps.test.ts', ORD2_RACE, asOwner('drop index books.order_step_no;')),
  // the advance posts against the wrong account; a refund beyond what is held; a kept advance becomes a debt
  ts('v2-f5-adv-account', 'steps.test.ts', ADV1, ORDERS, '[ADVANCE, -sign * i.amountMinor],', '[ACCOUNTS.receivable, -sign * i.amountMinor],'),
  ts(
    'v2-f5-adv-overrefund',
    'steps.test.ts',
    ADV1,
    ORDERS,
    "} else if (i.amountMinor > (await advanceHeld(c, order.id))) {\n    throw new CoreError('invalid', { fields: ['amountMinor'] });\n  }",
    '}',
  ),
  ts('v2-f5-adv-credit-sign', 'steps.test.ts', ADV1, ORDERS, '-i.amountMinor,', 'i.amountMinor,'),
  // the contact's erasure leaves the measurement's values (z_contact_measurements then refuses it at commit)
  ts(
    'v2-f5-m1-values',
    'steps.test.ts',
    M1,
    ORDERS,
    '    `update ops.measurement_value v set mm = null, erased_at = now() from ops.measurement m',
    '    `update ops.measurement_value v set mm = mm from ops.measurement m',
  ),
  // a sale short of an order line still delivers it; the delivered step writes no customer's update
  ts('v2-f5-ord3-line-match', 'steps.test.ts', ORD3, ORDERS, "if (off !== 0) throw new CoreError('invalid', { fields: ['lines'] });", ''),
  ts('v2-f5-ord3-update', 'steps.test.ts', ORD3, ORDERS, "const messageId = await customerUpdate(ctx, order, 'delivered');", 'const messageId = null;'),
  // a voided order stays on the board
  ts('v2-f5-board-voided', 'steps.test.ts', BOARD, QUERIES, '   and not exists (select 1 from books.order v where v.tenant_id = o.tenant_id and v.reverses_id = o.id)\n', ''),
];
