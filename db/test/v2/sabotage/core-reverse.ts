// Red-proofs of reversals (test/v2/core/reverse): each breaks one protection of a *.reverse in
// packages/core/src/commands-trade.ts, of item.create's kinds in commands-catalogue.ts, or one ref row they rely on, and
// its named test must fail. A reverse that forgets a row its record wrote is caught by the write set REV1 reads from
// the transaction stamp (a stock move, a repaid credit, a journal), or at commit by z_reversal_complete (a line).
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const rev = 'test/v2/core/reverse/rev1-reverse.test.ts';
const item = 'test/v2/core/reverse/item-kind.test.ts';
const TRADE = 'packages/core/src/commands-trade.ts';
const CATALOGUE = 'packages/core/src/commands-catalogue.ts';
const COMMANDS = 'packages/core/src/commands.ts';

const PURCHASE = 'purchase.reverse negates the bill, its lines, the stock it brought in and its journal, once each, netting to zero';
const PAYMENT = 'payment.reverse negates a repayment, the credit it repaid and its journal, and a supplier payment with its journal';
const SETTLEMENT = "settlement.reverse negates a payout and its journal, once; the day's settlement may then be recorded again";
const TWICE = 'a second reversal of an original is a conflict and writes nothing; two at once record one';
const REASON = 'a reversal needs a reason allowed for the reversal use, and a reversal is never itself reversed';
const OWN = "a reverse undoes only what its own record command wrote: a sale's stock move, tender and credit, and a repayment's credit, are not";
const WHO = 'who may reverse is ref.command_authority: the owner every book, a manager stock only, staff nothing; a refusal writes nothing';
const IDEM = 'a replayed reverse returns the first reversal and writes nothing';
const DRAFTED = "an approved draft's row is reversed by a person's own command: the reversal is theirs, the original keeps its decision";
const SERVICE =
  'item.create makes a good by default and a service when asked: a service is sold by the session with its duration, and never moves stock or is bought';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, text: string): Case => ({ sabotage, file, test, config: V2, sql: text });

export const CORE_REVERSE_CASES: Case[] = [
  // forgets a row its record wrote that no header check sees: the purchase's stock moves, the repayment's credit, the
  // payout's journal
  ts(
    'v2-rev1-forgets-stock-move',
    rev,
    PURCHASE,
    TRADE,
    "from books.stock_move where source_rel = 'books.purchase' and source_id = $4",
    'from books.stock_move where false and source_id = $4',
  ),
  ts(
    'v2-rev1-forgets-repaid-credit',
    rev,
    PAYMENT,
    TRADE,
    'from books.credit_entry where payment_id = $4 and created_txid = $5',
    'from books.credit_entry where false and payment_id = $4 and created_txid = $5',
  ),
  ts('v2-rev1-forgets-journal', rev, SETTLEMENT, TRADE, "await reverseJournal(ctx, 'books.settlement', i.settlementId, reversalId, i.reason);", ''),
  // forgets a child row: z_reversal_complete refuses the reversal at commit
  ts('v2-rev1-forgets-lines', rev, PURCHASE, TRADE, 'from books.purchase_line where purchase_id = $3', 'from books.purchase_line where false and purchase_id = $3'),
  // reverses twice: without core's check the guard's MS013 answers, which is invalid, not a conflict
  ts('v2-rev1-twice', rev, TWICE, TRADE, "if (done.length) throw new CoreError('conflict', { fields: [field] });", ''),
  // a reverse of a row another command wrote (a sale's stock move, tender or credit) is let through
  ts('v2-rev1-not-own-record', rev, OWN, TRADE, "row.reverses_id !== null || !by.includes(row.command ?? '')", 'row.reverses_id !== null'),
  // an approved draft's row audited without its draft's command: no reverse would ever undo it
  sql(
    'v2-rev1-drafted-unnamed',
    rev,
    DRAFTED,
    mutate('books.audit_row()', 'coalesce((select dr.command from approval.decision d', 'coalesce((select null::text from approval.decision d'),
  ),
  // a decision's reason code allowed for a reversal
  sql('v2-rev1-reason-use', rev, REASON, asOwner("insert into ref.reason_use (code, use) values ('not_now', 'reversal');")),
  // a manager reverses money
  sql('v2-rev1-manager-money', rev, WHO, asOwner("insert into ref.command_authority (command, role) values ('payment.reverse', 'manager');")),
  // the key is never claimed, so a replayed reverse runs again (and meets its own first reversal)
  ts(
    'v2-rev1-idem-skip-claim',
    rev,
    IDEM,
    COMMANDS,
    'const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, name, p);',
    'const claim = undefined;',
  ),
  // a service written as a good, or without its duration: the database refuses both, so no service can be made
  ts('v2-item1-service-as-good', item, SERVICE, CATALOGUE, "[t.tenantId, itemId, i.kind, good?.unit ?? 'session']", "[t.tenantId, itemId, 'good', good?.unit ?? 'piece']"),
  ts('v2-item1-service-duration', item, SERVICE, CATALOGUE, 'service?.durationMin ?? null', 'null'),
];
