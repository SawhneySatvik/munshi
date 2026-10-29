// Red-proofs of the offers, loyalty, packages and GST gates (test/v2/gates/16-offers-loyalty, 17-packages, 18-gst).
// Each breaks one rule of a 16–18 trigger, key or check so that the named test goes RED. The chain lock already orders
// a tenant's book writes from its sale header, so dropping b_loyalty_tally's or b_invoice_number's own lock changes
// nothing a test can see: those rules are red-proved by breaking the arithmetic, the key or the below-zero check.
// P2's entry is its transaction's first book row, so there the lock is what orders the writers: both lines go.
import type { Case } from '../../sabotage.ts';
import { asOwner, dropCheck, dropForeignKey, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const at = (file: string) => (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: `test/v2/gates/${file}.test.ts`, test, config: V2, sql });
const t16 = at('16-offers-loyalty');
const t17 = at('17-packages');
const t18 = at('18-gst');
const CAP = 'books.offer_cap()';
const TALLY = 'books.package_tally()';
const NUMBER = 'books.invoice_number()';

const OFFER_CAP = 'b_offer_cap an offer’s live redemptions stay within max_redemptions, a customer’s within per_customer_limit (which needs a named customer); a sale is one redemption; a reversed one frees its place';
const OFFER_BY = 'b_offer_by_person an offer is a person’s own command or a person’s draft, never an AI run’s; it holds its kind’s amount and only it; item offers alone have items; it ends once';
const L1 = 'L1 two sales redeeming a customer’s last points at once: one commits and the other is refused (MS009); no balance goes below zero';
const L2 = 'L2 a forged seq or balance is overwritten: each entry follows the customer’s last, its balance the running sum';
const TOT1_SALE = 'TOT1 a sale’s total is its lines’ gross less its discounts, checked at commit';
const DISCOUNT = 'a discount names exactly its source’s row: a manual one a discount reason, a loyalty one its own sale’s redemption; on a line of its sale; positive unless a reversal';
const REV1 = 'REV1 a sale’s reversal reverses its discounts under the reversal header, or fails at commit';
const P1 = 'P1 sell, redeem, expire: the holding’s sessions and value net to zero, and so does its liability in the journal, every entry balanced';
const P2 = 'P2 two redemptions of a holding’s last session at once: one commits and the other is refused (MS009)';
const P3 = 'P3 a holding is its sale’s named customer’s; a plan is a package item, and only a sessions plan has lines';
const P4 = 'P4 each entry kind is its command’s: an expiry only under an approved package.expire, a redemption only by package.redeem, a sale only in its holding’s sale';
const P4_EXPIRY = 'P4 a session is redeemed only until its holding’s expires_on, in the shop’s zone; after it the holding is for package.expire';
const INV1 = 'INV1 20 concurrent sales on one series get numbers 1..20 with no gap and no repeat; a rolled-back sale leaves no gap; the first credit note after tax invoice 1 is credit note 1 and is accepted';
const INV2 = 'INV2 the number, time, year, series and GSTIN are the database’s; credit notes number their own series; a later number never has an earlier time; a backdated sale for a registered shop is refused (MS016)';
const TOT1_INVOICE = 'TOT1 an invoice line is its sale line’s taxed on its discounted price (D-052): its discount, total, rate, the half-up taxable value, the tax and its CGST share; the invoice’s totals its lines’; every sale line on it, every discount on a line (MS004)';
const GST_REG = 'GST a registration’s GSTIN is its state’s and only an unregistered one has none; an invoice takes the latest in effect for its shop’s state; a composition shop issues a bill of supply carrying no tax, a regular one a tax invoice, an unregistered one none';
const GST_NOTE = 'GST a credit note is a reversal sale’s, naming its original sale’s invoice; a tax invoice never is; an invoice is its sale’s shop’s, which has a series';

const NOT_REVERSED = 'and not exists (select 1 from books.sale_discount r where r.tenant_id = d.tenant_id and r.reverses_id = d.id)';

export const OFFERS_PACKAGES_GST_CASES: Case[] = [
  t16(OFFER_CAP, 'v2-offer-cap-max', mutate(CAP, 'if o.max_redemptions is not null and (', 'if false and (')),
  t16(OFFER_CAP, 'v2-offer-cap-customer', mutate(CAP, 'if o.per_customer_limit is not null then', 'if false then')),
  // every discounted line its own redemption
  t16(OFFER_CAP, 'v2-offer-cap-one-sale', mutate(CAP, 'and d.sale_id = new.sale_id and d.offer_id = new.offer_id) then', 'and false) then')),
  // a reversed redemption still counted
  t16(OFFER_CAP, 'v2-offer-cap-freed', mutate(CAP, `\n          ${NOT_REVERSED}) >= o.max_redemptions then`, ') >= o.max_redemptions then')),
  t16(OFFER_BY, 'v2-offer-by-person', mutate('books.offer_by_person()', "and dr.source = 'run') then", 'and false) then')),
  t16(OFFER_BY, 'v2-offer-category', dropCheck('books.offer', "(scope = 'category'")),
  t16(OFFER_BY, 'v2-offer-item-scope', dropForeignKey('books.offer_item', ['tenant_id', 'offer_id', 'offer_scope'])),
  t16(OFFER_BY, 'v2-offer-end-once', asOwner('drop index books.offer_end_once;')),
  // the table's check still refuses a negative balance, but not as MS009
  t16(L1, 'v2-l1-below-zero', mutate('books.loyalty_tally()', 'if new.balance_after < 0 then', 'if false then')),
  t16(L2, 'v2-l2-balance', mutate('books.loyalty_tally()', 'new.balance_after := coalesce(last_balance, 0) + new.points;', '')),
  t16(L2, 'v2-l2-seq', mutate('books.loyalty_tally()', 'new.seq := coalesce(last_seq, 0) + 1;', '')),
  t16(TOT1_SALE, 'v2-tot1-discounts', mutate('books.sale_total()',
    '\n     - coalesce((select sum(d.amount_minor) from books.sale_discount d where d.tenant_id = new.tenant_id and d.sale_id = new.id), 0)', '')),
  t16(DISCOUNT, 'v2-discount-loyalty-sale', dropForeignKey('books.sale_discount', ['tenant_id', 'loyalty_entry_id', 'sale_id'])),
  t16(DISCOUNT, 'v2-discount-manual-reason', dropCheck('books.sale_discount', "(source = 'manual'")),
  t16(REV1, 'v2-rev1-discounts', mutate('books.check_reversal()', 'if left_over > 0 then', 'if false then')),

  t17(P1, 'v2-p1-value', mutate(TALLY, 'new.value_after := coalesce(last_value, 0) + new.value_minor;', 'new.value_after := greatest(new.value_minor, 0);')),
  t17(P1, 'v2-p1-sessions', mutate(TALLY, 'new.sessions_after := coalesce(last_sessions, 0) + new.sessions;', 'new.sessions_after := greatest(new.sessions, 0);')),
  t17(P2, 'v2-p2-lock', [
    mutate(TALLY, 'perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));', ''),
    mutate(TALLY, 'perform pg_advisory_xact_lock(4, hashtext(new.tenant_id::text || new.holding_id::text));', ''),
  ].join('\n')),
  t17(P2, 'v2-p2-below-zero', mutate(TALLY, 'if new.value_after < 0 or new.sessions_after < 0 then', 'if false then')),
  t17(P3, 'v2-p3-holding-customer', dropForeignKey('books.package_holding', ['tenant_id', 'sale_id', 'customer_id'])),
  t17(P3, 'v2-p3-plan-kind', dropForeignKey('books.package_plan_line', ['tenant_id', 'plan_id', 'plan_kind'])),
  t17(P4, 'v2-p4-kind', mutate(TALLY, 'if by_command is distinct from owner_command then', 'if false then')),
  t17(P4_EXPIRY, 'v2-p4-expired-holding', mutate(TALLY, "if new.kind = 'redeemed' and (select h.expires_on", "if false and (select h.expires_on")),
  t17(P4, 'v2-p4-sold-in-sale', mutate(TALLY, "if new.kind = 'sold' and not exists (", 'if false and not exists (')),

  // M1: the key without the kind, so credit note 1 collides with tax invoice 1
  t18(INV1, 'v2-inv1-kind-key', asOwner('drop index books.invoice_no; create unique index invoice_no on books.invoice (tenant_id, shop_id, series, fy, number);')),
  // 02's check_reversal over every child, an invoice too: a sale with an invoice can then never be reversed
  t18(INV1, 'v2-inv1-reversal-children', mutate('books.check_reversal()', ' and b.reversible loop', ' loop')),
  // a sequence for max + 1: a rolled-back sale leaves its number unused
  t18(INV1, 'v2-inv1-sequence', [
    'create sequence books.invoice_probe_seq; grant usage on sequence books.invoice_probe_seq to munshi_app;',
    mutate(NUMBER, 'new.number := coalesce((select max(i.number)', "new.number := nextval('books.invoice_probe_seq') - 1 + 0 * coalesce((select max(i.number)"),
  ].join('\n')),
  // the max over the shop's series of every kind
  t18(INV1, 'v2-inv1-max-key', mutate(NUMBER, 'and i.kind = new.kind and i.fy = new.fy), 0) + 1;', 'and i.fy = new.fy), 0) + 1;')),
  t18(INV2, 'v2-inv2-caller-time', mutate(NUMBER, 'new.issued_at := clock_timestamp();', '')),
  t18(INV2, 'v2-inv2-now', mutate(NUMBER, 'new.issued_at := clock_timestamp();', 'new.issued_at := now();')),
  t18(INV2, 'v2-inv2-backdated', mutate(NUMBER, "if sold.sold_at < now() - interval '10 minutes' or sold.sold_at > now() + interval '10 minutes' then", 'if false then')),
  t18(INV2, 'v2-inv2-seller', mutate(NUMBER, 'new.seller_gstin := reg.gstin;', '')),
  t18(TOT1_INVOICE, 'v2-tot1-invoice-line', mutate('books.invoice_total()', 'l.cgst_minor + l.sgst_minor <> s.tax_minor or ', '')),
  t18(TOT1_INVOICE, 'v2-tot1-invoice-cover', mutate('books.invoice_total()',
    '\n     or lines <> (select count(*) from books.sale_line s where s.tenant_id = new.tenant_id and s.sale_id = new.sale_id)', '')),
  // D-052: the undiscounted gross kept on the invoice (every line's discount read as nothing)
  t18(TOT1_INVOICE, 'v2-d052-undiscounted', mutate('books.invoice_total()', 'select coalesce(sum(d.amount_minor), 0) as off', 'select coalesce(sum(d.amount_minor) * 0, 0) as off')),
  // D-052: the taxable value truncated, not rounded half away from zero
  t18(TOT1_INVOICE, 'v2-d052-rounding', mutate('books.invoice_total()', 'l.taxable_minor <> round((s.gross_minor - x.off)', 'l.taxable_minor <> trunc((s.gross_minor - x.off)')),
  t18(TOT1_INVOICE, 'v2-d052-split', mutate('books.invoice_total()', ' or l.cgst_minor <> trunc((l.cgst_minor + l.sgst_minor) / 2.0)', '')),
  t18(TOT1_INVOICE, 'v2-d052-discount-shown', mutate('books.invoice_total()', 'or l.discount_minor <> x.off ', '')),
  t18(TOT1_INVOICE, 'v2-d052-rate', mutate('books.invoice_total()', ' or l.rate_bp <> s.tax_rate_bp', '')),
  t18(TOT1_INVOICE, 'v2-d052-whole-sale', mutate('books.invoice_total()',
    '\n     or exists (select 1 from books.sale_discount d where d.tenant_id = new.tenant_id and d.sale_id = new.sale_id and d.line_no is null)', '')),
  t18(GST_REG, 'v2-gst-latest', mutate(NUMBER, 'order by r.effective_from desc, r.created_at desc, r.id desc limit 1;', 'order by r.effective_from, r.created_at, r.id limit 1;')),
  t18(GST_REG, 'v2-gst-scheme-kind', mutate(NUMBER,
    "\n     or (reg.scheme = 'regular' and new.kind = 'bill_of_supply') or (reg.scheme = 'composition' and new.kind = 'tax_invoice')", '')),
  t18(GST_REG, 'v2-gst-state', dropCheck('books.tax_registration', '(gstin, 2)')),
  t18(GST_NOTE, 'v2-gst-credit-note', mutate(NUMBER, "if (new.kind = 'credit_note') is distinct from (sold.reverses_id is not null)\n     or (new.kind", 'if false and (new.kind')),
];
