// Red-proofs of PayPal for an order (test/v2/core/paypal/paypal-order.test.ts): the link asks for the order's due
// cell and nothing else, the database binds the link to its draft's order, a paid order link records the order's
// advance, the inbox shows where it stands, and the links read is the office's and the shop's own; and the web app's
// (apps/web/test/paypal-order.test.tsx): the screens offer each step, and Ask reads the links. Each case breaks one
// protection; the named test must then fail.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/core/paypal/paypal-order.test.ts';
const COMMAND = 'packages/core/src/commands-paypal.ts';
const READS = 'packages/core/src/queries-paypal.ts';

const O1 =
  'chat to order to PayPal: the agent drafts the order, a person approves it, the link asks for the order’s due cell, and its message and its payment are each their own approval';
const O2 = 'nothing reaches PayPal or the books before approval; counter staff can neither ask for an order’s link nor approve one';
const O3 = 'the amount is the order’s due cell: a typed amount is refused, and so is another order’s due, the order’s total, another customer, or a closed order';
const O4 = 'the link guard binds the order: an approved draft’s link naming another order is refused by the database';
const O6 = 'a payment PayPal reports for an order cancelled since is no advance: its fix repays the customer’s credit instead, still only on approval';
const O5 = 'the PayPal links read is the office’s and the shop’s own: staff are refused, another shop sees none, the agent role reads no link table';

const W1 = 'Ask: which PayPal payments are not in the books yet is answered from the links read, each figure a cell equal to the link\'s amount';
const W2 =
  "the seeded walk: the inbox shows the order a message became and that PayPal says paid; the card offers to record it, and only its approval writes the order's advance";
const W3 = "chat to order to PayPal from the screens: Draft order, approve it, Send PayPal link for the order's due cell, approve it, its WhatsApp message, approve that";

const web = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file: 'test/paypal-order.test.tsx',
  test,
  config: 'vitest.config.ts',
  ts: { file, from, to },
});
const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: FILE, test, config: V2, ts: { file, from, to } });
const sql = (sabotage: string, test: string, statement: string): Case => ({ sabotage, file: FILE, test, config: V2, sql: statement });

export const PAYPAL_COMMERCE_CASES: Case[] = [
  // The figure may be any order's due: the snapshot's own order is not compared with the draft's.
  ts('v2-ppc-figure-any-order', O3, COMMAND, '    rows[0].params[want.param] !== target ||\n', ''),
  // An order's link is checked for neither its customer nor whether the order is still open.
  ts(
    'v2-ppc-order-customer',
    O3,
    COMMAND,
    "    if (text(await at('customer_id')) !== p.customerId) bad.push('customerId');\n    if (text(await at('open')) !== 'yes') bad.push('orderId');",
    "    if (text(await at('open')) !== 'yes') bad.push('orderId');",
  ),
  ts('v2-ppc-order-closed', O3, COMMAND, "    if (text(await at('open')) !== 'yes') bad.push('orderId');", ''),
  // What an order still needs forgets the advance it holds: a link would ask again for money already paid.
  ts('v2-ppc-due-ignores-advance', O2, READS, 'greatest(0, o.lines_total - o.held)::bigint as due', 'o.lines_total as due'),
  // Counter staff may decide a PayPal link.
  sql('v2-ppc-staff-approves', O2, asOwner("insert into ref.command_authority (command, role) values ('paypal.request', 'staff');")),
  // The link table's guard no longer binds the order the draft names.
  sql('v2-ppc-guard-order', O4, mutate('ops.paypal_link_guard()', "\n            and (dr.payload ->> 'orderId') is not distinct from new.order_id::text", '')),
  // A paid link for an order cancelled since is still recorded as that closed order's advance.
  ts('v2-ppc-closed-order-advance', O6, 'packages/agent/src/recipes.ts', '  if (orderId && due && txt(due.rows[0]?.open) === "yes") {', '  if (orderId && due) {'),
  // A paid order link is recorded as a credit repayment, not the order's advance.
  ts('v2-ppc-record-as-credit', O1, 'packages/agent/src/recipes.ts', '  const orderId = txt(row.order_id);', '  const orderId = null;'),
  // The inbox no longer says what order a message became, or where its link stands.
  ts('v2-ppc-inbox-order', O1, 'packages/core/src/views-office.ts', 'order: m.order_code ? { code: m.order_code, paypal: m.paypal_state } : null,', 'order: null,'),
  // The links read is open to counter staff.
  ts('v2-ppc-links-for-staff', O5, 'packages/core/src/read-roles.ts', "  'paypal.links': office(),", "  'paypal.links': all(),"),
  // The link table answers every shop's rows.
  sql('v2-ppc-links-unscoped', O5, asOwner('alter table ops.paypal_link disable row level security;')),
  // The demo build seeds no PayPal order walk.
  {
    sabotage: 'v2-ppc-dev-seed-no-walk',
    file: 'test/v2/core/paypal/paypal-seed.test.ts',
    test: 'the demo build seeds the PayPal order walk on the kirana: a paid order link not yet in the books, and a fresh message for the agent',
    config: V2,
    ts: { file: 'db/src/dev.ts', from: '  await seedKiranaPaypalOrder({ app, jobs, pub: showcase.pub }, k);\n', to: '' },
  },
  // Ask's credit desk no longer reads the PayPal links.
  web('web-ppc-ask-no-links', W1, 'packages/agent/src/tools.ts', '  credit: byName("credit_balances", "paypal_links"),', '  credit: byName("credit_balances"),'),
  // The inbox loader drops the order a message became.
  web('web-ppc-inbox-no-order', W2, 'apps/web/lib/server/office.ts', '        order: m.order,', '        order: null,'),
  // The order's card never offers a link: what the order needs is not carried to the screen.
  web('web-ppc-card-no-due', W3, 'apps/web/lib/server/orders.ts', 'due: o.due ? refTo(keep(mintedOf(o.due)), 0, "due", P) : null,', 'due: null,'),
];
