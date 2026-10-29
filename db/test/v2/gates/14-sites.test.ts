// 14_sites_public.sql: BK1 (no two live bookings of a stylist overlap; an expired hold frees its slot), BK2 (the
// calendar: the roster row in effect, leave, holidays, shop hours, the service's length), HOLD1 (the hold caps and the
// token), PUB1's 14 part (what the public reads), S1/S2 (keys, origins, the bookings switch), S9 (releases), S10 (demo
// samples, versions, intake), the look's CSS fence, and the request, booking and reservation flows by role (ROLE1).
// Red-proofs: test/v2/sabotage/sites.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { BOOKING_DAY, type Books, COLUMNS, type Filled, fillTenant, plantProbeCommand, rowsOf, sha, signUp } from './fixture.ts';
import { asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let f: Filled & Books;
let other: Filled & Books;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let stylist2: string;
let pattern2: string;

const owner = () => ({ tenant_id: f.tenant, actor_id: f.owner });
const one = async (c: pg.PoolClient, sql: string, params: unknown[]) => (await c.query<{ id: string }>(sql, params)).rows[0]?.id as string;
const day = (weeks: number) => `(${BOOKING_DAY} + ${7 * weeks})`;
const at = (weeks: number, from: string, to: string) =>
  `tstzrange((${day(weeks)} + time '${from}') at time zone 'Asia/Kolkata', (${day(weeks)} + time '${to}') at time zone 'Asia/Kolkata', '[)')`;

type Shape = { name: string; sql: string; params: () => unknown[]; own: string; ownActor: boolean; wrong: [string, boolean, string][] };
type Hold = { weeks?: number; from: string; to: string; staff?: string; pattern?: string; change?: string; ip?: Buffer; device?: Buffer };
async function hold(h: Hold): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString('base64url');
  const id = await tx(pub, { tenant_id: f.tenant }, (c) =>
    one(
      c,
      `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash,
                                shift_pattern_id, shift_change_id)
       values ($1, $2, $3, $4, $5, ${at(h.weeks ?? 1, h.from, h.to)}, 'held', 'site', $6, $7, $8, $9, $10) returning id`,
      [f.tenant, f.site, f.shop, h.staff ?? f.staffRow, f.service, sha(token), h.ip ?? sha(randomUUID()), h.device ?? sha(randomUUID()),
        h.change ? null : (h.pattern ?? f.pattern), h.change ?? null],
    ),
  );
  return { id, token };
}
const move = (id: string, state: string, ctx: Record<string, string> = {}, pool = pub) =>
  tx(pool, { tenant_id: f.tenant, ...ctx }, (c) => c.query(`update ops.booking set state = $2 where tenant_id = $1 and id = $3`, [f.tenant, state, id]));
const command = <T>(name: string, fn: (c: pg.PoolClient) => Promise<T>) => tx(app, { ...owner(), command: name }, fn);

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = db.as('munshi_jobs');
  f = await fillTenant(db, await signUp(db, 'site-shop', { type: 'salon' }));
  other = await fillTenant(db, await signUp(db, 'site-other', { type: 'salon' }));
  // A second stylist on a wider roster (08:00–22:00 on Mondays), so a slot inside the shift but outside the shop's hours exists.
  ({ stylist2, pattern2 } = await command('staff.create', async (c) => {
    const s = await one(c, 'insert into books.staff (tenant_id) values ($1) returning id', [f.tenant]);
    await c.query(`insert into books.staff_terms (tenant_id, staff_id, shop_id, pay_kind, pay_minor, currency, effective_from) values ($1, $2, $3, 'daily', 1, 'INR', current_date)`, [
      f.tenant,
      s,
      f.shop,
    ]);
    return { stylist2: s, pattern2: '' };
  }));
  pattern2 = await command('shift.pattern.set', (c) =>
    one(c, `insert into books.shift_pattern (tenant_id, staff_id, shop_id, weekday, starts, ends, effective_from) values ($1, $2, $3, 1, '08:00', '22:00', current_date - 7) returning id`, [
      f.tenant,
      stylist2,
      f.shop,
    ]),
  );
  await db.sabotage();
});
afterAll(() => db?.close());

it('BK1 two live bookings of one stylist never overlap; another stylist may take the same time; an expired hold frees its slot', async () => {
  // The fixture's requested booking holds 10:00–10:30 on the booking day.
  const taken = await refused(hold({ weeks: 0, from: '10:15', to: '10:45' }));
  expect(taken.code).toBe('23P01');
  await hold({ weeks: 0, from: '10:00', to: '10:30', staff: stylist2, pattern: pattern2 });
  const h = await hold({ weeks: 0, from: '12:00', to: '12:30' });
  expect((await refused(hold({ weeks: 0, from: '12:00', to: '12:30' }))).code).toBe('23P01');
  expect((await refused(move(h.id, 'expired'))).code).toBe('MS015'); // not yet past expires_at
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [h.id]);
  await move(h.id, 'expired', {}, jobs);
  await hold({ weeks: 0, from: '12:00', to: '12:30' });
});

it('BK2 a booking fits the calendar: its named roster row in effect that day, no leave, no holiday, inside the shop’s hours, the service’s length', async () => {
  const outside = /outside the calendar/;
  await hold({ weeks: 1, from: '15:00', to: '15:30' }); // the slot that passes
  const refusals: [string, Hold][] = [
    ['past the end of the shift', { weeks: 1, from: '20:45', to: '21:15' }],
    ['inside the shift, outside the shop’s hours', { weeks: 1, from: '08:15', to: '08:45', staff: stylist2, pattern: pattern2 }],
    ['not the service’s length', { weeks: 1, from: '16:00', to: '16:45' }],
    ['a roster row of another stylist', { weeks: 1, from: '17:00', to: '17:30', pattern: pattern2 }],
  ];
  for (const [what, h] of refusals) {
    const r = await refused(hold(h));
    expect(r.code, what).toBe('MS015');
    expect(r.message, what).toMatch(outside);
  }
  await command('leave.record', (c) =>
    c.query(`insert into books.leave (tenant_id, staff_id, kind, first_day, last_day) values ($1, $2, 'sick', ${day(2)}, ${day(2)})`, [f.tenant, f.staffRow]),
  );
  expect((await refused(hold({ weeks: 2, from: '15:00', to: '15:30' }))).message).toMatch(outside);
  await command('holiday.set', (c) => c.query(`insert into books.holiday (tenant_id, shop_id, day, name_key) values ($1, $2, ${day(3)}, 'holi')`, [f.tenant, f.shop]));
  expect((await refused(hold({ weeks: 3, from: '15:00', to: '15:30' }))).message).toMatch(outside);
  // A one-day change wins over the pattern that day: the pattern no longer names a slot, the change does.
  const change = await command('shift.change', (c) =>
    one(c, `insert into books.shift_change (tenant_id, staff_id, day, shop_id, starts, ends) values ($1, $2, ${day(4)}, $3, '10:00', '18:00') returning id`, [
      f.tenant,
      f.staffRow,
      f.shop,
    ]),
  );
  expect((await refused(hold({ weeks: 4, from: '15:00', to: '15:30' }))).message).toMatch(outside);
  await hold({ weeks: 4, from: '15:00', to: '15:30', change });
  // A newer pattern replaces the old one: a slot naming the old row is refused.
  const newer = await command('shift.pattern.set', (c) =>
    one(c, `insert into books.shift_pattern (tenant_id, staff_id, shop_id, weekday, starts, ends, effective_from) values ($1, $2, $3, 1, '09:00', '21:00', current_date) returning id`, [
      f.tenant,
      stylist2,
      f.shop,
    ]),
  );
  expect((await refused(hold({ weeks: 5, from: '15:00', to: '15:30', staff: stylist2, pattern: pattern2 }))).message).toMatch(outside);
  await hold({ weeks: 5, from: '15:00', to: '15:30', staff: stylist2, pattern: newer });
  // A hold moves to requested only before it expires.
  const h = await hold({ weeks: 6, from: '15:00', to: '15:30' });
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [h.id]);
  const late = await refused(move(h.id, 'requested', { hold_token: h.token }));
  expect(late.message).toMatch(/hold has expired/);
});

it('HOLD1 one live hold per device, three per IP hash, two per stylist and day; a lapsed hold frees its allowance; a hold moves only with its token', async () => {
  // Weeks clear of the fixture's leave (+60 days) and holiday (+90 days), so only the caps can refuse.
  const device = sha(randomUUID());
  await hold({ weeks: 16, from: '09:00', to: '09:30', device });
  expect((await refused(hold({ weeks: 17, from: '09:00', to: '09:30', device }))).code).toBe('23505');
  const ip = sha(randomUUID());
  const ipHolds = [];
  for (const weeks of [18, 19, 20]) ipHolds.push(await hold({ weeks, from: '11:00', to: '11:30', ip }));
  const fourth = await refused(hold({ weeks: 21, from: '11:00', to: '11:30', ip }));
  expect(fourth.code).toBe('MS015');
  expect(fourth.message).toMatch(/network already holds three/);
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [ipHolds[0]?.id]);
  await hold({ weeks: 21, from: '11:00', to: '11:30', ip }); // the lapsed one no longer counts
  for (const from of ['13:00', '14:00']) await hold({ weeks: 22, from, to: from.replace(':00', ':30') });
  const third = await refused(hold({ weeks: 22, from: '16:00', to: '16:30' }));
  expect(third.code).toBe('MS015');
  expect(third.message).toMatch(/already has two holds/);
  const h = await hold({ weeks: 23, from: '13:00', to: '13:30' });
  expect((await refused(move(h.id, 'cancelled', { hold_token: 'not-the-token' }))).code).toBe('MS018');
  expect((await refused(move(h.id, 'requested'))).code).toBe('MS018');
  await move(h.id, 'cancelled', { hold_token: h.token });
});

it('ROLE1 a booking moves by role: the public its own hold, a member a request or a confirmed booking (confirmed only in booking.confirm, done only with its sale), the jobs role an expiry', async () => {
  const h = await hold({ weeks: 15, from: '10:00', to: '10:30' });
  expect((await refused(move(h.id, 'confirmed', owner(), app))).code).toBe('MS010'); // a member does not move a hold
  expect((await refused(move(h.id, 'requested', { hold_token: h.token, actor_id: f.owner }))).code).toBe('MS018'); // the public names no actor
  await tx(pub, { tenant_id: f.tenant, hold_token: h.token }, async (c) => {
    await c.query(`update ops.booking set state = 'requested' where id = $1`, [h.id]);
    await c.query(
      `insert into ops.booking_contact (tenant_id, booking_id, site_id, contact_name, contact_phone_e164, notice_version, consent_version) values ($1, $2, $3, 'X', '+910000000000', 'v1', 'v1')`,
      [f.tenant, h.id, f.site],
    );
  });
  expect((await refused(move(h.id, 'confirmed', owner(), app))).message).toMatch(/only inside booking.confirm/);
  expect((await refused(move(h.id, 'confirmed', { tenant_id: f.tenant, actor_id: f.staff, command: 'booking.confirm' }, app))).code).toBe('MS007');
  expect((await refused(move(h.id, 'declined', owner(), app))).message).toMatch(/reason code/);
  await move(h.id, 'confirmed', { ...owner(), command: 'booking.confirm' }, app);
  expect((await refused(move(h.id, 'done', owner(), app))).message).toMatch(/only with the sale that names it/);
  await command('sale.record', async (c) => {
    const s = await one(c, `insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency, booking_id) values ($1, $2, now(), 40000, 'INR', $3) returning id`, [
      f.tenant,
      f.shop,
      h.id,
    ]);
    const price = (await c.query(`select id from books.price where item_id = $1 limit 1`, [f.service])).rows[0].id;
    await c.query(
      `insert into books.sale_line (tenant_id, sale_id, line_no, item_id, item_kind, price_id, staff_id, qty_milli, unit_price_minor, gross_minor, currency)
       values ($1, $2, 1, $3, 'service', $4, $5, 1000, 40000, 40000, 'INR')`,
      [f.tenant, s, f.service, price, f.staffRow],
    );
    await c.query(`update ops.booking set state = 'done' where id = $1`, [h.id]);
  });
  expect((await refused(move(h.id, 'cancelled', owner(), app))).message).toMatch(/is final/);
  expect((await refused(tx(jobs, { tenant_id: f.tenant }, (c) => c.query('insert into ops.booking (tenant_id) values ($1)', [f.tenant])))).code).toBe('42501');
  // A contact row comes only with its hold's move to requested, in that transaction.
  const h2 = await hold({ weeks: 15, from: '12:00', to: '12:30' });
  const loose = await refused(
    tx(pub, { tenant_id: f.tenant }, (c) =>
      c.query(
        `insert into ops.booking_contact (tenant_id, booking_id, site_id, contact_name, contact_phone_e164, notice_version, consent_version) values ($1, $2, $3, 'X', '+910000000000', 'v1', 'v1')`,
        [f.tenant, h2.id, f.site],
      ),
    ),
  );
  expect(loose.message).toMatch(/comes with its hold's move to requested/);
});

it('ROLE1 a reservation is asked by the public, held, declined, released or sold by a member (sold only with the sale naming it), and expired by the jobs role', async () => {
  const set = (id: string, state: string, ctx: Record<string, string>, pool: pg.Pool) =>
    tx(pool, { tenant_id: f.tenant, ...ctx }, (c) => c.query(`update ops.reservation set state = $2 where id = $1`, [id, state]));
  expect((await refused(set(f.reservation, 'held', {}, pub))).code).toBe('42501');
  expect((await refused(set(f.reservation, 'held', {}, jobs))).code).toBe('MS007');
  await set(f.reservation, 'held', owner(), app);
  const { rows } = await db.admin.query(`select held_until > now() + interval '47 hours' as ok from ops.reservation where id = $1`, [f.reservation]);
  expect(rows).toEqual([{ ok: true }]); // from the site's reservation hours (48)
  expect((await refused(set(f.reservation, 'sold', owner(), app))).message).toMatch(/sold only with the sale/);
  expect((await refused(set(f.reservation, 'expired', {}, jobs))).code).toBe('MS007'); // before held_until
  await plant(db.admin, `update ops.reservation set held_until = now() - interval '1 second' where id = $1`, [f.reservation]);
  await set(f.reservation, 'expired', {}, jobs);
  expect((await refused(set(f.reservation, 'held', owner(), app))).message).toMatch(/is final/);
});

it('ROLE1 a request is the public’s, handled once by an active member, closed by the jobs role after 30 days open, and its details purged 7 days after it closed on a demo', async () => {
  const ask = async () => {
    const id = randomUUID();
    await tx(pub, { tenant_id: f.tenant }, (c) =>
      c.query(
        `insert into ops.site_request (tenant_id, id, site_id, shop_id, kind, source, contact_name, contact_phone_e164, notice_version, consent_version)
         values ($1, $2, $3, $4, 'enquiry', 'site', 'X', '+910000000000', 'v1', 'v1')`,
        [f.tenant, id, f.site, f.shop],
      ),
    );
    return id;
  };
  const set = (id: string, sql: string, ctx: Record<string, string>, pool: pg.Pool) => tx(pool, { tenant_id: f.tenant, ...ctx }, (c) => c.query(`update ops.site_request set ${sql} where id = $1`, [id]));
  const handled = await ask();
  await set(handled, `status = 'confirmed'`, owner(), app);
  expect((await refused(set(handled, `status = 'declined'`, owner(), app))).code).toBe('MS007'); // once
  const stale = await ask();
  expect((await refused(set(stale, `status = 'closed'`, {}, jobs))).code).toBe('MS007'); // open for less than 30 days
  await plant(db.admin, `update ops.site_request set created_at = now() - interval '31 days' where id = $1`, [stale]);
  await set(stale, `status = 'closed'`, {}, jobs);
  const purge = (id: string) => set(id, 'contact_name = null, contact_phone_e164 = null, note = null, ip_hash = null, erased_at = now()', {}, jobs);
  expect((await refused(purge(stale))).code).toBe('MS007'); // closed today
  await plant(db.admin, `update ops.site_request set handled_at = now() - interval '8 days' where id = $1`, [stale]);
  expect((await refused(set(stale, 'contact_name = null, contact_phone_e164 = null, note = null, ip_hash = null, erased_at = now()', {}, app))).code).toBe('MS018');
  await purge(stale);
  expect((await refused(tx(app, owner(), (c) => c.query(`insert into ops.site_request (tenant_id) values ($1)`, [f.tenant])))).code).toBe('42501');
});

it('S10 on a demo the public’s name and note are the samples and any other phone is refused; versions must be current, intake open, the shop the tenant’s own', async () => {
  const ask = (phone: string, versions = ['v1', 'v1'], shop = f.shop) => {
    const id = randomUUID();
    return tx(pub, { tenant_id: f.tenant }, (c) =>
      c.query(
        `insert into ops.site_request (tenant_id, id, site_id, shop_id, kind, source, contact_name, contact_phone_e164, note, notice_version, consent_version)
         values ($1, $2, $3, $4, 'enquiry', 'site', 'Real Person', $5, 'call after six', $6, $7)`,
        [f.tenant, id, f.site, shop, phone, versions[0], versions[1]],
      ),
    ).then(() => id);
  };
  expect((await refused(ask('+919811111111'))).code).toBe('MS010');
  const id = await ask('+910000000000');
  const { rows } = await db.admin.query('select contact_name, note from ops.site_request where id = $1', [id]);
  expect(rows).toEqual([{ contact_name: 'Sample customer', note: null }]);
  expect((await refused(ask('+910000000000', ['v0', 'v1']))).code).toBe('MS007');
  expect((await refused(ask('+910000000000', ['v1', 'v0']))).code).toBe('MS007');
  expect((await refused(ask('+910000000000', ['v1', 'v1'], other.shop))).code).toBe('23503');
  await tx(app, owner(), (c) => c.query(`update ops.site set intake = 'paused' where id = $1`, [f.site]));
  expect((await refused(ask('+910000000000'))).message).toMatch(/takes no requests/);
  await tx(app, owner(), (c) => c.query(`update ops.site set intake = 'open' where id = $1`, [f.site]));
  const res = await db.admin.query('select contact_name, note from ops.reservation where id = $1', [f.reservation]);
  expect(res.rows).toEqual([{ contact_name: 'Sample customer', note: null }]);
});

it('PUB1 the public reads bookings and pieces as ids and times only, no contact, request, price or name; profiles only shown, looks and art only as a release shows them', async () => {
  const q = (sql: string) => tx(pub, { tenant_id: f.tenant }, (c) => c.query(sql));
  for (const sql of [
    'select contact_phone_e164 from ops.booking_contact',
    'select * from ops.site_request',
    'select contact_name from ops.reservation',
    'select hold_token_sha256 from ops.booking',
    'select device_hash from ops.booking',
    'select customer_id from ops.booking',
    'select amount_minor from books.price',
    'select name from books.item_revision',
    'select name from ops.contact',
    'select * from books.staff_terms',
  ]) {
    expect((await refused(q(sql))).code, sql).toBe('42501');
  }
  expect((await q('select staff_id, during, state from ops.booking')).rowCount).toBeGreaterThan(0);
  expect((await q('select item_id, state, held_until from ops.reservation')).rowCount).toBe(1);
  expect((await q('select staff_id, starts, ends from books.shift_pattern')).rowCount).toBeGreaterThan(0);
  // A hidden profile is gone from the public; a look no release names is invisible; only named art is served.
  await tx(app, owner(), (c) => c.query(`update ops.staff_public set shown = false`));
  expect((await q('select id from ops.staff_public')).rowCount).toBe(0);
  const unnamedArt = await tx(app, owner(), (c) =>
    one(c, `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'art', 'upload', $2, $3, 'image/svg+xml', 900) returning id`, [
      f.tenant,
      `t-${f.tenant}/art/spare.svg`,
      sha(randomUUID()),
    ]),
  );
  await tx(app, owner(), (c) => c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair, art) values ($1, $2, '{}', 'inter', $3)`, [f.tenant, f.site, JSON.stringify({ hero: unnamedArt })]));
  expect((await q('select id from ops.site_look')).rows.map((r) => r.id)).toEqual([f.look]);
  const docs = (await q('select kind from ops.document')).rows.map((r) => r.kind);
  expect(docs).toEqual(['art']); // the released look's art; not the photo, not the unreleased look's art
});

it('PUB1 a look holds only the fixed token names, colours as #rrggbb, plain values (no url(), quote or semicolon) and the tenant’s own art', async () => {
  const look = (tokens: unknown, art: unknown = {}) =>
    tx(app, owner(), (c) =>
      c.query(`insert into ops.site_look (tenant_id, site_id, tokens, font_pair, art) values ($1, $2, $3, 'inter', $4)`, [f.tenant, f.site, JSON.stringify(tokens), JSON.stringify(art)]),
    );
  const bad: [string, unknown, unknown?][] = [
    ['a url()', { '--font-display': 'url(https://evil.example/x.woff)' }],
    ['a semicolon', { '--radius-card': '4px; background: red' }],
    ['a quote', { '--font-text': '"Inter"' }],
    ['an unknown token', { '--background-image': '#ffffff' }],
    ['a colour not #rrggbb', { '--accent': 'red' }],
    ['a set that is not light or dark', { light: { '--ground': '#ffffff' }, sepia: { '--ground': '#eeeeee' } }],
    ['art that is a photo', {}, { hero: f.document }],
    ['art of another tenant', {}, { hero: (await db.admin.query(`select id from ops.document where tenant_id = $1 and kind = 'art' limit 1`, [other.tenant])).rows[0].id }],
  ];
  for (const [what, tokens, art] of bad) {
    const r = await refused(look(tokens, art));
    expect(r.code, what).toBe('MS007');
    expect(r.message, what).toMatch(art ? /art names this tenant's own art documents/ : /^look refused: /);
  }
  await look({ light: { '--ground': '#fdfbf7', '--font-display': 'Cormorant, serif' }, dark: { '--ground': '#111111', '--space-2': '8px' } });
});

it('S1 a publishable key is kept as its sha256, revoked once by an active owner and never restored; S2 a site’s origins are https hosts (localhost only off live) and a booking mode needs the bookings switch', async () => {
  const key = await tx(app, owner(), (c) => one(c, `insert into ops.site_key (tenant_id, site_id, key_sha256, prefix) values ($1, $2, $3, 'mpk_site-shop_wxyz') returning id`, [f.tenant, f.site, sha(randomUUID())]));
  const revoke = (actor: string, set = 'revoked_at = now(), revoked_by = $2') =>
    tx(app, { tenant_id: f.tenant, actor_id: actor }, (c) => c.query(`update ops.site_key set ${set} where id = $1`, set.includes('$2') ? [key, actor] : [key]));
  expect((await refused(revoke(f.manager))).code).toBe('MS007');
  await revoke(f.owner);
  expect((await refused(revoke(f.owner, 'revoked_at = null, revoked_by = null'))).code).toBe('MS010');
  const origins = (list: string[]) => tx(app, owner(), (c) => c.query(`update ops.site set origins = $2 where id = $1`, [f.site, list]));
  for (const o of ['http://shop.example.invalid', 'shop.example.invalid', 'https://shop.example.invalid/path', "https://x' or 1=1"]) {
    expect((await refused(origins([o]))).code, o).toBe('MS007');
  }
  await origins(['https://shop.example.invalid', 'http://localhost:3000']);
  await tx(app, owner(), (c) => c.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'bookings', false)`, [f.tenant]));
  const r = await refused(tx(app, owner(), (c) => c.query(`update ops.site set booking_mode = 'request' where id = $1`, [f.site])));
  expect(r.code).toBe('MS019');
  await tx(app, owner(), (c) => c.query(`insert into ops.capability_switch (tenant_id, capability, is_on) values ($1, 'bookings', true)`, [f.tenant]));
  expect((await refused(tx(app, { tenant_id: f.tenant, actor_id: f.manager }, (c) => c.query(`update ops.site set intake = 'paused' where id = $1`, [f.site])))).code).toBe('MS007');
});

it('S9 a release names site.* release snapshots of its own transaction, published on live by an active owner from a real session, never from a demo one; off live only the owner role publishes', async () => {
  const live = await openTestDb();
  try {
    await asOwner(live.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
    await live.sabotage(); // the live clone is this test's own, so the current red-proof reaches it too
    const liveApp = live.as('munshi_app');
    const tenant = randomUUID();
    const liveOwner = randomUUID();
    const ctx = { tenant_id: tenant, actor_id: liveOwner };
    const { site, look } = await tx(liveApp, ctx, async (c) => {
      await c.query(`insert into ops.tenant (tenant_id, name, business_type, data_class) values ($1, 'Live shop', 'salon', 'live')`, [tenant]);
      await c.query(`insert into ops.tenant_directory (slug, tenant_id) values ('live-salon', $1)`, [tenant]);
      await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Owner', 'owner')`, [tenant, liveOwner]);
      const site = await one(c, `insert into ops.site (tenant_id, origins, privacy_version, consent_version) values ($1, '{}', 'v1', 'v1') returning id`, [tenant]);
      const look = await one(c, `insert into ops.site_look (tenant_id, site_id, tokens, font_pair) values ($1, $2, '{}', 'inter') returning id`, [tenant, site]);
      return { site, look };
    });
    const mint = (c: pg.PoolClient, query = 'site.catalogue', purpose = 'release') =>
      one(c, `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count) values ($1, $2, '{}', $3, $4, $5, '\\x00', '\\x00', 0) returning id`, [
        tenant,
        query,
        purpose,
        JSON.stringify(COLUMNS),
        JSON.stringify(rowsOf('1')),
      ]);
    const publish = (via: string, snapshot: (c: pg.PoolClient) => Promise<string>) =>
      tx(liveApp, { ...ctx, via }, async (c) => {
        const snap = await snapshot(c);
        return one(c, `insert into ops.site_release (tenant_id, site_id, look_id, snapshots, created_txid) values ($1, $2, $3, $4, 0) returning id`, [
          tenant,
          site,
          look,
          JSON.stringify({ [(await c.query('select query_name from snap.snapshot where id = $1', [snap])).rows[0].query_name]: snap }),
        ]);
      });
    const snapshotRule = /each snapshot is a site\.\* release read of this tenant, minted in this transaction/;
    const demo = await refused(publish('demo', (c) => mint(c)));
    expect(demo.code).toBe('MS010');
    expect(demo.message).toMatch(/a demo or sandbox session never publishes/);
    const notSite = await refused(publish('real', (c) => mint(c, 'sale.day')));
    expect(notSite.code).toBe('MS006');
    expect(notSite.message).toMatch(snapshotRule);
    const earlier = await tx(liveApp, { ...ctx, via: 'real' }, (c) => mint(c));
    const stale = await refused(publish('real', async () => earlier));
    expect(stale.code).toBe('MS006');
    expect(stale.message).toMatch(snapshotRule);
    const release = await publish('real', (c) => mint(c));
    const pins = await live.admin.query(`select count(*)::int as n from snap.pin where holder = 'release' and holder_id = $1`, [release]);
    expect(pins.rows[0].n).toBe(1);
  } finally {
    await live.close();
  }
  // On this demo database the app never publishes.
  const r = await refused(
    tx(app, { ...owner(), via: 'real' }, (c) =>
      c.query(`insert into ops.site_release (tenant_id, site_id, look_id, snapshots, created_txid) values ($1, $2, $3, '{}', 0)`, [f.tenant, f.site, f.look]),
    ),
  );
  expect(r.code).toBe('MS010');
  expect(r.message).toMatch(/off live only the owner role publishes/);
});

it('ROLE1 a staff profile is shown only by an active owner who attests the person agreed, and erases to nothing', async () => {
  const add = (actor: string, agreed = "now() - interval '1 day'") =>
    tx(app, { tenant_id: f.tenant, actor_id: actor }, (c) =>
      one(c, `insert into ops.staff_public (tenant_id, staff_id, shop_id, display_name, consent_at) values ($1, $2, $3, 'Asha', ${agreed}) returning id`, [f.tenant, stylist2, f.shop]),
    );
  expect((await refused(add(f.manager))).code).toBe('MS007');
  expect((await refused(add(f.owner, "now() + interval '1 day'"))).code).toBe('MS007');
  const id = await add(f.owner);
  expect((await refused(tx(app, owner(), (c) => c.query(`update ops.staff_public set display_name = 'Someone else' where id = $1`, [id])))).code).toBe('MS011');
  await tx(app, owner(), (c) => c.query(`update ops.staff_public set display_name = null, blurb = null, shown = false, erased_at = now() where id = $1`, [id]));
});

it('ROLE1 every role-shaped transition of 14 is refused for every role it does not belong to, and for a jobs or public session that names an actor, then admitted for its own', async () => {
  const lapsed = await hold({ weeks: 31, from: '10:00', to: '10:30' });
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 second' where id = $1`, [lapsed.id]);
  const ended = await hold({ weeks: 31, from: '12:00', to: '12:30' });
  await tx(pub, { tenant_id: f.tenant, hold_token: ended.token }, async (c) => {
    await c.query(`update ops.booking set state = 'requested' where id = $1`, [ended.id]);
    await c.query(
      `insert into ops.booking_contact (tenant_id, booking_id, site_id, contact_name, contact_phone_e164, notice_version, consent_version) values ($1, $2, $3, 'X', '+910000000000', 'v1', 'v1')`,
      [f.tenant, ended.id, f.site],
    );
  });
  await move(ended.id, 'cancelled', owner(), app);
  await plant(db.admin, `update ops.booking set updated_at = now() - interval '8 days' where id = $1`, [ended.id]);
  const ask = (table: 'site_request' | 'reservation') => {
    const sql =
      table === 'site_request'
        ? `insert into ops.site_request (tenant_id, id, site_id, shop_id, kind, source, contact_name, contact_phone_e164, notice_version, consent_version)
           values ($1, $2, $3, $4, 'enquiry', 'site', 'X', '+910000000000', 'v1', 'v1')`
        : `insert into ops.reservation (tenant_id, id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, notice_version, consent_version)
           values ($1, $2, $3, $4, 1000, 'X', '+910000000000', 'v1', 'v1')`;
    return { sql, params: () => [f.tenant, randomUUID(), f.site, table === 'site_request' ? f.shop : f.good] };
  };
  const newRequest = randomUUID();
  const staleRequest = randomUUID();
  const askedPiece = randomUUID();
  for (const [id, table] of [[newRequest, 'site_request'], [staleRequest, 'site_request'], [askedPiece, 'reservation']] as const) {
    const a = ask(table);
    await tx(pub, { tenant_id: f.tenant }, (c) => c.query(a.sql, [f.tenant, id, ...a.params().slice(2)]));
  }
  await plant(db.admin, `update ops.site_request set created_at = now() - interval '31 days' where id = $1`, [staleRequest]);
  const holdSql = `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash, shift_pattern_id)
                   values ($1, $2, $3, $4, $5, ${at(32, '10:00', '10:30')}, 'held', 'site', $6, $7, $8, $9)`;
  const SHAPES14: Shape[] = [
    {
      name: 'the public holds a slot',
      sql: holdSql,
      params: () => [f.tenant, f.site, f.shop, f.staffRow, f.service, sha(randomUUID()), sha(randomUUID()), sha(randomUUID()), f.pattern],
      own: 'munshi_public',
      ownActor: false,
      wrong: [['munshi_public', true, 'MS018'], ['munshi_app', true, 'MS007'], ['munshi_app', false, 'MS007'], ['munshi_jobs', false, '42501']],
    },
    {
      name: 'a lapsed hold expires',
      sql: `update ops.booking set state = 'expired' where tenant_id = $1 and id = $2`,
      params: () => [f.tenant, lapsed.id],
      own: 'munshi_jobs',
      ownActor: false,
      wrong: [['munshi_jobs', true, 'MS018'], ['munshi_public', true, 'MS018'], ['munshi_app', true, 'MS010']],
    },
    { name: 'the public asks for a request', ...ask('site_request'), own: 'munshi_public', ownActor: false, wrong: [['munshi_public', true, 'MS018'], ['munshi_app', true, '42501'], ['munshi_jobs', false, '42501']] },
    { name: 'the public asks to hold a piece', ...ask('reservation'), own: 'munshi_public', ownActor: false, wrong: [['munshi_public', true, 'MS018'], ['munshi_app', true, '42501'], ['munshi_jobs', false, '42501']] },
    {
      name: 'a member handles a request',
      sql: `update ops.site_request set status = 'confirmed' where tenant_id = $1 and id = $2`,
      params: () => [f.tenant, newRequest],
      own: 'munshi_app',
      ownActor: true,
      wrong: [['munshi_app', false, 'MS007'], ['munshi_jobs', true, 'MS018'], ['munshi_public', false, '42501']],
    },
    {
      name: 'the jobs role closes a request left open',
      sql: `update ops.site_request set status = 'closed' where tenant_id = $1 and id = $2`,
      params: () => [f.tenant, staleRequest],
      own: 'munshi_jobs',
      ownActor: false,
      wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', true, 'MS007'], ['munshi_app', false, 'MS007'], ['munshi_public', false, '42501']],
    },
    {
      name: 'a member holds a piece',
      sql: `update ops.reservation set state = 'held' where tenant_id = $1 and id = $2`,
      params: () => [f.tenant, askedPiece],
      own: 'munshi_app',
      ownActor: true,
      wrong: [['munshi_app', false, 'MS007'], ['munshi_jobs', true, 'MS018'], ['munshi_jobs', false, 'MS007'], ['munshi_public', false, '42501']],
    },
    {
      name: 'the purge erases a booking contact',
      sql: `update ops.booking_contact set contact_name = null, contact_phone_e164 = null, note = null, ip_hash = null, erased_at = now() where tenant_id = $1 and booking_id = $2`,
      params: () => [f.tenant, ended.id],
      own: 'munshi_jobs',
      ownActor: false,
      wrong: [['munshi_jobs', true, 'MS018'], ['munshi_app', false, 'MS018'], ['munshi_public', false, '42501']],
    },
  ];
  let refusals = 0;
  for (const s of SHAPES14) {
    for (const [role, actor, code] of s.wrong) {
      const ctx = actor ? owner() : { tenant_id: f.tenant };
      const r = await refused(tx(db.as(role), ctx, (c) => c.query(s.sql, s.params())));
      expect(r.code, `${s.name}, as ${role}${actor ? ' with an actor' : ''}: ${r.message}`).toBe(code);
      refusals++;
    }
  }
  expect(refusals).toBe(27);
  for (const s of SHAPES14) {
    const r = await tx(db.as(s.own), s.ownActor ? owner() : { tenant_id: f.tenant }, (c) => c.query(s.sql, s.params()));
    expect(r.rowCount, s.name).toBe(1);
  }
});
