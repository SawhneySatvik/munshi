// Red-proofs of the PayPal desk (collections on AG Grid; apps/web/test/paypal-desk.test.tsx). Each breaks one
// protection: a figure that is not its stored cell, a cell rendered as bare digits, a row action that writes the books,
// a desk shown to a role that sees no PayPal, an unsourced digit in the words. The named test must then fail.
import type { Case } from './case.ts';

const READ = 'apps/web/lib/server/paypal-desk.ts';
const CELLS = 'apps/web/components/paypal-desk/cells.tsx';
const ACTIONS = 'apps/web/app/app/paypal/actions.ts';
const PAGE = 'apps/web/app/app/paypal/page.tsx';
const WORDS = 'apps/web/lib/i18n-paypal-desk.ts';

const D1 = "the read: each row's figures are refs to stored cells the page carries, the balance the credit book's own cell";
const D2 = 'a figure in the grid renders from its cell, and tapping it opens the source drawer at that cell';
const D3 = 'Draft PayPal link from a row drafts it for approval and writes no book row; Draft reminder the same';
const D4 = 'Approve shows only for a member whose role may decide: the owner sees it; counter staff get no desk and their decide is refused';
const D5 = 'every digit on the desk is sourced, in both languages; English shows no Devanagari';

const web = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file: 'test/paypal-desk.test.tsx',
  test,
  config: 'vitest.config.ts',
  ts: { file, from, to },
});

export const PAYPAL_DESK_CASES: Case[] = [
  // The balance column cites the overdue cell instead of the balance.
  web(
    'v2-ppdesk-balance-wrong-cell',
    D1,
    READ,
    '      balance: cells ? refTo(balances, at, "balance", both("balanceLabel")) : null,',
    '      balance: cells ? refTo(balances, at, "overdue", both("balanceLabel")) : null,',
  ),
  // Days late cites the finding's overdue amount, not its days cell.
  web(
    'v2-ppdesk-days-wrong-cell',
    D1,
    READ,
    '    if (customerId) findingOf.set(customerId, { id: f.id, days: refTo(m, f.snapshotRow, "days_overdue", both("findingLabel")) });',
    '    if (customerId) findingOf.set(customerId, { id: f.id, days: refTo(m, f.snapshotRow, "overdue", both("findingLabel")) });',
  ),
  // A made link's amount is dropped: the column would read nothing for a link PayPal made.
  web(
    'v2-ppdesk-link-amount-dropped',
    D1,
    READ,
    '      linkAmount: waitingLink ? waitingLink.amount : link ? (linkFigure.get(link.id) ?? null) : null,',
    '      linkAmount: waitingLink ? waitingLink.amount : null,',
  ),
  // A customer PayPal says has paid is still offered a reminder.
  web(
    'v2-ppdesk-remind-after-paid',
    D1,
    READ,
    '      canRemind: canRemind && !!finding && reminder?.status !== "waiting" && state !== "paid",',
    '      canRemind: canRemind && !!finding && reminder?.status !== "waiting",',
  ),
  // A figure cell prints a number of its own instead of the cell's source chip.
  web('v2-ppdesk-figure-bare', D2, CELLS, '  return cell ? <Figure cell={cell} table /> : null;', '  return cell ? <span className="amt">{cell.row}</span> : null;'),
  // Drafting a link from a row also records a payment in the books.
  web(
    'v2-ppdesk-action-writes-books',
    D3,
    ACTIONS,
    '  return desk(await sendPaypalLinkAction(prev, form));',
    '  const s = await sendPaypalLinkAction(prev, form);\n  form.set("kind", "payment");\n  form.set("method", "cash");\n  form.set("amount", "1");\n  await (await import("../credit/actions")).recordCreditAction(null, form);\n  return desk(s);',
  ),
  // The page renders for a member the read gave no desk: no 404 for counter staff.
  web('v2-ppdesk-staff-no-404', D4, PAGE, '  if (!data) notFound();', '  if (!data) return null;'),
  // A digit in the words, from no cell.
  web(
    'v2-ppdesk-digit-in-words',
    D5,
    WORDS,
    '  totalLine: "Overdue at the morning brief: {overdue}, from {customers} customers.",',
    '  totalLine: "Overdue at the morning brief: {overdue}, from 3 customers.",',
  ),
];
