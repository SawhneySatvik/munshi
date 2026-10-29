// Red-proofs of the books gates of files 10–13 and 15 (test/v2/gates/books-core.test.ts): each breaks one rule of
// books.write, a table's b_ or z_ function, a composite key or a ref row, so that exactly one test must go RED.
import type { Case } from './case.ts';
import { asOwner, dropForeignKey, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/books-core.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const WRITE = 'books.write()';

const G2_NONE = 'G2 every books table refuses a write with no decision and no direct command';
const G2_SCOPE = 'G2 a direct command admits only the books tables ref.command_table names for it';
const G3 = 'G3 who may run or approve each command of files 10–21 is BLUEPRINT §2.4’s table, and no runtime role changes it';
const G5 = 'G5 every books table refuses an UPDATE and a DELETE, even as the owner, by the append-only rule; the sandbox reset deletes';
const G6 = 'G6 every journal entry balances per currency at commit, and has lines';
const G11 = 'G11 every child books table takes a row only in its parent’s transaction';
const KEY1 = 'KEY1 a service or a package never moves stock or is bought; a line keeps its sale’s currency, a credit entry its sale’s customer, a salary line its terms';
const TOT1 = 'TOT1 a sale’s total is its lines’ gross and a purchase’s its lines’ cost, rounded half away from zero, checked at commit';
const REV1_HEADER = 'REV1 a reversal header that leaves a child of its original unreversed fails at commit; with each child reversed it commits';
const REV1_NET = 'REV1 a full sale.reverse nets every table it wrote to zero, and a partial amount is refused';
const LIVE1 = 'LIVE1 two purchases of one supplier’s bill at once, or two settlements of one channel and day, record one row and refuse the other; a reversed one is recorded again';
const K6 = 'K6 consent names the customer’s contact in effect; a customer re-linked to a new phone has no consent until the new contact gives it';
const PAY1 = 'PAY1 payment.record cannot pay a staff member and wages.pay can; staff mark only their own day, and never after an owner’s or manager’s mark';
const SAL1 = 'SAL1 recovered advances never exceed those outstanding; two live salary lines for one staff member never cover overlapping periods; live leave never overlaps';
const SLOT1 = 'SLOT1 a service’s revision gives its duration, and no other item’s does';
const H = 'H2 a bill’s lines are accepted only in the transaction that read it; H1 a shelf count’s raw answer is hashed and its boxes counted';

export const BOOKS_CORE_CASES: Case[] = [
  t(G2_NONE, 'v2-g2-books-no-command', mutate(WRITE, "raise exception 'book write refused: no approved decision and no direct command' using errcode = 'MS001';", 'return new;')),
  t(G2_SCOPE, 'v2-g2-books-scope', mutate(WRITE, 'perform 1 from ref.command_table ct where ct.command = by_command and ct.rel = this_rel;', 'perform 1;')),
  t(G3, 'v2-g3-manager-prices', asOwner("insert into ref.command_authority (command, role) values ('price.set', 'manager');")),
  t(G5, 'v2-g5-books-update', mutate(WRITE, "if tg_op = 'UPDATE' then", "if tg_op = 'UPDATE' and false then")),
  t(G6, 'v2-g6-unbalanced', mutate('books.check_balanced()', 'group by l.currency having sum(l.amount_minor) <> 0', 'group by l.currency having false')),
  t(G11, 'v2-g11-books-parent', mutate(WRITE, "(parent ->> 'created_txid')::bigint is distinct from txid_current()", 'false')),
  // the stock key without its kind: a service moves stock (the ruling's red-proof)
  t(KEY1, 'v2-key1-stock-service', dropForeignKey('books.stock_move', ['tenant_id', 'item_id', 'item_kind'])),
  t(KEY1, 'v2-key1-salary-terms', dropForeignKey('books.salary_line', ['tenant_id', 'terms_id', 'staff_id', 'pay_kind', 'pay_minor', 'currency'])),
  t(TOT1, 'v2-tot1-sale', mutate('books.sale_total()', 'if new.total_minor is distinct from coalesce(', 'if false and new.total_minor is distinct from coalesce(')),
  // the counter rounds half away from zero; truncation is a different total
  t(TOT1, 'v2-tot1-rounding', mutate('books.purchase_total()', 'round(l.qty_milli::numeric * l.unit_cost_minor / 1000)', 'trunc(l.qty_milli::numeric * l.unit_cost_minor / 1000)')),
  t(REV1_HEADER, 'v2-rev1-complete', mutate('books.check_reversal()', 'if left_over > 0 then', 'if false then')),
  t(REV1_NET, 'v2-rev1-partial', mutate(WRITE, 'if (r ->> col)::numeric is distinct from -((orig ->> col)::numeric) then', 'if false then')),
  // b_one_live without its locks (both: the chain lock alone would still serialise the writers)
  t(LIVE1, 'v2-live1-lock', [
    mutate('books.one_live()', 'perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));', ''),
    mutate('books.one_live()', "perform pg_advisory_xact_lock(7, hashtext(new.tenant_id::text || 'purchase' || (r ->> 'supplier_id') || (r ->> 'bill_no')));", ''),
    mutate('books.one_live()', "perform pg_advisory_xact_lock(7, hashtext(new.tenant_id::text || 'settlement' || (r ->> 'channel') || (r ->> 'business_date')));", ''),
  ].join('\n')),
  t(LIVE1, 'v2-live1-rule', mutate('books.one_live()', 'if live then', 'if false then')),
  // consent keyed on the customer alone
  t(K6, 'v2-k6-customer-alone', asOwner('drop trigger b_consent_contact on books.customer_consent;')),
  t(PAY1, 'v2-pay1-kind', mutate('books.payment_kind()', "if by_command is distinct from 'wages.pay' and by_command is distinct from 'advance.give' then", 'if false then')),
  t(PAY1, 'v2-pay1-rank', mutate('books.attendance_rank()', "and a.marked_by_role in ('owner', 'manager')) then", 'and false) then')),
  t(SAL1, 'v2-sal1-recovery', mutate('books.advance_recovery()', 'if new.advance_recovered_minor > outstanding then', 'if false then')),
  t(SAL1, 'v2-sal1-one-live-pay', mutate('books.one_live_pay()', 'if exists (select 1 from books.salary_line l', 'if false and exists (select 1 from books.salary_line l')),
  t(SAL1, 'v2-sal1-leave', mutate('books.leave_overlap()', 'if exists (select 1 from books.leave l', 'if false and exists (select 1 from books.leave l')),
  t(SLOT1, 'v2-slot1-revision', mutate('books.revision_kind()', 'if (new.duration_min is not null) is distinct from', 'if false and (new.duration_min is not null) is distinct from')),
  t(H, 'v2-h2-bill-line', mutate('ops.evidence_guard()', "elsif tg_table_name = 'bill_line' and not exists (", 'elsif false and not exists (')),
  t(H, 'v2-h1-hashed', 'alter table ops.shelf_count drop constraint shelf_count_hashed;'),
];
