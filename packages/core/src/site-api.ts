// The public API's reads and writes (BLUEPRINT §5.1), each on the munshi_public pool under the tenant the slug named
// (public.ts openSite), with no actor. The shapes are packages/contracts' v1 responses, which the routes parse again.
//
// Guarantee clause 2: every figure is a cell of the site's latest release, a `release` snapshot pinned by it, carrying
// its ref; a cart's line amounts and total are derived by the counter's line function from those cells and carry the
// refs they came from. Overlays read live are flags and roster times, never numbers: a held piece, an offer that has
// ended since, a free slot. Guarantee clause 1: the writes are ops rows only (a hold, a booking request and its contact,
// a site request, a reservation, an order request, an idempotency row); nothing here names a books table for writing.
//
// Idempotency (§5.4, IDEM1's site half): every write claims (site:<id>, key) in its own transaction, storing the
// request's sha256 and, once it ran, its ids. A replay answers again from those ids; a different request under the key
// is idempotency_mismatch.
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { placeHoldIn, releaseHoldIn, requestBookingIn } from './booking.ts';
import { toCoreError } from './errors.ts';
import { canonical } from './idempotency.ts';
import { intakeSite, intakeWidget, orderCodeFor, priceCart } from './intake.ts';
import { formatMoney, formatQuantity } from './money.ts';
import { type OrderStatusView, orderStatus } from './order-status.ts';
import { ApiRefusal, type SiteCtx } from './public.ts';
import { formatRef, type JsonCell, type JsonColumn } from './read.ts';
import { askToHoldIn } from './reservations.ts';
import { withTx } from './session.ts';
import { slotsIn } from './slots.ts';
import { addDays, businessDate } from './time.ts';

type Ref = string;
export type MoneyFig = { minor: number; currency: string; ref: Ref };
export type IntFig = { value: number; ref: Ref };
export type Page<T> = { data: T[]; next: string | null };
export type PageQuery = { cursor?: string | undefined; limit?: number | undefined };

// Where each published column's digits or words came from: the book table and the column of the same row holding that
// row's id. "Tap for source" (GET …/refs/…) answers only for a column named here.
export const SITE_SOURCES: Record<string, Record<string, [table: string, idColumn: string]>> = {
  'site.catalogue': {
    item_id: ['books.item', 'item_id'],
    item: ['books.item_revision', 'revision_id'],
    kind: ['books.item', 'item_id'],
    category: ['books.item_revision', 'revision_id'],
    duration_min: ['books.item_revision', 'revision_id'],
    price: ['books.price', 'price_id'],
    price_id: ['books.price', 'price_id'],
    revision_id: ['books.item_revision', 'revision_id'],
    parent_id: ['books.item', 'parent_id'],
    unit: ['books.item', 'item_id'],
    attrs: ['books.item_revision', 'revision_id'],
  },
  'site.packages': {
    plan_id: ['books.package_plan', 'plan_id'],
    item_id: ['books.item', 'item_id'],
    plan: ['books.item_revision', 'revision_id'],
    kind: ['books.package_plan', 'plan_id'],
    price: ['books.price', 'price_id'],
    price_id: ['books.price', 'price_id'],
    value: ['books.package_plan', 'plan_id'],
    validity_days: ['books.package_plan', 'plan_id'],
    revision_id: ['books.item_revision', 'revision_id'],
  },
  'site.package_lines': {
    plan_id: ['books.package_plan', 'plan_id'],
    line_id: ['books.package_plan_line', 'line_id'],
    item_id: ['books.item', 'item_id'],
    item: ['books.item_revision', 'revision_id'],
    sessions: ['books.package_plan_line', 'line_id'],
    revision_id: ['books.item_revision', 'revision_id'],
  },
  'site.offers': Object.fromEntries(
    ['offer_id', 'offer', 'kind', 'percent_bp', 'amount_off', 'scope', 'category', 'min_spend', 'code', 'starts_at', 'ends_at'].map((c) => [c, ['books.offer', 'offer_id']]),
  ) as Record<string, [string, string]>,
  'site.offer_items': {
    offer_id: ['books.offer', 'offer_id'],
    offer_item_id: ['books.offer_item', 'offer_item_id'],
    item_id: ['books.item', 'item_id'],
  },
};

// ---- The release's cells ----

type Snap = { id: string; name: string; columns: JsonColumn[]; rows: JsonCell[][] };

// A read the release published; a release from before the read existed published none of it (an empty list).
async function snap(c: pg.PoolClient, site: SiteCtx, name: string): Promise<Snap> {
  const id = site.release.snapshots[name];
  if (!id) return { id: '', name, columns: [], rows: [] };
  const { rows } = await c.query<{ columns: JsonColumn[]; rows: JsonCell[][] }>('select columns, rows from snap.snapshot where id = $1', [id]);
  const s = rows[0];
  if (!s) throw new ApiRefusal('internal'); // a release's pinned snapshot is always readable (PUB1)
  return { id, name, columns: s.columns, rows: s.rows };
}

const colIndex = (s: Snap, col: string) => s.columns.findIndex((c) => c.n === col);
const cell = (s: Snap, row: number, col: string): JsonCell | undefined => s.rows[row]?.[colIndex(s, col)];
const refOf = (s: Snap, row: number, col: string) => formatRef({ snapshotId: s.id, row, col });

function text(s: Snap, row: number, col: string): string | null {
  const v = cell(s, row, col);
  return v?.k === 'text' ? v.t : null;
}
function money(s: Snap, row: number, col: string): MoneyFig | null {
  const v = cell(s, row, col);
  return v?.k === 'money' ? { minor: Number(v.n), currency: v.c, ref: refOf(s, row, col) } : null;
}
function int(s: Snap, row: number, col: string): IntFig | null {
  const v = cell(s, row, col);
  return v?.k === 'int' ? { value: Number(v.n), ref: refOf(s, row, col) } : null;
}
function at(s: Snap, row: number, col: string): string | null {
  const v = cell(s, row, col);
  return v?.k === 'ts' ? v.a : null;
}
const rowsOf = (s: Snap) => s.rows.map((_, i) => i);

// ---- Cursor pages (§5.4): `next` is the release and the last id given, base64url; a cursor of another release is invalid ----

const DEFAULT_LIMIT = 50;
const cursorOf = (releaseId: string, id: string) => Buffer.from(`${releaseId}.${id}`, 'utf8').toString('base64url');

function paged<T extends { id: string }>(site: SiteCtx, all: T[], q: PageQuery): Page<T> {
  let from = 0;
  if (q.cursor !== undefined) {
    const [release, last] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('.');
    const i = release === site.release.id ? all.findIndex((x) => x.id === last) : -1;
    if (i < 0) throw new ApiRefusal('invalid', ['cursor']);
    from = i + 1;
  }
  const limit = q.limit ?? DEFAULT_LIMIT;
  const data = all.slice(from, from + limit);
  const more = from + limit < all.length;
  return { data, next: more && data.length ? cursorOf(site.release.id, (data[data.length - 1] as T).id) : null };
}

// One transaction under the site's tenant, no actor. withTx turns whatever ends it into a CoreError; a refusal of this
// API's own is kept and rethrown as it was.
async function tx<T>(pub: pg.Pool, site: SiteCtx, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  let refusal: ApiRefusal | undefined;
  try {
    return await withTx(pub, { kind: 'system', tenantId: site.tenantId }, async (c) => {
      try {
        return await fn(c);
      } catch (err) {
        if (err instanceof ApiRefusal) refusal = err;
        throw err;
      }
    });
  } catch (err) {
    throw refusal ?? err;
  }
}

// ---- GET /sites/{slug} ----

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const clock = (t: string | null) => (t === null ? null : t.slice(0, 5));
const mediaPath = (site: SiteCtx, id: string, ext: 'jpg' | 'svg') => `/api/v1/sites/${site.slug}/media/${id}.${ext}`;

export async function siteView(pub: pg.Pool, site: SiteCtx) {
  return tx(pub, site, async (c) => {
    const today = businessDate(new Date(), site.timeZone);
    const { rows: shops } = await c.query<{ id: string; name: string; area: string | null }>('select id::text as id, name, area from ops.shop order by name, id');
    const { rows: hours } = await c.query<{ shop_id: string; weekday: number; opens: string | null; closes: string | null; closed: boolean }>(
      `select distinct on (h.shop_id, h.weekday) h.shop_id::text as shop_id, h.weekday, h.opens::text as opens, h.closes::text as closes, h.closed
         from ops.shop_hours h where h.effective_from <= $1::date
        order by h.shop_id, h.weekday, h.effective_from desc, h.created_at desc, h.id desc`,
      [today],
    );
    const { rows: looks } = await c.query<{ tokens: unknown; font_pair: string; profile: unknown; art: Record<string, string> }>(
      'select tokens, font_pair, profile, art from ops.site_look where id = $1',
      [site.release.lookId],
    );
    const look = looks[0];
    if (!look) throw new ApiRefusal('internal');
    return {
      slug: site.slug,
      name: site.name,
      businessType: site.businessType,
      dataClass: site.dataClass,
      // Simulated means labelled: every site that is not a live shop's says so.
      label: site.dataClass === 'live' ? null : ('Sample site' as const),
      shops: shops.map((s) => ({
        id: s.id,
        name: s.name,
        area: s.area,
        hours: hours
          .filter((h) => h.shop_id === s.id)
          .map((h) => ({ day: DAYS[h.weekday - 1] as (typeof DAYS)[number], closed: h.closed, opens: h.closed ? null : clock(h.opens), closes: h.closed ? null : clock(h.closes) })),
      })),
      bookingMode: site.bookingMode,
      intake: site.intake,
      noticeVersion: site.noticeVersion,
      consentVersion: site.consentVersion,
      look: {
        tokens: look.tokens,
        fontPair: look.font_pair,
        profile: look.profile,
        art: Object.fromEntries(Object.entries(look.art).map(([slot, id]) => [slot, mediaPath(site, id, 'svg')])),
      },
      release: { id: site.release.id, publishedAt: site.release.publishedAt },
    };
  });
}

// ---- GET /sites/{slug}/catalogue and /services ----

export async function catalogueView(pub: pg.Pool, site: SiteCtx, q: PageQuery & { category?: string | undefined }) {
  return tx(pub, site, async (c) => {
    const s = await snap(c, site, 'site.catalogue');
    const { rows: held } = await c.query<{ item_id: string }>(`select distinct item_id::text as item_id from ops.reservation where state = 'held' and held_until > now()`);
    const heldIds = new Set(held.map((h) => h.item_id));
    type Item = { id: string; name: string; category: string | null; variants: unknown[] };
    const items = new Map<string, Item>();
    for (const i of rowsOf(s)) {
      const id = text(s, i, 'item_id');
      const price = money(s, i, 'price');
      if (text(s, i, 'kind') !== 'good' || !id || !price) continue;
      const parent = text(s, i, 'parent_id');
      const group = parent ?? id;
      const category = text(s, i, 'category');
      if (q.category !== undefined && category !== q.category) continue;
      let item = items.get(group);
      if (!item) {
        item = { id: group, name: (parent ? text(s, i, 'parent') : null) ?? (text(s, i, 'item') as string), category, variants: [] };
        items.set(group, item);
      }
      let attrs: Record<string, string> = {};
      try {
        attrs = JSON.parse(text(s, i, 'attrs') ?? '{}') as Record<string, string>;
      } catch {
        attrs = {};
      }
      if (item.variants.length < 100) item.variants.push({ id, name: text(s, i, 'item') as string, attrs, unit: text(s, i, 'unit') ?? 'piece', price, held: heldIds.has(id) });
    }
    return paged(site, [...items.values()], q);
  });
}

export async function servicesView(pub: pg.Pool, site: SiteCtx, q: PageQuery) {
  return tx(pub, site, async (c) => {
    const s = await snap(c, site, 'site.catalogue');
    const { rows: shops } = await c.query<{ id: string }>('select id::text as id from ops.shop order by name, id limit 20');
    const shopIds = shops.map((r) => r.id);
    const all = rowsOf(s).flatMap((i) => {
      const id = text(s, i, 'item_id');
      const price = money(s, i, 'price');
      const duration = int(s, i, 'duration_min');
      if (text(s, i, 'kind') !== 'service' || !id || !price || !duration) return [];
      // Every branch offers the menu: the books keep no per-branch service list.
      return [{ id, name: text(s, i, 'item') as string, category: text(s, i, 'category'), duration, price, shopIds }];
    });
    return paged(site, all, q);
  });
}

// ---- GET /sites/{slug}/packages and /offers ----

export async function packagesView(pub: pg.Pool, site: SiteCtx, q: PageQuery) {
  return tx(pub, site, async (c) => {
    const s = await snap(c, site, 'site.packages');
    const l = await snap(c, site, 'site.package_lines');
    const all = rowsOf(s).flatMap((i) => {
      const id = text(s, i, 'plan_id');
      const itemId = text(s, i, 'item_id');
      const price = money(s, i, 'price');
      const validityDays = int(s, i, 'validity_days');
      const kind = text(s, i, 'kind');
      if (!id || !itemId || !price || !validityDays || (kind !== 'sessions' && kind !== 'value')) return [];
      const lines = rowsOf(l).flatMap((j) => {
        const serviceId = text(l, j, 'item_id');
        const sessions = int(l, j, 'sessions');
        return text(l, j, 'plan_id') === id && serviceId && sessions ? [{ serviceId, name: text(l, j, 'item') as string, sessions }] : [];
      });
      return [{ id, itemId, name: text(s, i, 'plan') as string, kind, price, value: money(s, i, 'value'), validityDays, lines }];
    });
    return paged(site, all, q);
  });
}

export async function offersView(pub: pg.Pool, site: SiteCtx, q: PageQuery) {
  return tx(pub, site, async (c) => {
    const s = await snap(c, site, 'site.offers');
    const items = await snap(c, site, 'site.offer_items');
    const { rows: clock } = await c.query<{ now: Date }>('select now() as now');
    const now = (clock[0] as { now: Date }).now;
    const all = rowsOf(s).flatMap((i): ({ id: string } & Record<string, unknown>)[] => {
      const id = text(s, i, 'offer_id');
      const startsAt = at(s, i, 'starts_at');
      const endsAt = at(s, i, 'ends_at');
      const scope = text(s, i, 'scope');
      // Still in effect now: an offer the release published that has since ended is not shown.
      if (!id || !startsAt || !endsAt || new Date(endsAt) <= now || (scope !== 'all' && scope !== 'category' && scope !== 'items')) return [];
      const fields = {
        id,
        name: text(s, i, 'offer') as string,
        scope,
        category: text(s, i, 'category'),
        itemIds: rowsOf(items).flatMap((j) => (text(items, j, 'offer_id') === id ? [text(items, j, 'item_id') as string] : [])).slice(0, 100),
        minSpend: money(s, i, 'min_spend'),
        code: text(s, i, 'code'),
        startsAt,
        endsAt,
      };
      const kind = text(s, i, 'kind');
      const percentBp = int(s, i, 'percent_bp');
      const amountOff = money(s, i, 'amount_off');
      if (kind === 'percent_off' && percentBp) return [{ ...fields, kind, percentBp }];
      if (kind === 'amount_off' && amountOff) return [{ ...fields, kind, amountOff }];
      return [];
    });
    return paged(site, all, q);
  });
}

// ---- GET /sites/{slug}/stylists and /slots ----

export async function stylistsView(pub: pg.Pool, site: SiteCtx, q: PageQuery & { shop?: string | undefined }) {
  return tx(pub, site, async (c) => {
    // The public role reads only shown, unerased profiles (staff_shown).
    const { rows } = await c.query<{ id: string; shop_id: string; display_name: string; blurb: string | null; art: string | null }>(
      `select staff_id::text as id, shop_id::text as shop_id, display_name, blurb, art_document_id::text as art
         from ops.staff_public where ($1::uuid is null or shop_id = $1::uuid) order by display_name, staff_id, id`,
      [q.shop ?? null],
    );
    const all = rows.map((r) => ({ id: r.id, shopId: r.shop_id, displayName: r.display_name, blurb: r.blurb, artUrl: r.art ? mediaPath(site, r.art, 'svg') : null }));
    return paged(site, all, q);
  });
}

// A day between today and 60 days on, in the shop's own zone (§5.8).
function withinWindow(site: SiteCtx, day: string): boolean {
  const today = businessDate(new Date(), site.timeZone);
  return day >= today && day <= addDays(today, 60);
}

export async function slotsView(pub: pg.Pool, site: SiteCtx, q: { shop: string; service: string; date: string; stylist?: string | undefined }) {
  if (site.bookingMode !== 'slots') throw new ApiRefusal('not_found');
  if (!withinWindow(site, q.date)) throw new ApiRefusal('invalid', ['date']);
  return tx(pub, site, async (c) => {
    const slots = await slotsIn(c, { shopId: q.shop, serviceItemId: q.service, day: q.date, ...(q.stylist ? { staffId: q.stylist } : {}) }).catch(coreToApi);
    return {
      date: q.date,
      shopId: q.shop,
      serviceId: q.service,
      slots: slots.slice(0, 2000).map((x) => ({ stylistId: x.staffId, start: x.start.toISOString(), shiftRel: x.shiftRel, shiftId: x.shiftId })),
    };
  });
}

// ---- GET /sites/{slug}/media/{id}.(jpg|svg): the document's record; the bytes are the media store's ----

export type MediaDoc = { id: string; mime: 'image/jpeg' | 'image/svg+xml'; storageKey: string; sha256: Buffer; bytes: number };

export async function mediaDocument(pub: pg.Pool, site: SiteCtx, id: string, ext: 'jpg' | 'svg'): Promise<MediaDoc | null> {
  const [kind, mime] = ext === 'jpg' ? ['card', 'image/jpeg'] : ['art', 'image/svg+xml'];
  return tx(pub, site, async (c) => {
    // document_public: only an unerased card or art document that a published release's look names.
    const { rows } = await c.query<{ storage_key: string | null; sha256: Buffer; bytes: number }>(
      'select storage_key, sha256, bytes from ops.document where id = $1 and kind = $2 and mime = $3 and erased_at is null',
      [id, kind, mime],
    );
    const r = rows[0];
    return r?.storage_key ? { id, mime: mime as MediaDoc['mime'], storageKey: r.storage_key, sha256: r.sha256, bytes: r.bytes } : null;
  });
}

// ---- GET /sites/{slug}/refs/{snapshot}/{row}/{col}: "tap for source" ----

const UNVERIFIED = { verified: false as const, label: 'Cannot verify' as const };

export async function refView(pub: pg.Pool, site: SiteCtx, ref: { snapshot: string; row: number; col: string }) {
  // Only a snapshot of the latest release: an older one's figure may no longer be the shop's.
  const name = Object.entries(site.release.snapshots).find(([, id]) => id === ref.snapshot)?.[0];
  const source = name ? SITE_SOURCES[name]?.[ref.col] : undefined;
  if (!name || !source) return UNVERIFIED;
  return tx(pub, site, async (c) => {
    const s = await snap(c, site, name);
    const v = cell(s, ref.row, ref.col);
    const id = text(s, ref.row, source[1]);
    const r = formatRef({ snapshotId: s.id, row: ref.row, col: ref.col });
    const published =
      v?.k === 'money'
        ? { minor: Number(v.n), currency: v.c, ref: r }
        : v?.k === 'int'
          ? { value: Number(v.n), ref: r }
          : v?.k === 'text' && v.t.length <= 500
            ? { text: v.t, ref: r }
            : v?.k === 'date'
              ? { date: v.d, ref: r }
              : v?.k === 'ts'
                ? { at: v.a, ref: r }
                : null;
    if (!published || !id) return UNVERIFIED;
    return { verified: true as const, cell: published, source: { table: source[0], id }, publishedAt: site.release.publishedAt };
  });
}

// ---- GET /sites/{slug}/orders/{code} ----

// The code is looked up by the database under its own policy, the same two reads for a code that exists and one that
// does not; the answer is padded to a floor so a miss and a hit take alike. The code is never compared here or logged.
const STATUS_FLOOR_MS = 40;

export async function orderStatusView(pub: pg.Pool, site: SiteCtx, code: string): Promise<OrderStatusView | null> {
  const started = Date.now();
  const view = await orderStatus(pub, site.tenantId, code);
  const wait = STATUS_FLOOR_MS - (Date.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return view;
}

// ---- Writes ----

const sha = (command: string, request: unknown) => createHash('sha256').update(canonical({ command, request })).digest();
const scopeOf = (site: SiteCtx) => `site:${site.siteId}`;
type Ids = Record<string, string>;

/**
 * Before the bot check: the ids a first request under this key stored, for a replay; null for a key not yet used (or
 * still in flight). A different request under the key is idempotency_mismatch.
 */
export async function storedIds(pub: pg.Pool, site: SiteCtx, key: string, command: string, request: unknown): Promise<Ids | null> {
  const { rows } = await tx(pub, site, (c) =>
    c.query<{ command: string; request_sha256: Buffer; result: Ids | null }>('select command, request_sha256, result from ops.idempotency where scope = $1 and key = $2', [
      scopeOf(site),
      key,
    ]),
  );
  const prior = rows[0];
  if (!prior) return null;
  if (prior.command !== command || !prior.request_sha256.equals(sha(command, request))) throw new ApiRefusal('idempotency_mismatch', ['Idempotency-Key']);
  return prior.result;
}

// In the write's own transaction: a fresh key proceeds (fill stores the ids); one a concurrent first request holds waits
// on the key's primary key, then answers from that request's ids.
async function claim(c: pg.PoolClient, site: SiteCtx, key: string, command: string, request: unknown): Promise<{ replay: Ids } | { fill: (ids: Ids) => Promise<void> }> {
  const hash = sha(command, request);
  const claimed = await c.query(
    `insert into ops.idempotency (tenant_id, scope, key, command, request_sha256)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4) on conflict do nothing`,
    [scopeOf(site), key, command, hash],
  );
  if (claimed.rowCount === 1) {
    return { fill: async (ids) => void (await c.query('update ops.idempotency set result = $1 where scope = $2 and key = $3', [ids, scopeOf(site), key])) };
  }
  const { rows } = await c.query<{ command: string; request_sha256: Buffer; result: Ids | null }>(
    'select command, request_sha256, result from ops.idempotency where scope = $1 and key = $2',
    [scopeOf(site), key],
  );
  const prior = rows[0];
  if (!prior?.result || prior.command !== command || !prior.request_sha256.equals(hash)) throw new ApiRefusal('idempotency_mismatch', ['Idempotency-Key']);
  return { replay: prior.result };
}

type Write<A> = { key: string; command: string; request: unknown; run: (c: pg.PoolClient) => Promise<{ ids: Ids; answer: A }>; again: (c: pg.PoolClient, ids: Ids) => Promise<A> };

async function once<A>(pub: pg.Pool, site: SiteCtx, w: Write<A>): Promise<{ answer: A; replayed: boolean }> {
  return tx(pub, site, async (c) => {
    const k = await claim(c, site, w.key, w.command, w.request);
    if ('replay' in k) return { answer: await w.again(c, k.replay), replayed: true };
    const { ids, answer } = await w.run(c);
    await k.fill(ids);
    return { answer, replayed: false };
  }).catch(coreToApi);
}

/** A replay outside a write: the first answer, again, from the ids it stored. */
async function replayIn<A>(pub: pg.Pool, site: SiteCtx, ids: Ids, again: (c: pg.PoolClient, ids: Ids) => Promise<A>): Promise<A> {
  return tx(pub, site, (c) => again(c, ids)).catch(coreToApi);
}

// A core refusal as the API's code. The writes below map what they can tell apart first; this is the rest.
function coreToApi(err: unknown): never {
  if (err instanceof ApiRefusal) throw err;
  const e = toCoreError(err);
  if (e.code === 'not_found') throw new ApiRefusal('not_found');
  if (e.code === 'invalid' || e.code === 'refused' || e.code === 'conflict') throw new ApiRefusal('invalid', e.fields ?? []);
  throw new ApiRefusal('internal');
}

const SAMPLE_PHONE = '+910000000000';

// A phone as E.164 (spaces, brackets and dashes dropped), or invalid. On a demo deployment the database stores only the
// sample number, so the API stores it in place of any other (S10); the name is pinned to the sample by the database.
function phoneOf(site: SiteCtx, raw: string): string {
  const digits = raw.replace(/[\s()-]/g, '');
  const e164 = /^\+?[1-9][0-9]{7,14}$/.test(digits) ? (digits.startsWith('+') ? digits : `+${digits}`) : null;
  if (!e164) throw new ApiRefusal('invalid', ['phone']);
  return site.live ? e164 : SAMPLE_PHONE;
}

function versionsCurrent(site: SiteCtx, b: { noticeVersion: string; consentVersion: string }): void {
  if (b.noticeVersion !== site.noticeVersion || b.consentVersion !== site.consentVersion) throw new ApiRefusal('stale_notice', ['noticeVersion', 'consentVersion']);
}

function intakeOpen(site: SiteCtx): void {
  if (site.intake !== 'open') throw new ApiRefusal('intake_paused');
}

// A capability as the release published it; off, its routes are not there (404).
async function capabilityOn(c: pg.PoolClient, site: SiteCtx, capability: string): Promise<boolean> {
  const s = await snap(c, site, 'site.capabilities');
  return rowsOf(s).some((i) => text(s, i, 'capability') === capability && text(s, i, 'state') === 'on');
}

async function catalogueKind(c: pg.PoolClient, site: SiteCtx, itemId: string): Promise<string | null> {
  const s = await snap(c, site, 'site.catalogue');
  const i = rowsOf(s).find((r) => text(s, r, 'item_id') === itemId);
  return i === undefined ? null : text(s, i, 'kind');
}

// -- POST /holds and DELETE /holds/{id} --

export type HoldBody = { shopId: string; stylistId: string; serviceId: string; start: string; shiftRel: 'books.shift_pattern' | 'books.shift_change'; shiftId: string };
export type HoldMeta = { key: string; ipHash: Buffer; deviceHash: Buffer; holdToken: string; before?: () => Promise<void> };

async function holdAgain(c: pg.PoolClient, ids: Ids, holdToken: string) {
  const { rows } = await c.query<{ expires_at: Date }>('select expires_at from ops.booking where id = $1', [ids.hold]);
  const r = rows[0];
  if (!r) throw new ApiRefusal('not_found');
  return { holdId: ids.hold as string, holdToken, expiresAt: r.expires_at.toISOString() };
}

export async function placeSiteHold(pub: pg.Pool, site: SiteCtx, body: HoldBody, meta: HoldMeta) {
  const request = { body, device: meta.deviceHash.toString('hex') };
  const again = (c: pg.PoolClient, ids: Ids) => holdAgain(c, ids, meta.holdToken);
  const prior = await storedIds(pub, site, meta.key, 'site.hold', request);
  if (prior) return { answer: await replayIn(pub, site, prior, again), replayed: true };
  await meta.before?.();
  if (site.bookingMode !== 'slots') throw new ApiRefusal('not_found');
  intakeOpen(site);
  return once(pub, site, {
    key: meta.key,
    command: 'site.hold',
    request,
    again,
    run: async (c) => {
      // The caps the database holds (HOLD1), counted first so a refusal can say which: three live holds per network, two
      // on one stylist's day. A race past this count is still refused by booking_flow, as invalid.
      const { rows } = await c.query<{ ip: number; day: number }>(
        `select (select count(*) from ops.booking b where b.ip_hash = $1 and b.state = 'held' and b.expires_at > now())::int as ip,
                (select count(*) from ops.booking b cross join ops.tenant t
                  where b.staff_id = $2 and b.state = 'held' and b.expires_at > now()
                    and (lower(b.during) at time zone t.time_zone)::date = ($3::timestamptz at time zone t.time_zone)::date)::int as day`,
        [meta.ipHash, body.stylistId, body.start],
      );
      const caps = rows[0] as { ip: number; day: number };
      if (caps.ip >= 3 || caps.day >= 2) throw new ApiRefusal('hold_limit');
      try {
        const made = await placeHoldIn(
          c,
          {
            shopId: body.shopId,
            staffId: body.stylistId,
            serviceItemId: body.serviceId,
            start: body.start,
            shiftRel: body.shiftRel,
            shiftId: body.shiftId,
            ipHash: meta.ipHash.toString('hex'),
            deviceHash: meta.deviceHash.toString('hex'),
          },
          meta.holdToken,
        );
        return { ids: { hold: made.holdId }, answer: { holdId: made.holdId, holdToken: made.holdToken, expiresAt: made.expiresAt.toISOString() } };
      } catch (err) {
        const e = toCoreError(err);
        if (e?.sqlstate === '23P01') throw new ApiRefusal('slot_taken');
        if (e?.sqlstate === '23505' && e.constraint === 'one_hold_per_device') throw new ApiRefusal('hold_limit');
        throw err;
      }
    },
  });
}

export async function releaseSiteHold(pub: pg.Pool, site: SiteCtx, holdId: string, meta: { key: string; holdToken: string; before?: () => Promise<void> }) {
  const request = { holdId, token: createHash('sha256').update(meta.holdToken).digest('hex') };
  const again = async (_c: pg.PoolClient, ids: Ids) => ({ holdId: ids.hold as string, released: true as const });
  const prior = await storedIds(pub, site, meta.key, 'site.hold_release', request);
  if (prior) return { answer: await replayIn(pub, site, prior, again), replayed: true };
  await meta.before?.();
  return once(pub, site, {
    key: meta.key,
    command: 'site.hold_release',
    request,
    again,
    run: async (c) => {
      // A wrong token moves nothing (booking_flow compares its sha256): the hold is not found, as an unknown one.
      const made = await releaseHoldIn(c, { holdId, holdToken: meta.holdToken }).catch((err: unknown) => {
        throw toCoreError(err).code !== 'internal' ? new ApiRefusal('not_found') : err;
      });
      return { ids: { hold: made.holdId }, answer: { holdId: made.holdId, released: true as const } };
    },
  });
}

// -- POST /bookings --

export type BookingBody = {
  holdId: string;
  holdToken: string;
  name: string;
  phone: string;
  note?: string | undefined;
  whatsappUpdates: boolean;
  noticeVersion: string;
  consentVersion: string;
};
// `before` runs once a request is known not to be a replay, before it writes: the route's bot check.
type Meta = { key: string; ipHash: Buffer; before?: () => Promise<void> };
const received = async (_c: pg.PoolClient, ids: Ids) => ({ id: ids.id as string, received: true as const });

export async function bookSite(pub: pg.Pool, site: SiteCtx, body: BookingBody, meta: Meta) {
  const prior = await storedIds(pub, site, meta.key, 'site.booking', body);
  if (prior) return { answer: await replayIn(pub, site, prior, received), replayed: true };
  await meta.before?.();
  intakeOpen(site);
  versionsCurrent(site, body);
  const phone = phoneOf(site, body.phone);
  return once(pub, site, {
    key: meta.key,
    command: 'site.booking',
    request: body,
    again: received,
    run: async (c) => {
      const made = await requestBookingIn(c, site.tenantId, {
        holdId: body.holdId,
        holdToken: body.holdToken,
        name: body.name,
        phone,
        ...(body.note ? { note: body.note } : {}),
        waUpdates: body.whatsappUpdates,
        noticeVersion: body.noticeVersion,
        consentVersion: body.consentVersion,
        ipHash: meta.ipHash.toString('hex'),
      }).catch((err: unknown) => {
        // An unknown hold, a wrong token (MS018) and a lapsed hold (MS015) are all a hold this request cannot use.
        const e = toCoreError(err);
        throw e && (e.code === 'not_found' || e.sqlstate === 'MS018' || e.sqlstate === 'MS015') ? new ApiRefusal('not_found') : err;
      });
      return { ids: { id: made.bookingId }, answer: { id: made.bookingId, received: true as const } };
    },
  });
}

// -- POST /booking-requests and /enquiries: one ops.site_request each --

export type BookingRequestBody = {
  shopId: string;
  name: string;
  phone: string;
  serviceIds: string[];
  preferredOn: string;
  timeWindow: 'morning' | 'afternoon' | 'evening';
  note?: string | undefined;
  whatsappUpdates: boolean;
  noticeVersion: string;
  consentVersion: string;
};
export type EnquiryBody = {
  shopId: string;
  name: string;
  phone: string;
  itemId?: string | undefined;
  message: string;
  whatsappUpdates: boolean;
  noticeVersion: string;
  consentVersion: string;
};

async function insertRequest(
  c: pg.PoolClient,
  site: SiteCtx,
  r: { kind: 'enquiry' | 'booking_request'; shopId: string; name: string; phone: string; itemIds: string[]; preferredOn: string | null; timeWindow: string | null; note: string | null; waUpdates: boolean; noticeVersion: string; consentVersion: string; ipHash: Buffer },
): Promise<string> {
  // The public role cannot read a request back: the id is made here.
  const id = randomUUID();
  await c.query(
    `insert into ops.site_request (tenant_id, id, site_id, shop_id, kind, source, contact_name, contact_phone_e164, item_ids, preferred_on, time_window, note,
                                   wa_updates, notice_version, consent_version, ip_hash)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, 'site', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [id, site.siteId, r.shopId, r.kind, r.name, r.phone, r.itemIds, r.preferredOn, r.timeWindow, r.note, r.waUpdates, r.noticeVersion, r.consentVersion, r.ipHash],
  );
  return id;
}

// A branch of another tenant (or none) is not this site's: the request's key to ops.shop refuses it (23503).
const shopRefused = (err: unknown): never => {
  throw toCoreError(err).sqlstate === '23503' ? new ApiRefusal('invalid', ['shopId']) : err;
};

export async function requestSiteBooking(pub: pg.Pool, site: SiteCtx, body: BookingRequestBody, meta: Meta) {
  const prior = await storedIds(pub, site, meta.key, 'site.booking_request', body);
  if (prior) return { answer: await replayIn(pub, site, prior, received), replayed: true };
  await meta.before?.();
  if (site.bookingMode !== 'request') throw new ApiRefusal('not_found');
  intakeOpen(site);
  versionsCurrent(site, body);
  const phone = phoneOf(site, body.phone);
  if (!withinWindow(site, body.preferredOn)) throw new ApiRefusal('invalid', ['preferredOn']);
  return once(pub, site, {
    key: meta.key,
    command: 'site.booking_request',
    request: body,
    again: received,
    run: async (c) => {
      for (const [n, serviceId] of body.serviceIds.entries()) {
        if ((await catalogueKind(c, site, serviceId)) !== 'service') throw new ApiRefusal('invalid', [`serviceIds.${n}`]);
      }
      const id = await insertRequest(c, site, {
        kind: 'booking_request',
        shopId: body.shopId,
        name: body.name,
        phone,
        itemIds: [...new Set(body.serviceIds)],
        preferredOn: body.preferredOn,
        timeWindow: body.timeWindow,
        note: body.note ?? null,
        waUpdates: body.whatsappUpdates,
        noticeVersion: body.noticeVersion,
        consentVersion: body.consentVersion,
        ipHash: meta.ipHash,
      }).catch(shopRefused);
      return { ids: { id }, answer: { id, received: true as const } };
    },
  });
}

export async function enquireSite(pub: pg.Pool, site: SiteCtx, body: EnquiryBody, meta: Meta) {
  const prior = await storedIds(pub, site, meta.key, 'site.enquiry', body);
  if (prior) return { answer: await replayIn(pub, site, prior, received), replayed: true };
  await meta.before?.();
  intakeOpen(site);
  versionsCurrent(site, body);
  const phone = phoneOf(site, body.phone);
  return once(pub, site, {
    key: meta.key,
    command: 'site.enquiry',
    request: body,
    again: received,
    run: async (c) => {
      if (body.itemId !== undefined && (await catalogueKind(c, site, body.itemId)) === null) throw new ApiRefusal('invalid', ['itemId']);
      const id = await insertRequest(c, site, {
        kind: 'enquiry',
        shopId: body.shopId,
        name: body.name,
        phone,
        itemIds: body.itemId ? [body.itemId] : [],
        preferredOn: null,
        timeWindow: null,
        note: body.message,
        waUpdates: body.whatsappUpdates,
        noticeVersion: body.noticeVersion,
        consentVersion: body.consentVersion,
        ipHash: meta.ipHash,
      }).catch(shopRefused);
      return { ids: { id }, answer: { id, received: true as const } };
    },
  });
}

// -- POST /reservations: hold a piece (ops.reservation, requested) --

export type ReservationBody = { itemId: string; qtyMilli: number; name: string; phone: string; note?: string | undefined; noticeVersion: string; consentVersion: string };

export async function reserveSite(pub: pg.Pool, site: SiteCtx, body: ReservationBody, meta: Meta) {
  const prior = await storedIds(pub, site, meta.key, 'site.reservation', body);
  if (prior) return { answer: await replayIn(pub, site, prior, received), replayed: true };
  await meta.before?.();
  intakeOpen(site);
  versionsCurrent(site, body);
  const phone = phoneOf(site, body.phone);
  return once(pub, site, {
    key: meta.key,
    command: 'site.reservation',
    request: body,
    again: received,
    run: async (c) => {
      if (!(await capabilityOn(c, site, 'holds'))) throw new ApiRefusal('not_found');
      if ((await catalogueKind(c, site, body.itemId)) !== 'good') throw new ApiRefusal('invalid', ['itemId']);
      const id = await askToHoldIn(c, site.tenantId, {
        siteId: site.siteId,
        itemId: body.itemId,
        qtyMilli: body.qtyMilli,
        name: body.name,
        phone,
        ...(body.note ? { note: body.note } : {}),
        noticeVersion: body.noticeVersion,
        consentVersion: body.consentVersion,
        ipHash: meta.ipHash.toString('hex'),
      }).catch((err: unknown) => {
        // Three live pieces per network (D-055): the limit, not the request, is at fault.
        throw toCoreError(err).sqlstate === 'MS015' ? new ApiRefusal('rate_limited', [], 600) : err;
      });
      return { ids: { id }, answer: { id, received: true as const } };
    },
  });
}

// -- POST /orders: a cart priced from the release (§8.5), and GET /orders/{code} above --

export type OrderBody = { shopId: string; channel: 'site' | 'widget'; lines: { itemId: string; qtyMilli: number }[]; offerCode?: string | undefined };

async function orderAnswer(c: pg.PoolClient, site: SiteCtx, body: OrderBody, requestId: string, releaseId: string) {
  const figures = await priceCart(c, releaseId, body.lines);
  const code = orderCodeFor(requestId);
  const s = await snap(c, site, 'site.catalogue');
  const named = (itemId: string) => {
    const i = rowsOf(s).find((r) => text(s, r, 'item_id') === itemId);
    return i === undefined ? { name: 'Item', unit: 'piece' } : { name: text(s, i, 'item') ?? 'Item', unit: text(s, i, 'unit') ?? 'piece' };
  };
  // Composed by code from the figures above, never by a model.
  const message = [
    `Order ${code} · ${site.name}`,
    ...figures.lines.map((l) => {
      const it = named(l.itemId);
      return `${it.name} × ${formatQuantity(l.qty.qtyMilli, it.unit)} = ${formatMoney(l.amount)}`;
    }),
    `Total ${formatMoney(figures.total)} at today's prices · the shop confirms`,
    ...(body.offerCode ? [`Offer code ${body.offerCode}: to be checked at the shop`] : []),
  ].join('\n');
  return { code, lines: figures.lines, total: figures.total, offerCode: body.offerCode ?? null, message, waLink: null };
}

export async function orderSite(pub: pg.Pool, site: SiteCtx, body: OrderBody, meta: Meta) {
  const again = (c: pg.PoolClient, ids: Ids) => orderAnswer(c, site, body, ids.request as string, ids.release as string);
  const prior = await storedIds(pub, site, meta.key, 'site.order', body);
  if (prior) return { answer: await replayIn(pub, site, prior, again), replayed: true };
  await meta.before?.();
  intakeOpen(site);
  return once(pub, site, {
    key: meta.key,
    command: 'site.order',
    request: body,
    again,
    run: async (c) => {
      if (!(await capabilityOn(c, site, 'orders'))) throw new ApiRefusal('not_found');
      const intake = body.channel === 'widget' ? intakeWidget : intakeSite;
      const made = await intake(c, { shopId: body.shopId, lines: body.lines }).catch((err: unknown) => {
        const e = toCoreError(err);
        if (e?.sqlstate === '23503') throw new ApiRefusal('invalid', ['shopId']);
        // order_request_flow: a line that is not a good of this shop on sale
        if (e?.sqlstate?.startsWith('MS')) throw new ApiRefusal('invalid', ['lines']);
        throw err;
      });
      return { ids: { request: made.requestId, release: made.releaseId }, answer: await orderAnswer(c, site, body, made.requestId, made.releaseId) };
    },
  });
}
