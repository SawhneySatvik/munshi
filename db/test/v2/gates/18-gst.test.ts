// 18_gst.sql: INV1 (20 sales at once number 1..20, a rolled-back one leaves no gap, the first credit note is credit
// note 1, R4 M1), INV2 (the number, time, year, series and GSTIN are the database's; a later number never carries an
// earlier time; a backdated sale for a registered shop is refused, MS016, R4 W4), TOT1's invoice half (R4 N2), and the
// registration and credit-note rules. The chain lock already serialises a tenant's book writes from its sale header, so
// the series lock is a second fence: the red-proofs break the numbering itself. Red-proofs:
// test/v2/sabotage/offers-packages-gst.ts.
import pg from 'pg';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
type Shop = Tenant & { good: string; price: string; registration: string };
let g: Shop;
let h: Shop;

const one = async (c: pg.ClientBase, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const cmd = <T>(t: Tenant, actor: string, command: string, fn: (c: pg.PoolClient) => Promise<T>) =>
  tx(app, { tenant_id: t.tenant, actor_id: actor, command }, fn);

// A shop that invoices: a state and a series, a regular registration in effect since yesterday, an item and its price.
async function gstShop(slug: string): Promise<Shop> {
  const t = await signUp(db, slug);
  await tx(app, { tenant_id: t.tenant, actor_id: t.owner }, (c) =>
    c.query(`update ops.shop set state_code = '07', invoice_series = 'GS' where tenant_id = $1 and id = $2`, [t.tenant, t.shop]),
  );
  const registration = await cmd(t, t.owner, 'tax.registration.set', (c) =>
    one(c, `insert into books.tax_registration (tenant_id, scheme, gstin, state_code, effective_from) values ($1, 'regular', '07AAAAA1111A1Z1', '07', current_date - 1) returning id`, [
      t.tenant,
    ]),
  );
  const good = await cmd(t, t.owner, 'item.create', async (c) => {
    const good = await one(c, `insert into books.item (tenant_id, kind, unit) values ($1, 'good', 'piece') returning id`, [t.tenant]);
    await c.query(`insert into books.item_revision (tenant_id, item_id, name, effective_from) values ($1, $2, 'Kurta', now())`, [t.tenant, good]);
    return good;
  });
  const price = await cmd(t, t.owner, 'price.set', (c) =>
    one(c, `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from) values ($1, $2, 10500, 'INR', now()) returning id`, [t.tenant, good]),
  );
  return { ...t, good, price, registration };
}

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  g = await gstShop('gst-shop');
  h = await gstShop('gst-rules');
  await db.sabotage();
});
afterAll(() => db?.close());

type Bill = {
  kind?: string;
  lines?: number;
  rate?: number;
  discount?: number; // on line 1
  wholeDiscount?: number; // on the sale, naming no line
  saleTax?: number; // line 1's stored tax, if not the tax on its discounted price
  soldAt?: string;
  invoice?: Record<string, unknown>;
  invoiceLine?: Record<string, unknown>;
  skipLine?: boolean;
};
const half = (x: number) => Math.sign(x) * Math.round(Math.abs(x)); // half away from zero (§8.9)
// One sale of `lines` pieces at ₹105, 5% GST inside the price, and its tax invoice: each line taxed on its price less its
// discount (D-052) — taxable round(net × 10000 ÷ 10500), the rest tax, CGST half of it truncated, SGST the remainder —
// so ₹105 is 10000 + 250 + 250, and ₹100 after a ₹5 discount 9524 + 238 + 238. `bill` varies one thing. Returns the sale
// and its invoice.
async function sell(c: pg.ClientBase, s: Shop, bill: Bill = {}): Promise<{ sale: string; invoice: string }> {
  const n = bill.lines ?? 1;
  const rate = bill.rate ?? 500;
  const off = (k: number) => (k === 1 ? (bill.discount ?? 0) : 0);
  const split = (k: number) => {
    const net = 10500 - off(k);
    const taxable = half((net * 10000) / (10000 + rate));
    const cgst = Math.trunc((net - taxable) / 2);
    return { net, taxable, cgst, sgst: net - taxable - cgst };
  };
  const total = Array.from({ length: n }, (_, k) => split(k + 1).net).reduce((a, b) => a + b, 0) - (bill.wholeDiscount ?? 0);
  const sale = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, ${bill.soldAt ?? 'now()'}, $3, 'INR') returning id`, [
    s.tenant,
    s.shop,
    total,
  ]);
  const saleLines: string[] = [];
  for (let k = 1; k <= n; k++) {
    const { net, taxable } = split(k);
    saleLines.push(
      await one(
        c,
        `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, tax_class, tax_rate_bp, tax_minor, currency)
         values ($1, $2, $3, $4, 'good', $5, 1000, 10500, 10500, 'general_5', $6, $7, 'INR') returning id`,
        [s.tenant, sale, k, s.good, s.price, rate, k === 1 && bill.saleTax !== undefined ? bill.saleTax : net - taxable],
      ),
    );
    if (off(k)) {
      await c.query(`insert into books.sale_discount (tenant_id, sale_id, line_no, source, discount_reason, amount_minor, currency) values ($1, $2, $3, 'manual', 'damaged', $4, 'INR')`, [
        s.tenant,
        sale,
        k,
        off(k),
      ]);
    }
  }
  if (bill.wholeDiscount) {
    await c.query(`insert into books.sale_discount (tenant_id, sale_id, source, discount_reason, amount_minor, currency) values ($1, $2, 'manual', 'damaged', $3, 'INR')`, [
      s.tenant,
      sale,
      bill.wholeDiscount,
    ]);
  }
  const shown = Array.from({ length: bill.skipLine ? n - 1 : n }, (_, k) => {
    const { net, taxable, cgst, sgst } = split(k + 1);
    return { discount_minor: off(k + 1), taxable_minor: taxable, rate_bp: rate, cgst_minor: cgst, sgst_minor: sgst, total_minor: net, qty_milli: 1000, ...(k === 0 ? bill.invoiceLine : {}) };
  });
  const sum = (key: string) => shown.reduce((a, r) => a + Number((r as Record<string, unknown>)[key]), 0);
  const head = {
    kind: bill.kind ?? 'tax_invoice',
    taxable_minor: sum('taxable_minor'),
    cgst_minor: sum('cgst_minor'),
    sgst_minor: sum('sgst_minor'),
    total_minor: sum('total_minor'),
    ...bill.invoice,
  };
  const cols = Object.keys(head);
  const invoice = await one(
    c,
    `insert into books.invoice (tenant_id, sale_id, shop_id, currency, ${cols.join(', ')}) values ($1, $2, $3, 'INR', ${cols.map((_, i) => `$${i + 4}`).join(', ')}) returning id`,
    [s.tenant, sale, s.shop, ...Object.values(head)],
  );
  for (const [k, row] of shown.entries()) {
    const keys = Object.keys(row);
    await c.query(
      `insert into books.invoice_line (tenant_id, invoice_id, line_no, sale_line_id, description, ${keys.join(', ')})
       values ($1, $2, $3, $4, 'Kurta', ${keys.map((_, i) => `$${i + 5}`).join(', ')})`,
      [s.tenant, invoice, k + 1, saleLines[k], ...Object.values(row)],
    );
  }
  return { sale, invoice };
}
const record = (s: Shop, bill: Bill = {}) => cmd(s, s.staff, 'sale.record', (c) => sell(c, s, bill));

// sale.reverse: the reversal sale and lines, and its credit note naming the original invoice, its lines the reversal's.
const reverse = (s: Shop, sale: string, original: string) =>
  cmd(s, s.owner, 'sale.reverse', async (c) => {
    const r = await one(
      c,
      `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency, reverses_id, reason)
       select tenant_id, shop_id, now(), -total_minor, currency, id, 'returned_goods' from books.sale where id = $1 returning id`,
      [sale],
    );
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, qty_milli, unit_price_minor, gross_minor, tax_class, tax_rate_bp,
                                    tax_minor, currency, reverses_id, reason)
       select tenant_id, $2, line_no, item_id, item_kind, price_id, -qty_milli, unit_price_minor, -gross_minor, tax_class, tax_rate_bp, -tax_minor, currency, id,
              'returned_goods' from books.sale_line where sale_id = $1`,
      [sale, r],
    );
    const note = await one(
      c,
      `insert into books.invoice (tenant_id, sale_id, shop_id, kind, taxable_minor, cgst_minor, sgst_minor, total_minor, currency, original_invoice_id)
       select tenant_id, $2, shop_id, 'credit_note', -taxable_minor, -cgst_minor, -sgst_minor, -total_minor, currency, id from books.invoice where id = $1 returning id`,
      [original, r],
    );
    await c.query(
      `insert into books.invoice_line (tenant_id, invoice_id, line_no, sale_line_id, description, rate_bp, qty_milli, discount_minor, taxable_minor, cgst_minor, sgst_minor,
                                       total_minor)
       select l.tenant_id, $2, l.line_no, rl.id, l.description, l.rate_bp, -l.qty_milli, -l.discount_minor, -l.taxable_minor, -l.cgst_minor, -l.sgst_minor, -l.total_minor
         from books.invoice_line l join books.sale_line ol on ol.tenant_id = l.tenant_id and ol.id = l.sale_line_id
         join books.sale_line rl on rl.tenant_id = l.tenant_id and rl.reverses_id = ol.id
        where l.invoice_id = $1`,
      [original, note],
    );
    return note;
  });
const numbers = async (s: Shop, kind: string) =>
  (await db.admin.query<{ number: number }>(`select number from books.invoice where tenant_id = $1 and kind = $2 order by number`, [s.tenant, kind])).rows.map((r) => r.number);

// Sales on their own connections (the pools hold four), each in its own transaction, all at once; `rollback` ends one
// with a rollback after its invoice is numbered, and returns that number.
async function burst(n: number, rollback = false): Promise<number | undefined> {
  const clients = await Promise.all(
    Array.from({ length: n }, async () => {
      const c = new pg.Client({ host: '127.0.0.1', port: inject('pg17Port'), database: db.name, user: 'munshi_app', password: 'munshi_app' });
      await c.connect();
      return c;
    }),
  );
  try {
    const taken = await Promise.all(
      clients.map(async (c) => {
        await c.query('begin');
        await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'sale.record', true)`, [
          g.tenant,
          g.staff,
        ]);
        const { invoice } = await sell(c, g);
        const number = (await c.query<{ number: number }>('select number from books.invoice where id = $1', [invoice])).rows[0]?.number;
        await c.query(rollback ? 'rollback' : 'commit');
        return number;
      }),
    );
    return rollback ? taken[0] : undefined;
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

it('INV1 20 concurrent sales on one series get numbers 1..20 with no gap and no repeat; a rolled-back sale leaves no gap; the first credit note after tax invoice 1 is credit note 1 and is accepted', async () => {
  await burst(10);
  expect(await burst(1, true)).toBe(11); // numbered, then rolled back
  await burst(10);
  expect(await numbers(g, 'tax_invoice')).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  const first = (await db.admin.query(`select sale_id, id from books.invoice where tenant_id = $1 and kind = 'tax_invoice' and number = 1`, [g.tenant])).rows[0];
  await reverse(g, first.sale_id, first.id);
  expect(await numbers(g, 'credit_note')).toEqual([1]);
});

it('INV2 the number, time, year, series and GSTIN are the database’s; credit notes number their own series; a later number never has an earlier time; a backdated sale for a registered shop is refused (MS016)', async () => {
  const forged = await record(g, {
    invoice: { series: 'ZZ', fy: '2019-20', number: 999, issued_at: '2020-01-01T00:00:00Z', seller_gstin: '27BBBBB2222B2Z2', place_of_supply: '27' },
  });
  const { rows } = await db.admin.query(
    `select series, number > 20 and number < 999 as next, abs(extract(epoch from issued_at - now())) < 60 as now_ish,
            fy = to_char((issued_at at time zone 'Asia/Kolkata')::date - interval '3 months', 'YYYY') || '-' || to_char((issued_at at time zone 'Asia/Kolkata')::date + interval '9 months', 'YY') as fy_ok,
            fy ~ '^20[0-9]{2}-[0-9]{2}$' as fy_shape, seller_gstin, place_of_supply, registration_id = $2 as registration
       from books.invoice where id = $1`,
    [forged.invoice, g.registration],
  );
  expect(rows).toEqual([
    { series: 'GS', next: true, now_ish: true, fy_ok: true, fy_shape: true, seller_gstin: '07AAAAA1111A1Z1', place_of_supply: '07', registration: true },
  ]);
  // T1 starts first, T2 records and commits, then T1 records: T1's later number carries the later time.
  const t1 = await app.connect();
  try {
    await t1.query('begin');
    await t1.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'sale.record', true)`, [
      g.tenant,
      g.staff,
    ]);
    await t1.query('select 1');
    await new Promise((r) => setTimeout(r, 50));
    const second = await record(g);
    const first = await sell(t1, g);
    await t1.query('commit');
    const { rows: order } = await db.admin.query(
      `select a.number = b.number + 1 as next, a.issued_at > b.issued_at as later from books.invoice a, books.invoice b where a.id = $1 and b.id = $2`,
      [first.invoice, second.invoice],
    );
    expect(order).toEqual([{ next: true, later: true }]);
  } finally {
    t1.release();
  }
  const two = (await db.admin.query(`select sale_id, id from books.invoice where tenant_id = $1 and kind = 'tax_invoice' and number = 2`, [g.tenant])).rows[0];
  await reverse(g, two.sale_id, two.id);
  expect(await numbers(g, 'credit_note')).toEqual([1, 2]);
  const backdated = await refused(record(g, { soldAt: "now() - interval '1 hour'" }));
  expect([backdated.code, backdated.message]).toEqual(['MS016', 'invoice refused: a registered shop\'s sale is dated now']);
});

it('TOT1 an invoice line is its sale line’s taxed on its discounted price (D-052): its discount, total, rate, the half-up taxable value, the tax and its CGST share; the invoice’s totals its lines’; every sale line on it, every discount on a line (MS004)', async () => {
  const message = "invoice refused: its totals are not its lines', or a line is not its sale line's taxed on its discounted price";
  const cases: [string, Bill][] = [
    ['a sale line’s tax that is not the invoice line’s', { saleTax: 600 }],
    ['a line’s quantity', { invoiceLine: { qty_milli: 2000 } }],
    ['the header’s totals', { invoice: { taxable_minor: 9999, total_minor: 10499 } }],
    ['a sale line left off', { lines: 2, skipLine: true }],
    // the undiscounted gross kept on a discounted line, its tax with it
    ['the undiscounted gross', { discount: 500, saleTax: 500, invoiceLine: { discount_minor: 0, total_minor: 10500, taxable_minor: 10000, cgst_minor: 250, sgst_minor: 250 } }],
    // 9523.8 truncated, not rounded half away from zero
    ['tax rounded otherwise', { discount: 500, saleTax: 477, invoiceLine: { taxable_minor: 9523, cgst_minor: 238, sgst_minor: 239 } }],
    ['CGST and SGST split otherwise', { invoiceLine: { cgst_minor: 200, sgst_minor: 300 } }],
    ['a discount shown otherwise', { discount: 500, invoiceLine: { discount_minor: 400 } }],
    ['a rate that is not the sale line’s', { invoiceLine: { rate_bp: 1200 } }],
    ['a discount on the whole sale', { wholeDiscount: 100 }],
  ];
  for (const [what, bill] of cases) {
    const r = await refused(record(g, bill));
    expect([r.code, r.message], what).toEqual(['MS004', message]);
  }
  await record(g, { lines: 2 });
  const { invoice } = await record(g, { discount: 500 });
  const { rows } = await db.admin.query('select discount_minor, taxable_minor, cgst_minor, sgst_minor, total_minor from books.invoice_line where invoice_id = $1', [invoice]);
  expect(rows).toEqual([{ discount_minor: '500', taxable_minor: '9524', cgst_minor: '238', sgst_minor: '238', total_minor: '10000' }]);
});

it('GST a registration’s GSTIN is its state’s and only an unregistered one has none; an invoice takes the latest in effect for its shop’s state; a composition shop issues a bill of supply carrying no tax, a regular one a tax invoice, an unregistered one none', async () => {
  const register = (scheme: string, gstin: string | null, state = '07') =>
    cmd(h, h.owner, 'tax.registration.set', (c) =>
      one(c, `insert into books.tax_registration (tenant_id, scheme, gstin, state_code, effective_from) values ($1, $2, $3, $4, current_date) returning id`, [
        h.tenant,
        scheme,
        gstin,
        state,
      ]),
    );
  expect((await refused(register('regular', '27AAAAA1111A1Z1'))).code, 'another state').toBe('23514');
  expect((await refused(register('regular', null))).code, 'regular, no GSTIN').toBe('23514');
  expect((await refused(register('unregistered', '07AAAAA1111A1Z1'))).code, 'unregistered with one').toBe('23514');
  const refusedKind = async (bill: Bill, why: RegExp) => {
    const r = await refused(record(h, bill));
    expect(r.code).toBe('MS007');
    expect(r.message).toMatch(why);
  };
  await refusedKind({ kind: 'bill_of_supply', rate: 0 }, /a bill_of_supply needs the shop's registration in effect to allow it/);
  const newer = await register('regular', '07CCCCC3333C3Z3');
  const { invoice } = await record(h);
  expect((await db.admin.query('select registration_id = $2 as latest, seller_gstin from books.invoice where id = $1', [invoice, newer])).rows).toEqual([
    { latest: true, seller_gstin: '07CCCCC3333C3Z3' },
  ]);
  await register('composition', '07DDDDD4444D4Z4');
  await refusedKind({}, /a tax_invoice needs the shop's registration in effect to allow it/);
  expect((await refused(record(h, { kind: 'bill_of_supply' }))).code, 'a bill of supply with tax').toBe('23514');
  await record(h, { kind: 'bill_of_supply', rate: 0 });
  await register('unregistered', null);
  await refusedKind({ kind: 'bill_of_supply', rate: 0 }, /a bill_of_supply needs the shop's registration in effect to allow it/);
});

it('GST a credit note is a reversal sale’s, naming its original sale’s invoice; a tax invoice never is; an invoice is its sale’s shop’s, which has a series', async () => {
  const a = await record(g);
  const b = await record(g);
  const asNote = await refused(record(g, { kind: 'credit_note', invoice: { original_invoice_id: a.invoice } }));
  expect([asNote.code, asNote.message]).toEqual(['MS013', 'invoice refused: a credit note is the reversal sale\'s, naming the original sale\'s invoice']);
  const wrongOriginal = await refused(reverse(g, a.sale, b.invoice));
  expect(wrongOriginal.code).toBe('MS013');
  await reverse(g, a.sale, a.invoice);
  const second = await tx(app, { tenant_id: g.tenant, actor_id: g.owner }, (c) => one(c, `insert into ops.shop (tenant_id, name, state_code) values ($1, 'Branch', '07') returning id`, [g.tenant]));
  const noSeries = await refused(record({ ...g, shop: second }));
  expect([noSeries.code, noSeries.message]).toEqual(['MS007', 'invoice refused: an invoice is its sale\'s shop\'s, which has an invoice series and a state']);
});
