// Red-proofs of PayPal live in the app (sandbox): the DB gates (test/v2/core/paypal/paypal-app.test.ts),
// the registry totality gates PayPal now joins (R3, GRAPH4), and the web app's (apps/web/test/paypal-app.test.tsx). Each
// breaks one protection; the named test must then fail. Every named test makes its own state (the harness runs it
// alone), so each fails on the expectation that guards the protection, never on a missing fixture.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const DB_TEST = 'test/v2/core/paypal/paypal-app.test.ts';
const RECIPES = 'packages/agent/src/recipes.ts';
const COMMAND = 'packages/core/src/commands-paypal.ts';
const CORE = 'packages/core/src/payments-paypal.ts';
const MESSAGING = 'packages/core/src/commands-messaging.ts';

const PP1 = 'the link draft (the finding’s PayPal fix) writes nothing before approval: no book row, no link, no message, no PayPal call';
const PP2 = 'approval creates the link under the approver and calls nothing; the customer’s message is only drafted once PayPal made the link, and goes once on its own approval';
const PP3 = 'counter staff cannot propose or approve a PayPal link, cannot draft its message, and read nothing of PayPal';
const PP4 = 'a paid notice writes no book row and no draft; the watcher raises it, its fix drafts payment.record, and only a person’s approval writes it';
const PP5 = 'the amount is the cited cell (the link’s, the message’s words), and a draft citing any other cell is refused';
const PP7 = 'core’s own registries hold PayPal: its commands, its reads, its watcher, the recipe commands and their trace labels';
const PP8 = 'a message names its link: one waiting for a link since cancelled goes stale, never carrying the link asked for again';
const PP9 = 'a paid link holds back a new link only until the books catch up: a later payment by any means lifts it';
const PP10 = 'an invoice’s link: its message cites the invoice’s open credit and speaks of a bill';
const R3 = "every named read has a role entry, and Ask's desks offer each role only reads it may make";
const GRAPH4 = 'every named read is a source-row read, a total or unwalkable, exactly once';
const W6 = "overdue udhaar offers a PayPal link beside the reminder, labelled PayPal sandbox; its draft's card shows the cited amount and the label";
const W3 = 'counter staff see no PayPal surface: no panel on the credit book, no PayPal fix, and a PayPal fix of theirs is refused';
const WJ =
  "the overdue walkthrough: the overdue card's PayPal fix drafts a link per overdue customer, skipping live and paid-unrecorded ones; a customer with no phone gets the link but no message; a recorded demo payment is recorded only by a person's approval";
const WP = 'a pending link: an approved link whose link cannot be read back says the approval is done and the link pending, never an error';
const WR = 'recorded mode: with no sandbox keys, the PayPal fix and the link card say recorded and claim no call to PayPal; an invoice link speaks of a bill';

const db = (sabotage: string, test: string, file: string, from: string, to: string, testFile = DB_TEST): Case => ({
  sabotage,
  file: testFile,
  test,
  config: V2,
  ts: { file, from, to },
});
const web = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file: 'test/paypal-app.test.tsx',
  test,
  config: 'vitest.config.ts',
  ts: { file, from, to },
});

export const PAYPAL_APP_CASES: Case[] = [
  // The person's pick is ignored: overdue udhaar's fix is always the reminder.
  db('v2-ppapp1-choice-ignored', PP1, RECIPES, '  if (choice?.fix === "paypal") {', '  if (choice?.fix === ("none" as string)) {'),
  // The link draft no longer cites the finding's overdue cell.
  db(
    'v2-ppapp1-overdue-uncited',
    PP1,
    RECIPES,
    '  const basedOn = [ref(f.snapshotId, f.row, "customer_id"), ref(f.snapshotId, f.row, "overdue"), figure];',
    '  const basedOn = [ref(f.snapshotId, f.row, "customer_id"), figure];',
  ),
  // Proposing a link already asks PayPal.
  db(
    'v2-ppapp1-call-at-proposal',
    PP1,
    COMMAND,
    '  await lockDebt(c, p.customerId);\n  if (await debtBusy(c, p.customerId, basedOn)) bad.push',
    "  await (await import('./jobs-paypal.ts')).wiredPayPal()?.createLink({ requestId: p.customerId, amountMinor: 1, currency: 'INR', reference: p.customerId });\n  await lockDebt(c, p.customerId);\n  if (await debtBusy(c, p.customerId, basedOn)) bad.push",
  ),
  // The message is drafted before PayPal made the link (the approval's sweep has not run).
  db('v2-ppapp2-message-before-made', PP2, CORE, "    const outcome: LinkMessage | null = !at.sent\n      ? 'not_made'\n      : at.messaged", '    const outcome: LinkMessage | null = at.messaged'),
  // The message's draft is approved in the same request that drafted it: no person saw its words.
  db(
    'v2-ppapp2-message-auto-approved',
    PP2,
    CORE,
    "    return { outcome: 'drafted' as const, draftId };",
    "    await (await import('./approvals.ts')).decide(pool, session, draftId, 'approved');\n    return { outcome: 'drafted' as const, draftId };",
  ),
  // A link may go to its customer twice (and two approvals are no longer decided one at a time).
  db('v2-ppapp2-message-twice', PP2, MESSAGING, "          return (await linkMessaged(c, link.id)) ? ['linkId'] : [];", '          return [];'),
  // Counter staff may ask for a PayPal link.
  db('v2-ppapp3-staff-proposes', PP3, COMMAND, '  await refuseNonApprover(c);\n  const p = payload as PaypalRequest;', '  const p = payload as PaypalRequest;'),
  // Counter staff may draft a link's message.
  db('v2-ppapp3-staff-messages', PP3, CORE, "    if (!may.length || !(await mayReadIn(c, 'paypal.event'))) throw new CoreError('refused');\n", ''),
  // Counter staff may approve a PayPal payment drafted from PayPal's notice.
  db(
    'v2-ppapp4-staff-records',
    PP4,
    'packages/core/src/commands-trade.ts',
    "  if ((payload as { method?: unknown }).method === 'paypal' && !(await mayReadIn(c, 'paypal.event'))) throw new CoreError('refused');\n",
    '',
  ),
  // The PayPal watcher is not scheduled: a paid notice the books do not show raises nothing.
  db('v2-ppapp4-no-watcher', PP4, 'packages/core/src/watchers.ts', "  { kind: 'paypal_unrecorded', query: 'watch.paypal_unrecorded', needs: 'credit', desk: 'sales', impact: 'amount' },\n", ''),
  // A link PayPal reports paid, unrecorded in the books, no longer holds back a new link for the customer.
  db('v2-ppapp4-paid-not-busy', PP4, COMMAND, '      where l.customer_id = $1 and e.currency = (select currency from ops.tenant)', '      where false and e.currency = (select currency from ops.tenant)'),
  // The message's amount is typed words, not the cited cell rendered.
  db('v2-ppapp5-message-amount-typed', PP5, MESSAGING, ".replaceAll('{amount}', amount).replaceAll('{link}', m.where);", ".replaceAll('{amount}', 'the balance').replaceAll('{link}', m.where);"),
  // The link's figure is not checked against the customer's balance.
  db('v2-ppapp5-figure-unchecked', PP5, COMMAND, "    bad.push('figure');", '    void 0;'),
  // The registries drop PayPal: its commands, or its reads (the role map and the walk maps then name reads not registered).
  db('v2-ppapp7-commands-unwired', PP7, 'packages/core/src/commands.ts', '  ...PAYPAL_COMMANDS,\n', ''),
  db('v2-ppapp7-queries-unwired-r3', R3, 'packages/core/src/queries.ts', '  ...PAYPAL_QUERIES,\n', '', 'test/v2/core/agent/role-reads.test.ts'),
  db('v2-ppapp7-queries-unwired-graph4', GRAPH4, 'packages/core/src/queries.ts', '  ...PAYPAL_QUERIES,\n', '', 'test/v2/core/memory/mem.test.ts'),
  // A message re-reads its link by the cell it cites, not the link it names: a cancelled link's waiting message would
  // carry the link asked for again.
  db(
    'v2-ppapp8-link-by-figure',
    PP8,
    MESSAGING,
    "        where l.id = $1 and l.status = 'sent' and l.paypal_id is not null and l.mode is not null",
    "        where l.figure = (select x.figure from ops.paypal_link x where x.id = $1) and l.status = 'sent' and l.paypal_id is not null and l.mode is not null",
  ),
  // A paid link holds the customer back until a payment by PayPal's own reference: a cash payment after it lifts nothing.
  db('v2-ppapp9-lift-only-by-reference', PP9, COMMAND, '                           and (p.reference = e.reference or p.created_at > e.received_at)', '                           and p.reference = e.reference'),
  // An invoice link's message speaks of the account, not the bill.
  db('v2-ppapp10-invoice-words', PP10, MESSAGING, '  return { template: PAYPAL_TEXT[link.purpose], where };', '  return { template: PAYPAL_TEXT.credit, where };'),
  // The finding's PayPal fix, the tray card, the recorded demo payment, or the panel's "never moves money" lose their label.
  web(
    'web-ppapp6-fix-unlabelled',
    W6,
    'apps/web/components/FindingMoves.tsx',
    '            <Sticker tone="ink">{paypal === "sandbox" ? p.label : p.recordedLabel}</Sticker>\n          </form>',
    '          </form>',
  ),
  web(
    'web-ppapp6-tray-unlabelled',
    W6,
    'apps/web/components/TrayCard.tsx',
    '            <Sticker tone="ink">{draft.paypalMode === "sandbox" ? p.label : p.recordedLabel}</Sticker>{" "}',
    '            {" "}',
  ),
  web('web-ppapp6-recorded-paid-unlabelled', W6, 'apps/web/components/PayPalLink.tsx', '{recorded ? p.paidRecorded : p.paid}', '{p.paid}'),
  web('web-ppapp6-never-moves-dropped', W6, 'apps/web/components/PayPalLink.tsx', '</Sticker> {p.neverMoves}', '</Sticker>'),
  // The message's card no longer shows its words before its approval.
  web('web-ppapp6-message-unseen', W6, 'apps/web/components/TrayCard.tsx', '            (draft.paypalMessage ? (', '            (draft.paypalMessage && false ? ('),
  // The overdue card's PayPal fix drafts a new link for a customer PayPal says paid, the books not showing it yet.
  web('web-ppapp-card-drafts-paid', WJ, COMMAND, '      where l.customer_id = $1 and e.currency = (select currency from ops.tenant)', '      where false and e.currency = (select currency from ops.tenant)'),
  // An approved link whose link cannot be read back shows an error over the approval.
  web('web-ppapp-pending-error', WP, 'apps/web/lib/server/paypal-deliver.ts', '    log("paypal.link_unread", { code: "link_unread" }, "warn");\n    return "pending";', '    throw new Error("link_unread");'),
  // Recorded mode claims a call to PayPal where the person decides.
  web(
    'web-ppapp-recorded-claims-paypal',
    WR,
    'apps/web/components/TrayCard.tsx',
    '(draft.paypalMode === "sandbox" ? p.trayNote : p.trayNoteRecorded)',
    'p.trayNote',
  ),
  // Counter staff get the PayPal panel on the credit book.
  web('web-ppapp3-staff-panel', W3, 'apps/web/lib/server/paypal-panel.ts', ' || !(await mayReadIn(c, "paypal.event"))', ''),
];
