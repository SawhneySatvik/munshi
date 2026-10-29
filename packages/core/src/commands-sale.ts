// Commands for the counter's money: the sale, its reversal and the shop's GST registration. A sale is priced from the
// books at the moment it is sold: its lines at the prices in effect, its offer codes re-judged then, a loyalty
// redemption against the customer's points, a package line's holding, stock out for goods, the tenders and the unpaid
// rest as the customer's credit, the GST invoice of a registered shop, and the journal. Its reversal writes the exact
// opposite of every row it caused, and a credit note for its invoice. A sale may finish one obligation: an order (its
// lines at the promised prices, its advance applied, the delivered step), a held piece (sold) or a booking (done).
// Helpers from commands.ts and commands-orders.ts are used only inside run(), so the value imports (while commands.ts
// spreads SALE_COMMANDS and is still being evaluated) are safe.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type Capability, refuseParts, switchedOn } from './capabilities.ts';
import { ACCOUNTS, at, CREDIT_DAYS, type CommandResult, type Ctx, type Def, journal, methodAccount, one } from './commands.ts';
import { advanceHeld, lockAdvance, orderDelivered } from './commands-orders.ts';
import { CoreError } from './errors.ts';
import { lineAmount } from './money.ts';
import { type CountryPack, gstRateBp, IN_PACK } from './packs/in.ts';
import { sellHeldPiece } from './reservations.ts';
import { addDays, businessDate } from './time.ts';

const id = z.guid();
const minor = z.number().int().safe();
const qtyMilli = z.number().int().positive().safe();
const instant = z.iso.datetime({ offset: true });
const day = z.iso.date();
const offerCode = z.string().regex(/^[A-Z0-9]{4,16}$/);
// ref.reason_use's codes for a reversal; the table's key refuses any other.
const reversalReason = z.enum(['wrong_figure', 'duplicate', 'entered_in_error', 'returned_goods', 'damaged', 'customer_cancelled', 'expired_offer', 'other']);

const saleRecord = z.strictObject({
  shopId: id,
  soldAt: instant.optional(),
  customerId: id.optional(),
  lines: z.array(z.strictObject({ itemId: id, qtyMilli, staffId: id.optional() })).min(1).max(100),
  payments: z.array(z.strictObject({ method: z.enum(['cash', 'upi', 'card']), amountMinor: minor.positive() })).max(3),
  offerCodes: z
    .array(offerCode)
    .max(3)
    .refine((c) => new Set(c).size === c.length)
    .optional(),
  redeemPoints: z.number().int().positive().safe().optional(),
  // The obligation this sale finishes, at most one: an order (the lines are its lines, in order), a held piece, or a
  // confirmed booking.
  orderId: id.optional(),
  reservationId: id.optional(),
  bookingId: id.optional(),
}).refine((i) => [i.orderId, i.reservationId, i.bookingId].filter((x) => x !== undefined).length <= 1, { path: ['orderId'] });
const saleReverse = z.strictObject({ saleId: id, reason: reversalReason });
const taxRegistrationSet = z
  .strictObject({
    scheme: z.enum(['regular', 'composition', 'unregistered']),
    gstin: z
      .string()
      .regex(/^[0-9]{2}[A-Z0-9]{13}$/)
      .optional(),
    stateCode: z.string().regex(/^[0-9]{2}$/),
    effectiveFrom: day.optional(),
    // The shops in that state that invoice under it, each with its own invoice series.
    shops: z
      .array(z.strictObject({ shopId: id, invoiceSeries: z.string().regex(/^[A-Z0-9]{1,8}$/) }))
      .max(20)
      .optional(),
  })
  .refine((i) => (i.scheme === 'unregistered') === (i.gstin === undefined), { path: ['gstin'] })
  .refine((i) => i.gstin === undefined || i.gstin.slice(0, 2) === i.stateCode, { path: ['gstin'] });
export type SaleInput = z.input<typeof saleRecord>;

// Accounts beyond commands.ts's ACCOUNTS (ref.account).
const BOOK = { discount: 'sales_discount', packages: 'package_liability', cgst: 'gst_output_cgst', sgst: 'gst_output_sgst', advance: 'customer_advance' } as const;
// The country packs, by ops.tenant.country.
const PACKS: Readonly<Record<string, CountryPack>> = { IN: IN_PACK };

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

// a × b ÷ c for non-negative integers, exactly: rounded down, or half away from zero.
const floorDiv = (a: number, b: number, c: number) => Number((BigInt(a) * BigInt(b)) / BigInt(c));
const halfUp = (a: number, b: number, c: number) => Number((2n * BigInt(a) * BigInt(b) + BigInt(c)) / (2n * BigInt(c)));

// D-053: a discount over several lines, pro rata by each line's value. Every line but the largest (the first of the
// largest by line order) takes amount × value ÷ total rounded down to the paisa, and the largest the remainder, which is
// then never negative. Only when the discount is within a few paise of the lines' whole value could that remainder pass
// the largest line's own value; the excess then goes a paisa each to the next largest lines, so no line is discounted
// below zero. sale.quote_offers splits the same way in SQL (O1). Lines of no value take nothing.
function splitByValue(amount: number, values: number[]): number[] {
  const shares = values.map(() => 0);
  const order = values
    .map((_, i) => i)
    .filter((i) => (values[i] as number) > 0)
    .sort((a, b) => (values[b] as number) - (values[a] as number) || a - b);
  const [largest, ...rest] = order;
  if (largest === undefined || amount <= 0) return shares;
  const total = order.reduce((a, i) => a + (values[i] as number), 0);
  for (const i of rest) shares[i] = floorDiv(amount, values[i] as number, total);
  const remainder = amount - shares.reduce((a, b) => a + b, 0);
  shares[largest] = Math.min(remainder, values[largest] as number);
  let excess = remainder - (shares[largest] as number);
  for (const i of rest) {
    if (excess <= 0) break;
    shares[i] = (shares[i] as number) + 1;
    excess--;
  }
  return shares;
}

type Offer = {
  id: string;
  kind: 'percent_off' | 'amount_off';
  percent_bp: number | null;
  amount_off_minor: string | null;
  scope: 'all' | 'category' | 'items';
  category: string | null;
  min_spend_minor: string | null;
  in_effect: boolean;
  items: string[];
};
type Priced = {
  n: number; // line_no
  itemId: string;
  qtyMilli: number;
  staffId: string | null;
  kind: string;
  priceId: string | null;
  orderLineId: string | null;
  unit: number;
  gross: number;
  name: string | null;
  category: string | null;
  taxClass: string | null;
  hsn: string | null;
};
type Discount = { n: number; source: 'offer' | 'loyalty'; offerId: string | null; amount: number };

// The offers' discounts on the bill (BLUEPRINT §8.1, MERCHANTS-DESIGN §3.3): each line takes at most one offer, and a
// package line none. A line's best percentage offer wins (a tie to the lower offer id), rounded half away from zero; a
// line no percentage offer covers goes to the lowest-id amount-off offer covering it, and each amount-off offer gives
// min(its amount, its lines' gross), split over those lines by D-053. Refuses a code that names no offer in effect, an
// offer with no line in its scope, and one whose minimum spend its in-scope lines' gross does not meet (O2).
function offerDiscounts(lines: Priced[], offers: Offer[], codes: number): Discount[] {
  if (offers.length !== codes || offers.some((o) => !o.in_effect)) throw new CoreError('invalid', { fields: ['offerCodes'] });
  const covers = (o: Offer, l: Priced) =>
    l.kind !== 'package' && (o.scope === 'all' || (o.scope === 'category' && l.category === o.category) || (o.scope === 'items' && o.items.includes(l.itemId)));
  for (const o of offers) {
    const scoped = lines.filter((l) => covers(o, l));
    if (!scoped.length || scoped.reduce((a, l) => a + l.gross, 0) < Number(o.min_spend_minor ?? 0)) throw new CoreError('invalid', { fields: ['offerCodes'] });
  }
  const byId = [...offers].sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: Discount[] = [];
  const amountLines = new Map<string, Priced[]>();
  for (const l of lines) {
    const pct = byId.filter((o) => o.kind === 'percent_off' && covers(o, l)).sort((a, b) => (b.percent_bp as number) - (a.percent_bp as number))[0];
    if (pct) {
      out.push({ n: l.n, source: 'offer', offerId: pct.id, amount: halfUp(l.gross, pct.percent_bp as number, 10_000) });
      continue;
    }
    const amt = byId.find((o) => o.kind === 'amount_off' && covers(o, l));
    if (amt) amountLines.set(amt.id, [...(amountLines.get(amt.id) ?? []), l]);
  }
  for (const o of byId) {
    const mine = amountLines.get(o.id);
    if (!mine) continue;
    const gross = mine.map((l) => l.gross);
    const shares = splitByValue(
      Math.min(Number(o.amount_off_minor), gross.reduce((a, b) => a + b, 0)),
      gross,
    );
    shares.forEach((amount, k) => {
      out.push({ n: (mine[k] as Priced).n, source: 'offer', offerId: o.id, amount });
    });
  }
  return out.filter((d) => d.amount > 0);
}

const live = (table: string, a: string) =>
  `${a}.reverses_id is null and not exists (select 1 from ${table} rv where rv.tenant_id = ${a}.tenant_id and rv.reverses_id = ${a}.id)`;

export const SALE_COMMANDS: [string, Def][] = [
  [
    // A counter sale at the prices in effect when sold: sale, lines (each naming the price row it was sold at), its
    // discounts (offers, then loyalty), stock out for goods, tenders, the unpaid rest as the customer's credit, the
    // customer's points, a package line's holding, the invoice of a GST-registered shop, and the journal: tenders +
    // receivable + discounts = sales + package liability + output GST.
    'sale.record',
    def(saleRecord, async (ctx, i) => {
      const { c, t } = ctx;
      const soldAt = at(i.soldAt);
      const date = businessDate(soldAt, t.timeZone);
      const ids = [...new Set(i.lines.map((l) => l.itemId))];
      // A sale naming an order sells exactly the order's live lines, in order, each at the unit price it was promised
      // at (its price row, or the member's own typed quote), to the order's customer; orderDelivered checks the match
      // again before the delivered step.
      const { rows: promised } = i.orderId
        ? await c.query<{
            order_line_id: string;
            item_id: string;
            kind: string;
            price_id: string | null;
            qty_milli: string;
            unit_price_minor: string;
            customer_id: string;
            name: string | null;
            category: string | null;
            tax_class: string | null;
            hsn_sac: string | null;
          }>(
            `select l.id::text as order_line_id, l.item_id::text as item_id, l.item_kind as kind, l.price_id::text as price_id, l.qty_milli,
                    l.unit_price_minor, o.customer_id::text as customer_id, rev.name, rev.category, rev.tax_class, rev.hsn_sac
               from books.order o
               join books.order_line l on l.tenant_id = o.tenant_id and l.order_id = o.id and l.reverses_id is null
               left join lateral (select r.name, r.category, r.tax_class, r.hsn_sac from books.item_revision r
                                   where r.tenant_id = l.tenant_id and r.item_id = l.item_id and r.effective_from <= $2
                                   order by r.effective_from desc, r.created_at desc, r.id desc limit 1) rev on true
              where o.id = $1 and o.reverses_id is null and o.currency = $3
              order by l.line_no`,
            [i.orderId, soldAt, t.currency],
          )
        : { rows: [] };
      if (i.orderId) {
        if (promised.length === 0) throw new CoreError('not_found');
        const same = promised.length === i.lines.length && promised.every((p, k) => p.item_id === i.lines[k]?.itemId && Number(p.qty_milli) === i.lines[k]?.qtyMilli);
        if (!same) throw new CoreError('invalid', { fields: ['lines'] });
        if (i.customerId !== undefined && i.customerId !== promised[0]?.customer_id) throw new CoreError('invalid', { fields: ['customerId'] });
      }
      const customerId = i.orderId ? promised[0]?.customer_id : i.customerId;
      const { rows: prices } = await c.query<{
        item_id: string;
        kind: string;
        price_id: string;
        amount_minor: string;
        name: string | null;
        category: string | null;
        tax_class: string | null;
        hsn_sac: string | null;
      }>(
        `select distinct on (p.item_id) p.item_id::text as item_id, it.kind, p.id::text as price_id, p.amount_minor,
                rev.name, rev.category, rev.tax_class, rev.hsn_sac
           from books.price p
           join books.item it on it.tenant_id = p.tenant_id and it.id = p.item_id
           left join lateral (select r.name, r.category, r.tax_class, r.hsn_sac from books.item_revision r
                               where r.tenant_id = it.tenant_id and r.item_id = it.id and r.effective_from <= $2
                               order by r.effective_from desc, r.created_at desc, r.id desc limit 1) rev on true
          where p.item_id = any($1::uuid[]) and p.effective_from <= $2 and p.currency = $3
          order by p.item_id, p.effective_from desc, p.created_at desc, p.id desc`,
        [ids, soldAt, t.currency],
      );
      const price = new Map(prices.map((p) => [p.item_id, p]));
      const priced: Priced[] = i.lines.map((l, k) => {
        const o = promised[k];
        if (o) {
          const unit = Number(o.unit_price_minor);
          return {
            n: k + 1,
            itemId: l.itemId,
            qtyMilli: l.qtyMilli,
            staffId: l.staffId ?? null,
            kind: o.kind,
            priceId: o.price_id,
            orderLineId: o.order_line_id,
            unit,
            gross: lineAmount(l.qtyMilli, unit),
            name: o.name,
            category: o.category,
            taxClass: o.tax_class,
            hsn: o.hsn_sac,
          };
        }
        const p = price.get(l.itemId);
        if (p === undefined) throw new CoreError('invalid', { fields: ['lines.itemId'] }); // no price in effect
        const unit = Number(p.amount_minor);
        return {
          n: k + 1,
          itemId: l.itemId,
          qtyMilli: l.qtyMilli,
          staffId: l.staffId ?? null,
          kind: p.kind,
          priceId: p.price_id,
          orderLineId: null,
          unit,
          gross: lineAmount(l.qtyMilli, unit),
          name: p.name,
          category: p.category,
          taxClass: p.tax_class,
          hsn: p.hsn_sac,
        };
      });

      // A package line sells one holding of its plan to a named customer (P3).
      const packaged = priced.filter((l) => l.kind === 'package');
      if (packaged.length && !customerId) throw new CoreError('invalid', { fields: ['customerId'] });
      for (const l of packaged) if (l.qtyMilli !== 1000) throw new CoreError('invalid', { fields: [`lines.${l.n - 1}.qtyMilli`] });
      const { rows: plans } = packaged.length
        ? await c.query<{ item_id: string; id: string; validity_days: number; lines: { item_id: string; sessions: number }[] }>(
            `select p.item_id::text as item_id, p.id::text as id, p.validity_days,
                    coalesce((select json_agg(json_build_object('item_id', l.item_id, 'sessions', l.sessions) order by l.line_no)
                                from books.package_plan_line l where l.tenant_id = p.tenant_id and l.plan_id = p.id), '[]') as lines
               from books.package_plan p where p.item_id = any($1::uuid[])`,
            [packaged.map((l) => l.itemId)],
          )
        : { rows: [] };
      const plan = new Map(plans.map((p) => [p.item_id, p]));
      for (const l of packaged) if (!plan.has(l.itemId)) throw new CoreError('invalid', { fields: [`lines.${l.n - 1}.itemId`] });

      const codes = i.offerCodes ?? [];
      // The parts this input uses, each a capability of its own (CAP2), checked by the body since the base check after
      // it knows only the command: offer codes, points redeemed and package lines here, an udhaar rest once the bill is
      // known.
      const parts: Capability[] = [];
      if (codes.length) parts.push('offers');
      if (i.redeemPoints !== undefined) parts.push('loyalty');
      if (packaged.length) parts.push('packages');
      await refuseParts(c, parts);
      const { rows: offers } = codes.length
        ? await c.query<Offer>(
            `select o.id::text as id, o.kind, o.percent_bp, o.amount_off_minor, o.scope, o.category, o.min_spend_minor,
                    (o.starts_at <= $2 and $2 < o.ends_at
                     and not exists (select 1 from books.offer_end e where e.tenant_id = o.tenant_id and e.offer_id = o.id and e.ended_at <= $2)) as in_effect,
                    array(select oi.item_id::text from books.offer_item oi where oi.tenant_id = o.tenant_id and oi.offer_id = o.id) as items
               from books.offer o where o.code = any($1::text[])`,
            [codes, soldAt],
          )
        : { rows: [] };
      const discounts = codes.length ? offerDiscounts(priced, offers, codes.length) : [];
      const off = (n: number) => discounts.filter((d) => d.n === n).reduce((a, d) => a + d.amount, 0);

      // Loyalty: the rule in effect when sold. A redemption of at least its minimum, worth no more than the net after
      // offers, split by D-053 over the lines that are not packages (b_loyalty_tally refuses an overdraw, MS009).
      const { rows: rules } = customerId
        ? await c.query<{ earn_per_100: number; point_value_minor: string; min_redeem: number }>(
            `select earn_per_100, point_value_minor, min_redeem from books.loyalty_rule where effective_from <= $1 and currency = $2
              order by effective_from desc, created_at desc, id desc limit 1`,
            [soldAt, t.currency],
          )
        : { rows: [] };
      const rule = rules[0];
      if (i.redeemPoints !== undefined) {
        if (!customerId) throw new CoreError('invalid', { fields: ['customerId'] });
        const open = priced.map((l) => (l.kind === 'package' ? 0 : l.gross - off(l.n)));
        const value = rule ? i.redeemPoints * Number(rule.point_value_minor) : 0;
        if (!rule || i.redeemPoints < rule.min_redeem || value > open.reduce((a, b) => a + b, 0)) throw new CoreError('invalid', { fields: ['redeemPoints'] });
        splitByValue(value, open).forEach((amount, k) => {
          if (amount > 0) discounts.push({ n: k + 1, source: 'loyalty', offerId: null, amount });
        });
      }
      const discounted = discounts.reduce((a, d) => a + d.amount, 0);
      const total = priced.reduce((a, l) => a + l.gross, 0) - discounted;
      // An order's advance still held goes first, up to the bill (§8.12): under the order's advance lock, so a refund in
      // flight is waited for.
      if (i.orderId) await lockAdvance(ctx, i.orderId);
      const applied = i.orderId ? Math.min(await advanceHeld(c, i.orderId), total) : 0;
      const paid = i.payments.reduce((a, p) => a + p.amountMinor, 0);
      const credit = total - applied - paid;
      if (credit < 0) throw new CoreError('invalid', { fields: ['payments'] });
      if (credit > 0 && !customerId) throw new CoreError('invalid', { fields: ['customerId'] });
      if (credit > 0) await refuseParts(c, ['credit']);

      // GST: the registration in effect today for the shop's state, as b_invoice_number reads it. A regular one issues a
      // tax invoice, each line taxed on its discounted price (D-052) at the pack's rate for its tax class and split
      // §8.9's way; a composition one a bill of supply with no tax; none, or an unregistered one, no invoice.
      const { rows: reg } = await c.query<{ scheme: string; country: string }>(
        `select r.scheme, t.country from ops.shop s cross join ops.tenant t
           join lateral (select r.scheme from books.tax_registration r
                          where r.tenant_id = s.tenant_id and r.state_code = s.state_code and r.effective_from <= (now() at time zone t.time_zone)::date
                          order by r.effective_from desc, r.created_at desc, r.id desc limit 1) r on true
          where s.id = $1`,
        [i.shopId],
      );
      const kind = reg[0]?.scheme === 'regular' ? 'tax_invoice' : reg[0]?.scheme === 'composition' ? 'bill_of_supply' : undefined;
      const pack = PACKS[reg[0]?.country ?? ''];
      const taxed = priced.map((l) => {
        const net = l.gross - off(l.n);
        if (kind !== 'tax_invoice') return { rate: 0, taxable: net, cgst: 0, sgst: 0 };
        const rate = pack && l.taxClass ? gstRateBp(pack, l.taxClass, date, net, l.qtyMilli) : undefined;
        if (rate === undefined) throw new CoreError('invalid', { fields: [`lines.${l.n - 1}.itemId`] }); // no tax class or rate: never guessed
        const taxable = halfUp(net, 10_000, 10_000 + rate);
        const cgst = Math.floor((net - taxable) / 2);
        return { rate, taxable, cgst, sgst: net - taxable - cgst };
      });
      const tax = (k: number) => (taxed[k]?.cgst ?? 0) + (taxed[k]?.sgst ?? 0);

      const saleId = randomUUID();
      await c.query(
        `insert into books.sale (tenant_id, id, shop_id, sold_at, customer_id, total_minor, currency, order_id, reservation_id, booking_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [t.tenantId, saleId, i.shopId, soldAt, customerId ?? null, total, t.currency, i.orderId ?? null, i.reservationId ?? null, i.bookingId ?? null],
      );
      const col = <K extends keyof Priced>(k: K) => priced.map((l) => l[k]);
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, order_line_id, staff_id, qty_milli, unit_price_minor,
                                      gross_minor, tax_class, tax_rate_bp, tax_minor, currency)
         select $1, $2, l.n, l.item, l.kind, l.price, l.order_line, l.staff, l.qty, l.unit, l.gross, l.class, l.rate, l.tax, $3
           from unnest($4::int[], $5::uuid[], $6::text[], $7::uuid[], $8::uuid[], $9::bigint[], $10::bigint[], $11::bigint[], $12::text[], $13::int[],
                       $14::bigint[], $15::uuid[]) as l(n, item, kind, price, staff, qty, unit, gross, class, rate, tax, order_line)`,
        [
          t.tenantId,
          saleId,
          t.currency,
          col('n'),
          col('itemId'),
          col('kind'),
          col('priceId'),
          col('staffId'),
          col('qtyMilli'),
          col('unit'),
          col('gross'),
          col('taxClass'),
          taxed.map((x) => x.rate),
          priced.map((_, k) => tax(k)),
          col('orderLineId'),
        ],
      );

      let redeemedId: string | null = null;
      if (i.redeemPoints !== undefined) {
        redeemedId = randomUUID();
        await c.query(`insert into books.loyalty_entry (tenant_id, id, customer_id, kind, points, sale_id, at) values ($1, $2, $3, 'redeemed', $4, $5, $6)`, [
          t.tenantId,
          redeemedId,
          customerId,
          -i.redeemPoints,
          saleId,
          soldAt,
        ]);
      }
      for (const d of discounts) {
        await c.query(
          `insert into books.sale_discount (tenant_id, sale_id, line_no, source, offer_id, loyalty_entry_id, amount_minor, currency) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.tenantId, saleId, d.n, d.source, d.offerId, d.source === 'loyalty' ? redeemedId : null, d.amount, t.currency],
        );
      }
      // A named customer earns floor(net × earn_per_100 ÷ 10000) points (₹100 is 10,000 paise) on what the bill came to,
      // while the shop has loyalty on (a rule left from before a switch-off earns nothing).
      const earned = customerId && rule && (await switchedOn(c, 'loyalty')) ? floorDiv(total, rule.earn_per_100, 10_000) : 0;
      if (earned > 0) {
        await c.query(`insert into books.loyalty_entry (tenant_id, customer_id, kind, points, sale_id, at) values ($1, $2, 'earned', $3, $4, $5)`, [
          t.tenantId,
          customerId,
          earned,
          saleId,
          soldAt,
        ]);
      }

      const goods = priced.filter((l) => l.kind === 'good');
      if (goods.length) {
        await c.query(
          `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, at)
           select $1, l.item, -l.qty, 'sale', 'books.sale', $2, $3 from unnest($4::uuid[], $5::bigint[]) as l(item, qty)`,
          [t.tenantId, saleId, soldAt, goods.map((l) => l.itemId), goods.map((l) => l.qtyMilli)],
        );
      }
      for (const p of i.payments) {
        await c.query(
          `insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, sale_id, paid_at)
           values ($1, 'in', $2, $3, $4, $5, $6, $7)`,
          [t.tenantId, p.method, p.amountMinor, t.currency, customerId ?? null, saleId, soldAt],
        );
      }
      if (credit > 0) {
        await c.query(
          `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, due_on, at) values ($1, $2, $3, $4, $5, $6, $7)`,
          [t.tenantId, customerId, credit, t.currency, saleId, addDays(date, CREDIT_DAYS), soldAt],
        );
      }

      // A package line's holding is what is owed back as service: the line's value net of its GST, for validity_days
      // from the day sold. Its sold entries give each of the plan's services its sessions, the first carrying the value.
      for (const l of packaged) {
        const p = plan.get(l.itemId) as (typeof plans)[number];
        const liability = (taxed[l.n - 1] as { taxable: number }).taxable;
        const holdingId = randomUUID();
        await c.query(
          `insert into books.package_holding (tenant_id, id, customer_id, plan_id, sale_id, starts_on, expires_on, liability_minor, currency)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [t.tenantId, holdingId, customerId, p.id, saleId, date, addDays(date, p.validity_days), liability, t.currency],
        );
        for (const [k, s] of p.lines.entries()) {
          await c.query(
            `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, at)
             values ($1, $2, $3, $4, 'sold', $5, $6, $7, $8)`,
            [t.tenantId, holdingId, i.shopId, s.item_id, s.sessions, k === 0 ? liability : 0, t.currency, soldAt],
          );
        }
      }

      let invoiceId: string | undefined;
      if (kind) {
        invoiceId = randomUUID();
        const sum = (k: 'taxable' | 'cgst' | 'sgst') => taxed.reduce((a, x) => a + x[k], 0);
        await c.query(
          `insert into books.invoice (tenant_id, id, sale_id, shop_id, kind, taxable_minor, cgst_minor, sgst_minor, total_minor, currency)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [t.tenantId, invoiceId, saleId, i.shopId, kind, sum('taxable'), sum('cgst'), sum('sgst'), total, t.currency],
        );
        await c.query(
          `insert into books.invoice_line (tenant_id, invoice_id, line_no, sale_line_id, description, hsn_sac, qty_milli, discount_minor, taxable_minor,
                                           rate_bp, cgst_minor, sgst_minor, total_minor)
           select $1, $2, l.line_no, l.id, left(x.name, 120), x.hsn, l.qty_milli, x.off, x.taxable, l.tax_rate_bp, x.cgst, x.sgst, l.gross_minor - x.off
             from unnest($4::int[], $5::text[], $6::text[], $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[]) as x(n, name, hsn, off, taxable, cgst, sgst)
             join books.sale_line l on l.sale_id = $3 and l.line_no = x.n`,
          [
            t.tenantId,
            invoiceId,
            saleId,
            col('n'),
            col('name'),
            col('hsn'),
            priced.map((l) => off(l.n)),
            taxed.map((x) => x.taxable),
            taxed.map((x) => x.cgst),
            taxed.map((x) => x.sgst),
          ],
        );
      }

      const exTax = (pkg: boolean) => priced.reduce((a, l, k) => a + ((l.kind === 'package') === pkg ? l.gross - tax(k) : 0), 0);
      await journal(ctx, date, 'sale', ['books.sale', saleId], [
        ...i.payments.map((p): [string, number] => [methodAccount(p.method), p.amountMinor]),
        [ACCOUNTS.receivable, credit],
        [BOOK.advance, applied],
        [BOOK.discount, discounted],
        [ACCOUNTS.sales, -exTax(false)],
        [BOOK.packages, -exTax(true)],
        [BOOK.cgst, -taxed.reduce((a, x) => a + x.cgst, 0)],
        [BOOK.sgst, -taxed.reduce((a, x) => a + x.sgst, 0)],
      ]);
      // Last, the obligation it finishes, each judged again by the database against this sale.
      if (i.reservationId) await sellHeldPiece(c, i.reservationId);
      if (i.bookingId) {
        const done = await c.query(`update ops.booking set state = 'done' where id = $1 and state = 'confirmed'`, [i.bookingId]);
        if (done.rowCount !== 1) throw new CoreError('conflict', { fields: ['bookingId'] });
      }
      const delivered = i.orderId ? await orderDelivered(c, i.orderId) : undefined;
      return { saleId, ...(invoiceId ? { invoiceId } : {}), ...(delivered ? { stepId: delivered.stepId, messageId: delivered.messageId } : {}) };
    }),
  ],
  [
    // The exact opposite of a sale, once, under a reversal header dated now: its lines and discounts (the reversal's
    // children), its points, its holdings' sold entries, stock back in, its tenders and credit, its journal, and a credit
    // note naming its invoice. A holding already redeemed from cannot go below zero (MS009), so such a sale stands. What
    // it finished stays finished: a held piece stays sold (the piece itself comes back by the stock move) and a booking
    // done; an order keeps its delivered step, and the reversal names the order, so the advance its delivery applied is
    // held again (unappliedAdvance) and goes back by payment.record or credit.record (D-059).
    'sale.reverse',
    def(saleReverse, async (ctx, i) => {
      const { c, t } = ctx;
      const now = new Date();
      await one(c, 'select 1 from books.sale where id = $1', [i.saleId]);
      const saleId = randomUUID();
      const back = [i.saleId, saleId, now, i.reason];
      await c.query(
        `insert into books.sale (tenant_id, id, shop_id, sold_at, customer_id, total_minor, currency, order_id, reverses_id, reason)
         select tenant_id, $2, shop_id, $3, customer_id, -total_minor, currency, order_id, id, $4 from books.sale where id = $1`,
        back,
      );
      await c.query(
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, order_line_id, staff_id, qty_milli, unit_price_minor,
                                      gross_minor, tax_class, tax_rate_bp, tax_minor, currency, reverses_id, reason)
         select tenant_id, $2, line_no, item_id, item_kind, price_id, order_line_id, staff_id, -qty_milli, unit_price_minor,
                -gross_minor, tax_class, tax_rate_bp, -tax_minor, currency, id, $3
           from books.sale_line where sale_id = $1 order by line_no`,
        [i.saleId, saleId, i.reason],
      );
      // Points given back before points taken back, so a customer who has spent what this sale earned keeps a balance.
      const { rows: points } = await c.query<{ id: string; kind: string }>(
        `select id::text as id, kind from books.loyalty_entry where sale_id = $1 order by case kind when 'redeemed' then 0 else 1 end, seq`,
        [i.saleId],
      );
      let redeemedBack: string | null = null;
      for (const p of points) {
        const { rows } = await c.query<{ id: string }>(
          `insert into books.loyalty_entry (tenant_id, customer_id, kind, points, sale_id, at, reverses_id, reason)
           select tenant_id, customer_id, 'reversal', -points, $2, $3, id, $4 from books.loyalty_entry where id = $1 returning id::text as id`,
          [p.id, saleId, now, i.reason],
        );
        if (p.kind === 'redeemed') redeemedBack = (rows[0] as { id: string }).id;
      }
      await c.query(
        `insert into books.sale_discount (tenant_id, sale_id, line_no, source, offer_id, loyalty_entry_id, discount_reason, amount_minor, currency, reverses_id, reason)
         select tenant_id, $2, line_no, source, offer_id, case when source = 'loyalty' then $4::uuid end, discount_reason, -amount_minor, currency, id, $3
           from books.sale_discount where sale_id = $1 order by id`,
        [i.saleId, saleId, i.reason, redeemedBack],
      );
      await c.query(
        `insert into books.package_entry (tenant_id, holding_id, shop_id, item_id, kind, sessions, value_minor, currency, at, reverses_id, reason)
         select e.tenant_id, e.holding_id, e.shop_id, e.item_id, 'reversal', -e.sessions, -e.value_minor, e.currency, $2, e.id, $3
           from books.package_entry e join books.package_holding h on h.tenant_id = e.tenant_id and h.id = e.holding_id
          where h.sale_id = $1 and e.kind = 'sold' order by e.seq`,
        [i.saleId, now, i.reason],
      );
      await c.query(
        `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at, reverses_id, reason)
         select m.tenant_id, m.item_id, -m.qty_milli, m.kind, 'books.sale', $2, m.expires_on, $3, m.id, $4
           from books.stock_move m where m.source_rel = 'books.sale' and m.source_id = $1 and ${live('books.stock_move', 'm')}`,
        back,
      );
      await c.query(
        `insert into books.payment (tenant_id, direction, method, amount_minor, currency, customer_id, supplier_id, staff_id, sale_id, purchase_id, order_id,
                                    reference, paid_at, reverses_id, reason)
         select p.tenant_id, p.direction, p.method, -p.amount_minor, p.currency, p.customer_id, p.supplier_id, p.staff_id, $2, p.purchase_id, p.order_id,
                p.reference, $3, p.id, $4
           from books.payment p where p.sale_id = $1 and ${live('books.payment', 'p')}`,
        back,
      );
      await c.query(
        `insert into books.credit_entry (tenant_id, customer_id, amount_minor, currency, sale_id, payment_id, due_on, at, reverses_id, reason)
         select e.tenant_id, e.customer_id, -e.amount_minor, e.currency, $2, e.payment_id, e.due_on, $3, e.id, $4
           from books.credit_entry e where e.sale_id = $1 and ${live('books.credit_entry', 'e')}`,
        back,
      );
      const { rows: entries } = await c.query<{ id: string }>(
        `select j.id::text as id from books.journal_entry j where j.source_rel = 'books.sale' and j.source_id = $1 and ${live('books.journal_entry', 'j')}`,
        [i.saleId],
      );
      for (const e of entries) {
        const entryId = randomUUID();
        await c.query(
          `insert into books.journal_entry (tenant_id, id, entry_date, memo_code, source_rel, source_id, reverses_id, reason)
           values ($1, $2, $3, 'sale_reversed', 'books.sale', $4, $5, $6)`,
          [t.tenantId, entryId, businessDate(now, t.timeZone), saleId, e.id, i.reason],
        );
        await c.query(
          `insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency, reverses_id, reason)
           select tenant_id, $2, account, -amount_minor, currency, id, $3 from books.journal_line where entry_id = $1`,
          [e.id, entryId, i.reason],
        );
      }
      // The credit note: the invoice's figures negated, each line naming the reversal sale's line; the database numbers
      // it in its own series and dates it.
      const { rows: invoices } = await c.query<{ id: string }>('select id::text as id from books.invoice where sale_id = $1', [i.saleId]);
      let creditNoteId: string | undefined;
      if (invoices[0]) {
        creditNoteId = randomUUID();
        await c.query(
          `insert into books.invoice (tenant_id, id, sale_id, shop_id, kind, buyer_gstin, taxable_minor, cgst_minor, sgst_minor, total_minor, currency, original_invoice_id)
           select tenant_id, $2, $3, shop_id, 'credit_note', buyer_gstin, -taxable_minor, -cgst_minor, -sgst_minor, -total_minor, currency, id
             from books.invoice where id = $1`,
          [invoices[0].id, creditNoteId, saleId],
        );
        await c.query(
          `insert into books.invoice_line (tenant_id, invoice_id, line_no, sale_line_id, description, hsn_sac, qty_milli, discount_minor, taxable_minor,
                                           rate_bp, cgst_minor, sgst_minor, total_minor)
           select l.tenant_id, $2, l.line_no, r.id, l.description, l.hsn_sac, -l.qty_milli, -l.discount_minor, -l.taxable_minor,
                  l.rate_bp, -l.cgst_minor, -l.sgst_minor, -l.total_minor
             from books.invoice_line l join books.sale_line r on r.tenant_id = l.tenant_id and r.reverses_id = l.sale_line_id
            where l.invoice_id = $1`,
          [invoices[0].id, creditNoteId],
        );
      }
      return { saleId, ...(creditNoteId ? { creditNoteId } : {}) };
    }),
  ],
  [
    // A state's GST registration from a day on (the latest in effect wins), and the shops in that state that invoice
    // under it with their series: an invoice takes its shop's state and series (b_invoice_number).
    'tax.registration.set',
    def(taxRegistrationSet, async (ctx, i) => {
      const { c, t } = ctx;
      const registrationId = randomUUID();
      await c.query('insert into books.tax_registration (tenant_id, id, scheme, gstin, state_code, effective_from) values ($1, $2, $3, $4, $5, $6)', [
        t.tenantId,
        registrationId,
        i.scheme,
        i.gstin ?? null,
        i.stateCode,
        i.effectiveFrom ?? businessDate(new Date(), t.timeZone),
      ]);
      for (const s of i.shops ?? []) {
        const { rowCount } = await c.query('update ops.shop set state_code = $1, invoice_series = $2 where id = $3', [i.stateCode, s.invoiceSeries, s.shopId]);
        if (rowCount !== 1) throw new CoreError('not_found');
      }
      return { registrationId };
    }),
  ],
];
