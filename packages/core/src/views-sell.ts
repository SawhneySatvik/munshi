// The selling screens of BP-APP-1 (apps/web/lib/server/sell.ts shows them): offers, packages, loyalty, GST invoices and
// customers. Each view reads in the page's one transaction (withPage) and asks first whether the shop can use the
// capability the screen belongs to (can(), §8.13): a switched-off capability's view returns null and reads nothing
// more, so its screen is absent. Every figure is a cell of a snapshot minted here as the signed-in member; names, codes
// and states are read beside them and are never figures.
import { type Capability, can } from './capabilities.ts';
import { mayReadIn } from './read-roles.ts';
import type { Session } from './session.ts';
import { businessDate } from './time.ts';
import { type Client, customerList, itemList, mint, read, type StoredSnapshot, type Viewer, viewer } from './views-common.ts';

export type Shop = { id: string; name: string; stateCode: string | null; series: string | null };

/** The shop's branches, oldest first (the counter's is the first). */
export const shopList = async (c: Client): Promise<Shop[]> =>
  (
    await read<{ id: string; name: string; state_code: string | null; invoice_series: string | null }>(
      c,
      'select id::text, name, state_code, invoice_series from ops.shop order by created_at, id',
    )
  ).map((s) => ({ id: s.id, name: s.name, stateCode: s.state_code, series: s.invoice_series }));

/** Which of `caps` the shop can use now, each asked once inside the page's transaction. */
export async function capsOf(c: Client, session: Session, caps: readonly Capability[]): Promise<Set<Capability>> {
  const on = new Set<Capability>();
  for (const cap of caps) if (await can(c, session, cap)) on.add(cap);
  return on;
}

export type OffersView = { viewer: Viewer; offers: StoredSnapshot; categories: string[]; items: { id: string; name: string }[] };

export async function viewOffers(c: Client, session: Session): Promise<OffersView | null> {
  if (!(await can(c, session, 'offers')) || !(await mayReadIn(c, 'offers.list'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const offers = await mint(c, 'offers.list', {});
  const items = await itemList(c, { byCategory: true });
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  return { viewer: me, offers, categories, items: items.map((i) => ({ id: i.id, name: i.name })) };
}

export type PackagesView = {
  viewer: Viewer;
  plans: StoredSnapshot;
  holdings: StoredSnapshot;
  shops: Shop[];
  services: { id: string; name: string }[];
  // The holding the screen opened: its services' balances (package.balance), or null.
  balance: StoredSnapshot | null;
};

export async function viewPackages(c: Client, session: Session, holdingId: string | null): Promise<PackagesView | null> {
  if (!(await can(c, session, 'packages')) || !(await mayReadIn(c, 'package.plans'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const plans = await mint(c, 'package.plans', {});
  const holdings = await mint(c, 'package.holdings', { customer_id: null });
  const held = holdingId && holdings.rows.some((r) => r.holding_id?.kind === 'text' && r.holding_id.txt === holdingId);
  const balance = held ? await mint(c, 'package.balance', { holding_id: holdingId }) : null;
  const services = await read<{ id: string; name: string }>(
    c,
    `select i.id::text, (select r.name from books.item_revision r where r.tenant_id = i.tenant_id and r.item_id = i.id and r.effective_from <= now()
                          order by r.effective_from desc, r.created_at desc, r.id desc limit 1) as name
       from books.item i where i.kind = 'service' order by 2, 1`,
  );
  return { viewer: me, plans, holdings, shops: await shopList(c), services, balance };
}

export type LoyaltyView = { viewer: Viewer; rule: StoredSnapshot; balances: StoredSnapshot };

export async function viewLoyalty(c: Client, session: Session): Promise<LoyaltyView | null> {
  if (!(await can(c, session, 'loyalty')) || !(await mayReadIn(c, 'loyalty.rule'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  return { viewer: me, rule: await mint(c, 'loyalty.rule', {}), balances: await mint(c, 'loyalty.balances', {}) };
}

export type CustomersView = {
  viewer: Viewer;
  customers: { id: string; name: string }[];
  balances: StoredSnapshot | null; // credit.balances, with credit on
  points: StoredSnapshot | null; // loyalty.balances, with loyalty on
};

// The customers screen belongs to the counter: every pack has it.
export async function viewCustomers(c: Client, session: Session): Promise<CustomersView | null> {
  const on = await capsOf(c, session, ['counter', 'credit', 'loyalty']);
  if (!on.has('counter') || !(await mayReadIn(c, 'screen.customers'))) return null; // the office's (read-roles.ts SCREENS)
  const me = await viewer(c, session);
  const today = businessDate(new Date(), me.timeZone);
  return {
    viewer: me,
    customers: await customerList(c),
    balances: on.has('credit') ? await mint(c, 'credit.balances', { as_of: today }) : null,
    points: on.has('loyalty') ? await mint(c, 'loyalty.balances', {}) : null,
  };
}

export type CustomerView = {
  viewer: Viewer;
  customer: { id: string; name: string };
  credit: StoredSnapshot | null; // credit.balance
  points: StoredSnapshot | null; // loyalty.balance
  holdings: StoredSnapshot | null; // package.holdings for the customer
};

/** One customer of this shop, or null (off, or no such customer here). */
export async function viewCustomer(c: Client, session: Session, customerId: string): Promise<CustomerView | null> {
  const on = await capsOf(c, session, ['counter', 'credit', 'loyalty', 'packages']);
  if (!on.has('counter') || !(await mayReadIn(c, 'screen.customers'))) return null; // the office's (read-roles.ts SCREENS)
  const [customer] = await customerList(c, [customerId]);
  if (!customer) return null;
  const me = await viewer(c, session);
  return {
    viewer: me,
    customer,
    credit: on.has('credit') ? await mint(c, 'credit.balance', { customer_id: customerId }) : null,
    points: on.has('loyalty') ? await mint(c, 'loyalty.balance', { customer_id: customerId }) : null,
    holdings: on.has('packages') ? await mint(c, 'package.holdings', { customer_id: customerId }) : null,
  };
}

export type Registration = { scheme: string; gstin: string | null; stateCode: string; effectiveFrom: string } | null;

/** The GST registration in effect today (the latest), or null. */
export async function registrationOf(c: Client): Promise<Registration> {
  const [r] = await read<{ scheme: string; gstin: string | null; state_code: string; effective_from: string }>(
    c,
    `select scheme, gstin, state_code, effective_from::text from books.tax_registration
      where effective_from <= (now() at time zone (select time_zone from ops.tenant))::date
      order by effective_from desc, created_at desc, id desc limit 1`,
  );
  return r ? { scheme: r.scheme, gstin: r.gstin, stateCode: r.state_code, effectiveFrom: r.effective_from } : null;
}

export type InvoicesView = {
  viewer: Viewer;
  shops: Shop[];
  shopId: string;
  month: string;
  registration: Registration;
  invoices: StoredSnapshot; // invoices.list for the branch and month
  summary: StoredSnapshot; // gst.summary for the month
};

const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export async function viewInvoices(c: Client, session: Session, shopId: string | null, month: string | null): Promise<InvoicesView | null> {
  if (!(await can(c, session, 'gst')) || !(await mayReadIn(c, 'invoices.list'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const shops = await shopList(c);
  const shop = shops.find((s) => s.id === shopId) ?? shops[0];
  if (!shop) return null;
  const m = month && MONTH.test(month) ? month : businessDate(new Date(), me.timeZone).slice(0, 7);
  return {
    viewer: me,
    shops,
    shopId: shop.id,
    month: m,
    registration: await registrationOf(c),
    invoices: await mint(c, 'invoices.list', { shop_id: shop.id, month: m, page: 0 }),
    summary: await mint(c, 'gst.summary', { month: m }),
  };
}

export type InvoiceView = {
  viewer: Viewer;
  shop: Shop | null;
  detail: StoredSnapshot; // invoice.detail
  customer: { id: string; name: string } | null;
  // The credit note that cancels this invoice, or the invoice a credit note cancels: ids only.
  creditNoteId: string | null;
  saleReversed: boolean;
};

/** One invoice, bill of supply or credit note of this shop with every printed figure a cell, or null. */
export async function viewInvoice(c: Client, session: Session, invoiceId: string): Promise<InvoiceView | null> {
  if (!(await can(c, session, 'gst')) || !(await mayReadIn(c, 'invoice.detail'))) return null; // the office's (read-roles.ts)
  const [v] = await read<{ shop_id: string; sale_id: string; customer_id: string | null; credit_note: string | null; reversed: boolean }>(
    c,
    `select v.shop_id::text, v.sale_id::text, s.customer_id::text,
            (select n.id::text from books.invoice n where n.tenant_id = v.tenant_id and n.original_invoice_id = v.id limit 1) as credit_note,
            exists (select 1 from books.sale r where r.tenant_id = s.tenant_id and r.reverses_id = s.id) as reversed
       from books.invoice v join books.sale s on s.tenant_id = v.tenant_id and s.id = v.sale_id
      where v.id = $1`,
    [invoiceId],
  );
  if (!v) return null;
  const me = await viewer(c, session);
  const shop = (await shopList(c)).find((s) => s.id === v.shop_id) ?? null;
  const customer = v.customer_id ? ((await customerList(c, [v.customer_id]))[0] ?? null) : null;
  return { viewer: me, shop, detail: await mint(c, 'invoice.detail', { invoice_id: invoiceId }), customer, creditNoteId: v.credit_note, saleReversed: v.reversed };
}
