// Red-proofs of the counter's money (test/v2/core/counter): each breaks one rule of packages/core's sale,
// offer, package, invoice or pack code, and its named test must fail. Every counter gate has at least one: GST1
// (a rate in the pack, the invoice itself), O1, O2, the loyalty rules and L1, P1–P4, REV1, JR1, IDEM1.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const dir = 'test/v2/core/counter';
const SALE = 'packages/core/src/commands-sale.ts';
const QSALE = 'packages/core/src/queries-sale.ts';
const PKG = 'packages/core/src/commands-packages.ts';
const QPKG = 'packages/core/src/queries-packages.ts';
const QINV = 'packages/core/src/queries-invoice.ts';
const PACK = 'packages/core/src/packs/in.ts';
const COMMANDS = 'packages/core/src/commands.ts';

const gst = `${dir}/gst1-invoices.test.ts`;
const offers = `${dir}/o1-offers.test.ts`;
const loyalty = `${dir}/l1-loyalty.test.ts`;
const packages = `${dir}/p-packages.test.ts`;
const rev = `${dir}/rev1-sale.test.ts`;
const jr1 = `${dir}/jr1-gst-summary.test.ts`;
const idem = `${dir}/idem1-counter.test.ts`;

const GST1_KIRANA = 'golden invoices at one rate, at two rates, with a line discount and with a bill discount split pro rata by line value';
const GST1_SALON = 'golden invoices: a salon service at 5%, and a loyalty redemption split pro rata by line value and taxed on each line’s net';
const GST1_APPAREL = 'golden invoices: apparel at 5% up to ₹2,500 a piece and 18% above, judged on the discounted price of the piece';
const GST1_COMPOSITION = 'a composition shop issues a bill of supply with no tax; an unregistered shop issues no invoice';
const GST1_MS016 = 'every sale at a registered shop is invoiced in its own transaction: a backdated one is refused (MS016) and writes nothing';
const GST1_CLASS = 'an item with no tax class, at a registered shop, is refused, never guessed';
const GST1_DETAIL = 'invoice.detail shows every printed figure as a cell of the stored invoice; invoices.list lists it in its month';
const O1_OFFERS = 'the quote equals the recorded sale to the paisa: best percentage per line, an amount-off split over the rest, a tie, a cap at the gross';
const O1_LOYALTY = 'the quote equals the recorded sale with an offer, a loyalty redemption split pro rata by line value, earned points and a package line that takes neither';
const O2_CODES = 'a code naming no offer, or one ended, expired, not yet started, out of scope or under its minimum spend, is refused, and nothing is written';
const O2_SOLD_AT = 'an offer is judged at sold_at: a sale dated before it started is refused, one dated after is accepted';
const L1_BALANCES = 'points are earned on the bill’s net and redeemed against it: hand-worked balances, and loyalty.balance shows the database’s';
const L1_RULES = 'a redemption needs a named customer, the rule’s minimum and no more value than the bill after offers; the latest rule wins';
const P1_REDEEM = 'sell and redeem every session: shares of the value left ÷ the sessions left, the last the rest; the liability nets to zero';
const P1_EXPIRE = 'expire a lapsed holding by an approved draft: what is left moves to breakage, and the liability nets to zero';
const P2_STALE_BALANCE = 'two redemptions at once never price a session off the same balance: the last session takes the rest';
const P3 = 'a package line needs a named customer, and sells one holding of its plan';
const P4 = 'package.expire runs only as an approved draft, and goes stale when a redemption lands first';
const REV1 = 'a sale’s reversal nets to zero everywhere, and its invoice’s credit note is numbered in its own series';
const JR1 = 'the GST summary equals the journal’s sums for the month, computed from raw lines';
const IDEM1 = 'a double tap at a registered counter records one sale and one invoice, and spends no invoice number';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});

export const CORE_COUNTER_CASES: Case[] = [
  // GST1: a rate changed in the pack
  ts('v2-counter-pack-rate', gst, GST1_KIRANA, PACK, "general_18: [{ from: '2017-07-01', rateBp: 1800 }],", "general_18: [{ from: '2017-07-01', rateBp: 1200 }],"),
  // Pro rata: the remainder to the first line, not the largest
  ts('v2-counter-prorata-largest', gst, GST1_KIRANA, SALE, '.sort((a, b) => (values[b] as number) - (values[a] as number) || a - b);', '.sort((a, b) => a - b);'),
  // Pro rata: the other lines' shares rounded half up, not down
  ts(
    'v2-counter-prorata-round-down',
    gst,
    GST1_SALON,
    SALE,
    'for (const i of rest) shares[i] = floorDiv(amount, values[i] as number, total);',
    'for (const i of rest) shares[i] = halfUp(amount, values[i] as number, total);',
  ),
  // GST on the net: the apparel rate judged on the undiscounted price
  ts('v2-counter-gst-net-rate-on-gross', gst, GST1_APPAREL, SALE, 'gstRateBp(pack, l.taxClass, date, net, l.qtyMilli)', 'gstRateBp(pack, l.taxClass, date, l.gross, l.qtyMilli)'),
  // a regular registration issues no invoice, so MS016 never fires
  ts('v2-counter-uninvoiced', gst, GST1_MS016, SALE, "const kind = reg[0]?.scheme === 'regular' ? 'tax_invoice'", "const kind = reg[0]?.scheme === 'never' ? 'tax_invoice'"),
  // a composition shop issues nothing
  ts('v2-counter-no-bill-of-supply', gst, GST1_COMPOSITION, SALE, ": reg[0]?.scheme === 'composition' ? 'bill_of_supply' : undefined;", ': undefined;'),
  // invoice.detail drops the line's discount from the printed figures
  ts('v2-counter-detail-discount', gst, GST1_DETAIL, QINV, 'l.discount_minor as discount', '0::bigint as discount'),
  // an item with no tax class taxed at nothing instead of refused
  ts(
    'v2-counter-class-guessed',
    gst,
    GST1_CLASS,
    SALE,
    'const rate = pack && l.taxClass ? gstRateBp(pack, l.taxClass, date, net, l.qtyMilli) : undefined;',
    'const rate = pack && l.taxClass ? gstRateBp(pack, l.taxClass, date, net, l.qtyMilli) : 0;',
  ),

  // O1: the preview's tie-break differs from the sale's
  ts(
    'v2-counter-o1-tie',
    offers,
    O1_OFFERS,
    QSALE,
    "from eligible where kind = 'percent_off' order by line_no, percent_bp desc, offer_id",
    "from eligible where kind = 'percent_off' order by line_no, percent_bp desc, offer_id desc",
  ),
  // O1: the preview's pro rata split gives the remainder to the first line
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of queries-sale.ts, not a template
  ts('v2-counter-o1-split', offers, O1_OFFERS, QSALE, 'row_number() over (partition by ${grp} order by ${v} desc, line_no) as r', 'row_number() over (partition by ${grp} order by line_no) as r'),
  // O1: the preview spreads points over the package line too
  ts(
    'v2-counter-o1-points-on-package',
    offers,
    O1_LOYALTY,
    QSALE,
    "case when l.kind = 'package' then 0 else l.gross - coalesce(o.amount, 0) end as open",
    'l.gross - coalesce(o.amount, 0) as open',
  ),
  // O2: an offer not in effect is taken
  ts('v2-counter-o2-in-effect', offers, O2_CODES, SALE, 'if (offers.length !== codes || offers.some((o) => !o.in_effect))', 'if (offers.length !== codes)'),
  // O2: an offer covering no line is taken
  ts('v2-counter-o2-scope', offers, O2_CODES, SALE, 'if (!scoped.length || ', 'if ('),
  // O2: the minimum spend is not checked
  ts('v2-counter-o2-min-spend', offers, O2_CODES, SALE, ' || scoped.reduce((a, l) => a + l.gross, 0) < Number(o.min_spend_minor ?? 0)', ''),
  // O2: an offer judged now, not at sold_at
  ts('v2-counter-o2-sold-at', offers, O2_SOLD_AT, SALE, '(o.starts_at <= $2 and $2 < o.ends_at', '(o.starts_at <= now() and now() < o.ends_at'),

  // loyalty: points earned rounded up
  ts('v2-counter-earn-rounding', loyalty, L1_BALANCES, SALE, 'floorDiv(total, rule.earn_per_100, 10_000)', 'floorDiv(total + 9_999, rule.earn_per_100, 10_000)'),
  // loyalty: points worth more than the bill are taken
  ts('v2-counter-points-over-bill', loyalty, L1_RULES, SALE, ' || value > open.reduce((a, b) => a + b, 0)', ''),
  // loyalty: fewer points than the rule's minimum are taken
  ts('v2-counter-points-minimum', loyalty, L1_RULES, SALE, 'i.redeemPoints < rule.min_redeem || ', ''),

  // P1: a session's share rounded up, so the last session does not take the rest
  ts('v2-counter-p1-share', packages, P1_REDEEM, PKG, 'Math.floor(left.value / sessions)', 'Math.ceil(left.value / sessions)'),
  // P1: an expiry's value booked as sales, not breakage
  ts('v2-counter-p1-breakage', packages, P1_EXPIRE, PKG, "['package_breakage', -left.value],", "['sales', -left.value],"),
  // P2: the holding's balance read without its lock, so two redemptions price off the same balance
  ts(
    'v2-counter-p2-unlocked',
    packages,
    P2_STALE_BALANCE,
    PKG,
    'await lockHolding(ctx, i.holdingId);\n      const left = await holdingLeft(c, i.holdingId);\n      const sessions',
    'const left = await holdingLeft(c, i.holdingId);\n      const sessions',
  ),
  // P3: a package line with no customer reaches the database
  ts('v2-counter-p3-customer', packages, P3, SALE, "if (packaged.length && !customerId) throw new CoreError('invalid', { fields: ['customerId'] });", ''),
  // P4: package.balance reads the first entry, so a redemption never makes the draft stale
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of queries-packages.ts, not a template
  ts('v2-counter-p4-stale', packages, P4, QPKG, '${h}.id order by e.seq desc limit 1), 0)', '${h}.id order by e.seq limit 1), 0)'),
  // P4: an expiry executes on a holding that has not lapsed
  ts('v2-counter-p4-lapse', packages, P4, PKG, "if (!lapsed) throw new CoreError('invalid', { fields: ['holdingId'] });", ''),

  // REV1: the tenders are not reversed
  ts('v2-counter-rev1-payments', rev, REV1, SALE, 'from books.payment p where p.sale_id = $1 and', 'from books.payment p where false and p.sale_id = $1 and'),
  // REV1: stock is not put back
  ts(
    'v2-counter-rev1-stock',
    rev,
    REV1,
    SALE,
    "from books.stock_move m where m.source_rel = 'books.sale' and m.source_id = $1 and",
    "from books.stock_move m where false and m.source_rel = 'books.sale' and m.source_id = $1 and",
  ),
  // REV1: no credit note for the invoice
  ts('v2-counter-rev1-credit-note', rev, REV1, SALE, 'if (invoices[0]) {', 'if (false && invoices[0]) {'),
  // REV1 (the holding as sold): a package's liability kept gross of its GST
  ts('v2-counter-package-gross', rev, REV1, SALE, 'const liability = (taxed[l.n - 1] as { taxable: number }).taxable;', 'const liability = l.gross;'),

  // JR1: the summary's taxable value from the lines' totals, as from a sale's total
  ts('v2-counter-jr1-totals', jr1, JR1, QINV, 'sum(l.taxable_minor)::bigint as taxable', 'sum(l.total_minor)::bigint as taxable'),
  // JR1: credit notes left out of the summary
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of queries-invoice.ts, not a template
  ts('v2-counter-jr1-credit-notes', jr1, JR1, QINV, "where ${inMonth('v.issued_at', '$1::text')}", "where v.kind <> 'credit_note' and ${inMonth('v.issued_at', '$1::text')}"),

  // IDEM1 at the counter: the key is never claimed, so a double tap records two sales and spends two numbers
  ts(
    'v2-counter-idem-skip-claim',
    idem,
    IDEM1,
    COMMANDS,
    'const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, name, p);',
    'const claim = undefined;',
  ),
];
