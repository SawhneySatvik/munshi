// Builds "Prabhave (sample catalogue)" (slug prabhave, the apparel pack), the suit shop in Kirti Nagar.
// PLACEHOLDERS: Prabhave's real catalogue, its spelling (to confirm with the shop) and its measurement points are not
// available, so every piece is a LABELLED SAMPLE from db/seed/merchants/prabhave/catalogue.json (names end "(sample)";
// none is the shop's own stock or price). Suppliers are simulated; customers are invented, with no phone numbers; the
// public's asks carry the demo's sample phone, the only one a demo stores. Payments are recorded, never processed.
//
// Variants are plain goods named with their colour and size: core has no grid or variant writer yet (grid.apply is
// empty), so no piece has a parent. The tenant is provisioned as the operator would (provision.ts); everything after is
// written through packages/core as its members (direct commands; the site, its look and the two holds as members' ops
// rows; asks and carts through core's public functions). The site's one release is published as the owner role, the
// only role that publishes off live (ops.release_check), its catalogue cells read from the books in that transaction.
//
// Days are offsets from as_of; the holds and the site's cart requests are made now. Deterministic for a given as_of;
// the hand-worked key is db/seed/prabhave.answers.json. Planted: a dead-stock piece, a hold about to run out, a site
// request left unanswered and a stitching order past its due date, with near-miss controls beside each.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  addDays,
  addMember,
  askToHold,
  CATALOGUE,
  holdPiece,
  intakeSite,
  localTime,
  openSession,
  recordPayment,
  recordPurchase,
  recordSale,
  runCommand,
  type Session,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import { provision } from './provision.ts';

export const PRABHAVE = 'Prabhave (sample catalogue)';
export type PrabhavePlant = 'dead_stock' | 'hold_expiring' | 'order_unanswered' | 'order_late';
export const PRABHAVE_PLANTS: PrabhavePlant[] = ['dead_stock', 'hold_expiring', 'order_unanswered', 'order_late'];
export const SAMPLE_PHONE = '+910000000000';

type Product = { ref: string; category: string; name: string; variants: { ref: string; colour: string; size?: string; priceMinor: number }[] };
const CATALOGUE_JSON = JSON.parse(readFileSync(new URL('./merchants/prabhave/catalogue.json', import.meta.url), 'utf8')) as { products: Product[] };

const TZ = 'Asia/Kolkata';
const SUPPLIERS = { surat: 'Surat Textiles (simulated)', jaipur: 'Jaipur Prints (simulated)' } as const;
const JAIPUR = new Set(['u-print', 'd-tiedye']);
const LATE = new Set(['stitched']); // bought on day −30; the rest on day −120 (Powder blue too comes on day −30)
const CUSTOMERS = ['Rashmi T.', 'Kavita N.', 'Meenakshi P.', 'Farah Q.', 'Kiran D.'];

// The pieces the plants and controls name (each a variant's item name).
export const PIECES = {
  dead: 'Embroidered muslin suit set, Wine (sample)',
  nearDead: 'Embroidered muslin suit set, Bottle green (sample)',
  fresh: 'Embroidered muslin suit set, Powder blue (sample)',
  heldSoon: 'Silk-blend festive suit, Magenta, M (sample)',
  heldLong: 'Thread-work straight suit, White, M (sample)',
  waiting: 'Georgette Anarkali, semi-stitched, Maroon, Free size (sample)',
  confirmed: 'Cotton kurta with palazzo, Yellow, M (sample)',
  late: 'Silk-cotton suit set with gota work, Mint (sample)',
  ready: 'Georgette Anarkali, semi-stitched, Royal blue, Free size (sample)',
};

export type Prabhave = {
  tenantId: string;
  asOf: string;
  owner: Session;
  manager: Session;
  counter: Session;
  shopId: string;
  siteId: string;
  items: Map<string, string>; // piece name → item id
  customers: Map<string, string>;
  reservations: Map<string, string>; // piece name → reservation id
  requests: Map<string, string>; // waiting | confirmed → request id
  orders: Map<string, string>; // late | ready | confirmed → order id
  counts: { pieces: number; sales: number; purchases: number };
};

const cost = (priceMinor: number) => (priceMinor * 6) / 10; // a bill cost of 60% of the price: whole paise for every sample price
const ipHash = (label: string) => createHash('sha256').update(`prabhave-sample:${label}`).digest('hex');

export async function seedPrabhave(app: pg.Pool, pub: pg.Pool, ownerDb: pg.ClientBase, opts: { asOf: string; omit?: PrabhavePlant[]; slug?: string }): Promise<Prabhave> {
  const asOf = opts.asOf;
  const planted = (p: PrabhavePlant) => !(opts.omit ?? []).includes(p);
  const date = (d: number) => addDays(asOf, d);
  const at = (d: number, minute: number) => localTime(date(d), minute, TZ).toISOString();
  const since = at(-400, 0);

  const made = await provision(ownerDb, { slug: opts.slug ?? 'prabhave', name: PRABHAVE, businessType: 'apparel', ownerName: 'Owner (sample)', shops: ['Kirti Nagar'] });
  const tenantId = made.tenantId;
  const shopId = made.shopIds[0] as string;
  const as = async (memberId: string) => (await openSession(app, tenantId, memberId)) as Session;
  const owner = await as(made.ownerId);
  const manager = await as(await addMember(app, owner, { name: 'Counter manager (sample)', role: 'manager' }));
  const counter = await as(await addMember(app, owner, { name: 'Counter staff (sample)', role: 'staff' }));
  const cmd = async (s: Session, name: string, input: unknown) => (await runCommand(app, s, name, input)) as Record<string, string>;
  await cmd(owner, 'staff.create', { name: 'Counter staff (sample)', memberId: counter.memberId, shopId, dailyWageMinor: 60_000, joinedOn: date(-400), effectiveFrom: since });

  const supplier = {
    surat: (await cmd(owner, 'supplier.create', { name: SUPPLIERS.surat, effectiveFrom: since })).supplierId as string,
    jaipur: (await cmd(owner, 'supplier.create', { name: SUPPLIERS.jaipur, effectiveFrom: since })).supplierId as string,
  };

  // Every variant a piece of its own, priced; stock from the simulated suppliers' bills.
  const items = new Map<string, string>();
  const priceOf = new Map<string, number>();
  type Line = { name: string; qty: number };
  const bills: Record<'surat120' | 'jaipur120' | 'surat30', Line[]> = { surat120: [], jaipur120: [], surat30: [] };
  const old: string[] = []; // the pieces stocked on day −120, in catalogue order
  for (const p of CATALOGUE_JSON.products) {
    for (const v of p.variants) {
      const name = `${p.name}, ${v.colour}${v.size ? `, ${v.size}` : ''} (sample)`;
      const { itemId } = await cmd(owner, 'item.create', { name, unit: 'piece', category: p.category, effectiveFrom: since });
      await cmd(owner, 'price.set', { itemId, amountMinor: v.priceMinor, effectiveFrom: since });
      items.set(name, itemId as string);
      priceOf.set(name, v.priceMinor);
      if (LATE.has(p.category)) bills.surat30.push({ name, qty: 2000 });
      else if (name === PIECES.fresh) bills.surat30.push({ name, qty: 3000 });
      else {
        bills[JAIPUR.has(p.ref) ? 'jaipur120' : 'surat120'].push({ name, qty: 4000 });
        old.push(name);
      }
    }
  }
  const item = (name: string) => items.get(name) as string;
  const counts = { pieces: items.size, sales: 0, purchases: 0 };
  const bill = async (by: keyof typeof supplier, billNo: string, d: number, lines: Line[]) => {
    await recordPurchase(app, manager, {
      supplierId: supplier[by],
      billNo,
      billDate: date(d),
      receivedAt: at(d, 600),
      lines: lines.map((l) => ({ itemId: item(l.name), qtyMilli: l.qty, unitCostMinor: cost(priceOf.get(l.name) as number) })),
    });
    counts.purchases++;
  };
  await bill('surat', 'ST-101', -120, bills.surat120);
  await bill('jaipur', 'JP-201', -120, bills.jaipur120);
  await bill('surat', 'ST-102', -30, bills.surat30);

  const customers = new Map<string, string>();
  for (const name of CUSTOMERS) customers.set(name, (await cmd(owner, 'customer.create', { name, effectiveFrom: since })).customerId as string);
  const cid = (name: string) => customers.get(name) as string;

  // The Diwali offer: 10% off stitched suits with the code, from day −20 to day 15.
  await cmd(owner, 'offer.create', {
    name: 'Diwali offer (sample)',
    kind: 'percent_off',
    percentBp: 1000,
    scope: 'category',
    category: 'stitched',
    code: 'DIWALI10',
    startsAt: at(-20, 0),
    endsAt: at(15, 0),
    published: true,
  });

  const sell = async (d: number, name: string, o: { customer?: string; pay?: number; code?: string } = {}) => {
    const full = priceOf.get(name) as number;
    const pay = o.pay ?? (o.code ? full - Math.round(full / 10) : full);
    await recordSale(app, counter, {
      shopId,
      soldAt: at(d, 690 + (counts.sales % 9) * 40),
      ...(o.customer ? { customerId: cid(o.customer) } : {}),
      lines: [{ itemId: item(name), qtyMilli: 1000 }],
      payments: pay > 0 ? [{ method: d % 2 === 0 ? 'cash' : 'upi', amountMinor: pay }] : [],
      ...(o.code ? { offerCodes: [o.code] } : {}),
    });
    counts.sales++;
  };
  // Each piece stocked on day −120 sells one early (days −95 … −76) and one recently (days −40 … −16), but for the plant:
  // Wine sells once, on day −70, and never since (3 left); Bottle green's recent sale is on day −44, a day inside the
  // 45-day window (the near miss).
  for (const [i, name] of old.entries()) {
    if (name === PIECES.dead) {
      await sell(-70, name);
      if (!planted('dead_stock')) await sell(-20, name);
      continue;
    }
    await sell(-95 + (i % 20), name);
    await sell(name === PIECES.nearDead ? -44 : -40 + (i % 30), name);
  }
  // Udhaar: Rashmi's ₹1,499 dupatta on credit on day −45 (due day −15), ₹1,449 repaid on day −30: ₹50 past due, under
  // the ₹100 threshold; Kavita's ₹1,150 suit, ₹500 paid, the rest due on day 20. Meenakshi came three times, the last
  // on day −50: not yet lapsing.
  await sell(-45, 'Embroidered cotton dupatta, Pink (sample)', { customer: 'Rashmi T.', pay: 0 });
  await recordPayment(app, counter, { direction: 'in', customerId: cid('Rashmi T.'), method: 'cash', amountMinor: 144_900, paidAt: at(-30, 1100) });
  await sell(-10, 'Printed cotton suit set, Rust (sample)', { customer: 'Kavita N.', pay: 50_000 });
  for (const [d, name] of [
    [-110, 'Tie-dye georgette dupatta, Red (sample)'],
    [-80, 'Tie-dye georgette dupatta, Yellow (sample)'],
    [-50, 'Brocade silk dupatta, Red (sample)'],
  ] as const)
    await sell(d, name, { customer: 'Meenakshi P.' });
  // The festive season under the Diwali code.
  for (const [d, name] of [
    [-18, 'Cotton kurta with palazzo, Yellow, S (sample)'],
    [-12, 'Cotton kurta with palazzo, Teal, L (sample)'],
    [-6, 'Cotton kurta with palazzo, White, M (sample)'],
    [-3, 'Silk-blend festive suit, Bottle green, L (sample)'],
  ] as const)
    await sell(d, name, { code: 'DIWALI10' });

  // Orders taken at the counter: a stitching order on Mint fabric due on day −3, still at cutting (the plant); a goods
  // order due on day −2 that is ready (the control).
  const orders = new Map<string, string>();
  const late = await cmd(manager, 'order.confirm', {
    shopId,
    customerId: cid('Meenakshi P.'),
    kind: 'stitching',
    dueOn: date(planted('order_late') ? -3 : 3),
    lines: [{ itemId: item(PIECES.late), qtyMilli: 1000 }],
  });
  await cmd(manager, 'order.step', { orderId: late.orderId, step: 'cutting' });
  orders.set('late', late.orderId as string);
  const ready = await cmd(manager, 'order.confirm', { shopId, customerId: cid('Farah Q.'), kind: 'goods', dueOn: date(-2), lines: [{ itemId: item(PIECES.ready), qtyMilli: 1000 }] });
  await cmd(manager, 'order.step', { orderId: ready.orderId, step: 'ready' });
  orders.set('ready', ready.orderId as string);

  // The site (holds kept 48 hours), its look, and its release: the catalogue's cells, each piece's price in effect,
  // read from the books by the owner role in the publishing transaction.
  const siteId = await withTx(app, { kind: 'member', session: owner }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.site (tenant_id, privacy_version, consent_version, reservation_hours) values ($1, 'v1', 'v1', 48) returning id::text`,
      [tenantId],
    );
    const id = (rows[0] as { id: string }).id;
    await c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{"--ground": "#ffffff"}', 'inter')`, [tenantId, id]);
    return id;
  });
  await ownerDb.query('begin');
  try {
    await ownerDb.query('set local role munshi_owner');
    await ownerDb.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    const columns = [
      { n: CATALOGUE.item, k: 'text' },
      { n: 'item', k: 'text' },
      { n: CATALOGUE.price, k: 'money' },
    ];
    const { rows } = await ownerDb.query<{ id: string }>(
      `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
       select $1, $2, '{}', 'release', $3::jsonb,
              coalesce(jsonb_agg(jsonb_build_array(jsonb_build_object('k', 'text', 't', i.id::text), jsonb_build_object('k', 'text', 't', r.name),
                                                   jsonb_build_object('k', 'money', 'n', p.amount_minor::text, 'c', p.currency)) order by r.name), '[]'),
              '\\x00', '\\x00', 0
         from books.item i
         join lateral (select x.name from books.item_revision x where x.item_id = i.id and x.effective_from <= now()
                        order by x.effective_from desc, x.created_at desc, x.id desc limit 1) r on true
         join lateral (select x.amount_minor, x.currency from books.price x where x.item_id = i.id and x.effective_from <= now()
                        order by x.effective_from desc, x.created_at desc, x.id desc limit 1) p on true
        where i.kind = 'good'
       returning id::text`,
      [tenantId, CATALOGUE.query, JSON.stringify(columns)],
    );
    const { rows: look } = await ownerDb.query<{ id: string }>('select id::text from ops.site_look where site_id = $1', [siteId]);
    await ownerDb.query(`insert into ops.site_release (tenant_id, id, site_id, look_id, snapshots, created_txid) values ($1, $2, $3, $4, $5, 0)`, [
      tenantId,
      randomUUID(),
      siteId,
      look[0]?.id,
      JSON.stringify({ [CATALOGUE.query]: rows[0]?.id }),
    ]);
    await ownerDb.query('commit');
  } catch (err) {
    await ownerDb.query('rollback');
    throw err;
  }

  // Two pieces on hold: the thread-work suit under the site's 48 hours (the control); then, the shop having cut holds
  // to 12 hours for the festive rush, the Magenta festive suit (the plant: it runs out within the day).
  const reservations = new Map<string, string>();
  const hold = async (name: string) => {
    const id = await askToHold(pub, tenantId, {
      siteId,
      itemId: item(name),
      qtyMilli: 1000,
      name: 'Visitor (sample)',
      phone: SAMPLE_PHONE,
      noticeVersion: 'v1',
      consentVersion: 'v1',
      ipHash: ipHash(name),
    });
    await holdPiece(app, counter, id);
    reservations.set(name, id);
  };
  await hold(PIECES.heldLong);
  if (planted('hold_expiring')) {
    await withTx(app, { kind: 'member', session: owner }, (c) => c.query('update ops.site set reservation_hours = 12 where id = $1', [siteId]));
  }
  await hold(PIECES.heldSoon);

  // The site's carts: one the manager confirmed into an order due on day 5 (the control), and the last, left waiting (the
  // plant: unanswered from 30 minutes after it arrived).
  const requests = new Map<string, string>();
  const cart = async (name: string) =>
    (await withTx(pub, { kind: 'system', tenantId }, (c) => intakeSite(c, { shopId, lines: [{ itemId: item(name), qtyMilli: 1000 }] }))).requestId;
  requests.set('confirmed', await cart(PIECES.confirmed));
  const confirmed = await cmd(manager, 'order.confirm', { requestId: requests.get('confirmed'), customerId: cid('Kiran D.'), dueOn: date(5) });
  orders.set('confirmed', confirmed.orderId as string);
  if (planted('order_unanswered')) requests.set('waiting', await cart(PIECES.waiting));

  return { tenantId, asOf, owner, manager, counter, shopId, siteId, items, customers, reservations, requests, orders, counts };
}
