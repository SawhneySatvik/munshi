// The suppliers' bills and the suppliers page (apps/web/lib/server/{bills,suppliers}.ts show them): the month's bills
// (bills.recent), one bill and its lines (bill.lines_for), the form's catalogue, an item's last bill price
// (purchases.last_price), and each supplier's last bill with the last price of every item on it (purchases.last_prices).
// Every figure is a cell of a snapshot minted here as the signed-in member, in the page's one transaction.
// Bills and suppliers are the owner's and a manager's (read-roles.ts): each page's view is null for anyone whose role
// may not read its bills (the page's 404).
import { mayReadIn } from './read-roles.ts';
import type { Session } from './session.ts';
import {
  asOfDate,
  type Client,
  itemList,
  mint,
  read,
  type StoredSnapshot,
  supplierList,
  type Viewer,
  viewer,
} from './views-common.ts';
import { type HomeView, viewHome } from './views-home.ts';

export type Firm = { id: string; name: string; simulated: boolean };

/** Bills dated in the month to as_of: bills.recent's widest window. */
const recentBills = (asOf: string) => ({ days: 31, as_of: asOf });

export async function viewBills(c: Client, session: Session): Promise<{ viewer: Viewer; asOf: string; firms: Firm[]; bills: StoredSnapshot } | null> {
  if (!(await mayReadIn(c, 'bills.recent'))) return null;
  const me = await viewer(c, session);
  const asOf = await asOfDate(c, me.timeZone);
  const firms = await supplierList(c);
  return { viewer: me, asOf, firms, bills: await mint(c, 'bills.recent', recentBills(asOf)) };
}

export type BillView = {
  viewer: Viewer;
  firms: Firm[];
  entered: { by: string; at: Date; createdBy: string };
  bill: StoredSnapshot; // bills.recent for the bill's date
  lines: StoredSnapshot; // bill.lines_for
};

/** One live bill of this shop and its lines, or null (no such id here, or reversed). */
export async function viewBill(c: Client, session: Session, purchaseId: string): Promise<BillView | null> {
  if (!(await mayReadIn(c, 'bill.lines_for'))) return null;
  const [p] = await read<{ bill_date: string; created_by: string; by: string; at: Date }>(
    c,
    `select p.bill_date::text as bill_date, p.created_by::text as created_by, m.display_name as by, p.created_at as at
       from books.purchase p join ops.member m on m.tenant_id = p.tenant_id and m.id = p.created_by
      where p.id = $1 and p.reverses_id is null`,
    [purchaseId],
  );
  if (!p) return null;
  const me = await viewer(c, session);
  const firms = await supplierList(c);
  const bill = await mint(c, 'bills.recent', { days: 1, as_of: p.bill_date });
  const lines = await mint(c, 'bill.lines_for', { purchase_id: purchaseId });
  return { viewer: me, firms, entered: { by: p.by, at: p.at, createdBy: p.created_by }, bill, lines };
}

export async function viewBillForm(c: Client, session: Session) {
  if (!(await mayReadIn(c, 'purchases.last_price'))) return null;
  const me = await viewer(c, session);
  const firms = await supplierList(c);
  const items = await itemList(c, { byCategory: true });
  return { viewer: me, firms, items, asOf: await asOfDate(c, me.timeZone) };
}

/** The item's latest bill line (purchases.last_price), minted now, with the suppliers it may name. */
export async function viewLastPrice(c: Client, itemId: string): Promise<{ price: StoredSnapshot; firms: Firm[] }> {
  const price = await mint(c, 'purchases.last_price', { item_id: itemId });
  return { price, firms: await supplierList(c) };
}

export type SuppliersView = {
  home: HomeView;
  viewer: Viewer;
  firms: Firm[];
  bills: StoredSnapshot; // bills.recent, newest first
  onBill: { purchaseId: string; itemId: string }[]; // the lines of each supplier's last bill
  prices: StoredSnapshot; // purchases.last_prices
};

export async function viewSuppliers(c: Client, session: Session): Promise<SuppliersView | null> {
  if (!(await mayReadIn(c, 'purchases.last_prices'))) return null;
  const home = await viewHome(c, session);
  const me = home.viewer;
  const asOf = await asOfDate(c, me.timeZone);
  const firms = await supplierList(c);
  const bills = await mint(c, 'bills.recent', recentBills(asOf));
  // bills.recent is newest first: each supplier's first row is its last bill.
  const last = new Map<string, string>();
  for (const row of bills.rows) {
    const [firm, id] = [row.supplier_id, row.purchase_id];
    if (firm?.kind === 'text' && id?.kind === 'text' && !last.has(firm.txt)) last.set(firm.txt, id.txt);
  }
  const onBill = (
    await read<{ purchase_id: string; item_id: string }>(
      c,
      'select purchase_id::text, item_id::text from books.purchase_line where purchase_id = any($1::uuid[]) order by purchase_id, line_no',
      [[...last.values()]],
    )
  ).map((l) => ({ purchaseId: l.purchase_id, itemId: l.item_id }));
  const prices = await mint(c, 'purchases.last_prices', {});
  return { home, viewer: me, firms, bills, onBill, prices };
}
