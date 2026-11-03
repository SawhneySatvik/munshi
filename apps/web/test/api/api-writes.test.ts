// @vitest-environment node
// The writes of /api/v1, called as Next calls the route handlers, on a
// real v2 database: each POST's and DELETE's happy path and error table, idempotency replay and mismatch, the order
// routes, and the gates the writes carry:
//   - a bad, other slug's, revoked or missing publishable key answers the one 404, identical to an unknown route;
//   - a write from an origin the site does not list, or with none, is that 404 and stores nothing;
//   - the public routes write ops rows only: books.*, snap.*, audit.* and approval.* row counts are unchanged across
//     the scripted run (clause 1), and a source scan holds the key compare to timingSafeEqual;
//   - 413 over 4 KB, 415 for anything but JSON, 400 for an unknown field, 429 with Retry-After at the IP's limit, a
//     honeypot answered 202 storing nothing, a failed bot check 400 bot_check (the recorded verifier, Turnstile's
//     failing test secret);
//   - an Idempotency-Key replay answers the same bytes and stores one row; another body under the key is 409;
//   - paused intake answers 503 to a POST while GETs still work;
//   - on the demo deployment a real-looking name and phone are stored as the samples; stale versions are 400; a
//     branch of another tenant is refused.
// Red-proofs: db/test/v2/sabotage/api.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { issueSiteKey, lineAmount, switchCapability, withTx } from "@munshi/core";
import { ERRORS, HoldCreated, OrderCreated, OrderStatus } from "@munshi/contracts";
import { recordedBotCheck, TEST_SECRETS } from "@munshi/adapters/botcheck";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sabotageIs } from "../../../../db/test/v2/sabotage/index.ts";
import { POST as unknownPost } from "../../app/api/v1/[...rest]/route";
import { swapApiPorts } from "../../lib/api/deps";
import * as api from "../../lib/api/routes";
import { booksCounts, type Call, call, freshIp, type Handler, openWorld, publish, REQUEST_ID, text, tomorrow, verify, type World, writeHeaders } from "./fixture";

let w: World;
let before: Record<string, number>;
const A = () => `/api/v1/sites/${w.a.slug}`;
const NOT_FOUND = JSON.stringify({ error: { code: "not_found", message: ERRORS.not_found.message, fields: [], requestId: REQUEST_ID } });
const DEVICE = "device-token-for-the-api-tests-0001";

beforeAll(async () => {
  w = await openWorld();
  before = await booksCounts(w.db);
  await w.db.sabotage();
}, 300_000);
afterAll(async () => {
  swapApiPorts({});
  await w?.close();
});

const send = (handler: Handler, route: string, params: Record<string, string>, body: unknown, opts: Call = {}) =>
  call(handler, `${A()}${route}`, { slug: w.a.slug, ...params }, { body, ip: freshIp(), ...opts, headers: writeHeaders(w.a, opts.headers) });
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string; fields: string[] } }).error;
const q = async <R>(sql: string, params: unknown[] = []) => (await w.db.admin.query(sql, params)).rows as R[];

const person = { name: "Ravi Kumar", phone: "+91 98765 43210", whatsappUpdates: true, noticeVersion: "v1", consentVersion: "v1", botToken: "XXXX.DUMMY.TOKEN.XXXX", website: "" };

// The slot `n` quarter hours after 10:00 tomorrow, on the stylist's pattern for that weekday.
async function slot(n: number) {
  const day = tomorrow();
  const weekday = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const pattern = (await q<{ id: string }>("select id::text as id from books.shift_pattern where tenant_id = $1 and staff_id = $2 and weekday = $3", [w.a.tenantId, w.a.staffId, weekday]))[0]?.id as string;
  const start = new Date(Date.parse(`${day}T10:00:00+05:30`) + n * 15 * 60_000).toISOString();
  return { shopId: w.a.shopId, stylistId: w.a.staffId, serviceId: w.a.items.haircut, start, shiftRel: "books.shift_pattern", shiftId: pattern, botToken: "XXXX.DUMMY.TOKEN.XXXX" };
}
const holdHeaders = (device: string, extra: Record<string, string> = {}) => ({ "x-munshi-device": device, ...extra });

test("a bad, another slug's, a revoked or a missing key answers the one 404, identical to an unknown route", async () => {
  const body = { ...person, shopId: w.a.shopId, message: "Do you open on Sunday?" };
  const revoked = await withTx(w.db.app, { kind: "member", session: w.a.owner }, async (c) => {
    const k = await issueSiteKey(c, w.a.siteId, w.a.slug);
    await c.query("update ops.site_key set revoked_at = now() where id = $1", [k.keyId]);
    return k.key;
  });
  const variants = [`Bearer ${w.a.key}x`, `Bearer ${w.b.key}`, `Bearer ${revoked}`, `Bearer mpk_${w.a.slug}_${"A".repeat(43)}`, "Basic abc", ""];
  const answers = [];
  for (const authorization of variants) answers.push(await text(await send(api.enquire, "/enquiries", {}, body, { headers: { authorization } })));
  answers.push(await text(await call(unknownPost, "/api/v1/drafts", { rest: ["drafts"] }, { body: {} })));
  for (const a of answers) expect(a).toEqual(answers.at(-1));
  expect(answers[0]?.status).toBe(404);
  expect(answers[0]?.body).toBe(NOT_FOUND);
  expect((await q<{ n: number }>("select count(*)::int as n from ops.site_request where tenant_id = $1", [w.a.tenantId]))[0]?.n).toBe(0);
});

test("the key is compared timing-safe: core's resolver uses timingSafeEqual and no === on a hash", () => {
  let src = readFileSync(path.join(import.meta.dirname, "../../../../packages/core/src/public.ts"), "utf8");
  if (sabotageIs("v2-s1-hash-compare-planted")) src = src.replace("timingSafeEqual(row.key_sha256, given)", "row.key_sha256.equals(given)");
  const fn =src.slice(src.indexOf("export async function siteKeyId("), src.indexOf("\n}\n", src.indexOf("export async function siteKeyId(")));
  expect(fn).toContain("timingSafeEqual(row.key_sha256, given)");
  expect(fn).not.toMatch(/(sha256|given|hash)[^\n]*(===|!==|\.equals\()/);
});

test("a write from an origin the site does not list, or with none, is the 404 and stores nothing", async () => {
  const body = { ...person, shopId: w.a.shopId, message: "Hello" };
  const other = await send(api.enquire, "/enquiries", {}, body, { headers: { origin: "https://elsewhere.example" } });
  const none = await call(api.enquire, `${A()}/enquiries`, { slug: w.a.slug }, { body, ip: freshIp(), headers: { authorization: `Bearer ${w.a.key}`, "idempotency-key": "no-origin-key-1" } });
  expect(await text(other)).toEqual(await text(none));
  expect(other.status).toBe(404);
  expect((await q<{ n: number }>("select count(*)::int as n from ops.site_request where tenant_id = $1", [w.a.tenantId]))[0]?.n).toBe(0);
});

test("API hold: 201 with a ten-minute hold; a replay answers the same bytes and stores one row; another body under the key is 409", async () => {
  const key = "hold-key-replay-0001";
  const body = await slot(0);
  const first = await send(api.hold, "/holds", {}, body, { headers: { "idempotency-key": key, ...holdHeaders(DEVICE) } });
  expect(first.status).toBe(201);
  const firstText = await first.text();
  const made = HoldCreated.parse(JSON.parse(firstText));
  const minutes = (Date.parse(made.expiresAt) - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(9);
  expect(minutes).toBeLessThanOrEqual(10);
  const again = await send(api.hold, "/holds", {}, body, { headers: { "idempotency-key": key, ...holdHeaders(DEVICE) } });
  expect(again.status).toBe(201);
  expect(await again.text()).toBe(firstText);
  expect((await q<{ n: number }>("select count(*)::int as n from ops.booking where tenant_id = $1", [w.a.tenantId]))[0]?.n).toBe(1);
  const other = await send(api.hold, "/holds", {}, await slot(4), { headers: { "idempotency-key": key, ...holdHeaders(DEVICE) } });
  expect(other.status).toBe(409);
  expect((await errorOf(other)).code).toBe("idempotency_mismatch");

  // The device already holds one: a second is hold_limit. Another device on the same slot: slot_taken.
  const second = await send(api.hold, "/holds", {}, await slot(8), { headers: holdHeaders(DEVICE) });
  expect(second.status).toBe(429);
  expect((await errorOf(second)).code).toBe("hold_limit");
  const taken = await send(api.hold, "/holds", {}, body, { headers: holdHeaders("another-device-token-000001") });
  expect(taken.status).toBe(409);
  expect((await errorOf(taken)).code).toBe("slot_taken");

  // Release: a wrong token is the 404; the right one releases, and its replay answers the same.
  const del = (token: string, k: string) =>
    call(api.releaseHold, `${A()}/holds/${made.holdId}`, { slug: w.a.slug, id: made.holdId }, { method: "DELETE", ip: freshIp(), headers: writeHeaders(w.a, { "x-hold-token": token, "idempotency-key": k }) });
  const wrong = await del("B".repeat(43), "release-key-wrong-01");
  expect(wrong.status).toBe(404);
  expect(await wrong.text()).toBe(NOT_FOUND);
  const right = await del(made.holdToken, "release-key-right-01");
  expect(right.status).toBe(200);
  const rightText = await right.text();
  expect(JSON.parse(rightText)).toEqual({ holdId: made.holdId, released: true });
  expect(await (await del(made.holdToken, "release-key-right-01")).text()).toBe(rightText);
  expect((await q<{ state: string }>("select state from ops.booking where id = $1", [made.holdId]))[0]?.state).toBe("cancelled");
  const noKey = await call(api.releaseHold, `${A()}/holds/${made.holdId}`, { slug: w.a.slug, id: made.holdId }, {
    method: "DELETE",
    ip: freshIp(),
    headers: { authorization: `Bearer ${w.a.key}`, origin: w.a.origin, "x-hold-token": made.holdToken },
  });
  expect(noKey.status).toBe(400);
  expect((await errorOf(noKey)).code).toBe("idempotency_key_required");
});

test("API book: a hold becomes a request; on the demo the real-looking name and phone are stored as the samples; stale versions are 400; a wrong token is the 404", async () => {
  const held = HoldCreated.parse(await (await send(api.hold, "/holds", {}, await slot(12), { headers: holdHeaders("device-token-for-booking-01") })).json());
  const stale = await send(api.book, "/bookings", {}, { ...person, holdId: held.holdId, holdToken: held.holdToken, noticeVersion: "v0" });
  expect(stale.status).toBe(400);
  expect((await errorOf(stale)).code).toBe("stale_notice");
  const wrong = await send(api.book, "/bookings", {}, { ...person, holdId: held.holdId, holdToken: "C".repeat(43) });
  expect(wrong.status).toBe(404);
  const ok = await send(api.book, "/bookings", {}, { ...person, holdId: held.holdId, holdToken: held.holdToken, note: "Please call first" });
  expect(ok.status).toBe(202);
  expect(await ok.json()).toEqual({ id: held.holdId, received: true });
  expect((await q("select state from ops.booking where id = $1", [held.holdId]))[0]).toEqual({ state: "requested" });
  expect((await q("select contact_name, contact_phone_e164, note, wa_updates from ops.booking_contact where booking_id = $1", [held.holdId]))[0]).toEqual({
    contact_name: "Sample customer",
    contact_phone_e164: "+910000000000",
    note: null,
    wa_updates: true,
  });
});

test("API booking request: only in request mode; a day past 60 days, a good as a service, or another tenant's branch is invalid", async () => {
  const body = { ...person, shopId: w.a.shopId, serviceIds: [w.a.items.haircut], preferredOn: tomorrow(), timeWindow: "morning" };
  expect((await send(api.requestBooking, "/booking-requests", {}, body)).status).toBe(404); // the site takes live slots
  await withTx(w.db.app, { kind: "member", session: w.a.owner }, (c) => c.query(`update ops.site set booking_mode = 'request' where id = $1`, [w.a.siteId]));
  try {
    const ok = await send(api.requestBooking, "/booking-requests", {}, body);
    expect(ok.status).toBe(202);
    const { id } = (await ok.json()) as { id: string };
    expect((await q("select kind, item_ids::text[] as items, contact_name, contact_phone_e164 from ops.site_request where id = $1", [id]))[0]).toEqual({
      kind: "booking_request",
      items: [w.a.items.haircut],
      contact_name: "Sample customer",
      contact_phone_e164: "+910000000000",
    });
    for (const [bad, field] of [
      [{ preferredOn: "2099-01-01" }, "preferredOn"],
      [{ serviceIds: [w.a.items.tea] }, "serviceIds.0"],
      [{ shopId: w.b.shopId }, "shopId"],
    ] as const) {
      const r = await send(api.requestBooking, "/booking-requests", {}, { ...body, ...bad });
      expect(r.status, field).toBe(400);
      expect(await errorOf(r)).toMatchObject({ code: "invalid", fields: [field] });
    }
  } finally {
    await withTx(w.db.app, { kind: "member", session: w.a.owner }, (c) => c.query(`update ops.site set booking_mode = 'slots' where id = $1`, [w.a.siteId]));
  }
});

test("API enquiry: 202 stored; a filled honeypot is 202 and stores nothing; a failed bot check is 400 bot_check and stores nothing", async () => {
  const count = async () => (await q<{ n: number }>("select count(*)::int as n from ops.site_request where tenant_id = $1 and kind = 'enquiry'", [w.a.tenantId]))[0]?.n;
  const body = { ...person, shopId: w.a.shopId, itemId: w.a.items.saree, message: "Is the cotton saree in blue too?" };
  const n0 = await count();
  expect((await send(api.enquire, "/enquiries", {}, body)).status).toBe(202);
  expect(await count()).toBe((n0 as number) + 1);
  const pot = await send(api.enquire, "/enquiries", {}, { ...body, website: "http://spam.example" });
  expect(pot.status).toBe(202);
  expect(((await pot.json()) as { received: boolean }).received).toBe(true);
  expect(await count()).toBe((n0 as number) + 1);
  swapApiPorts({ botCheck: recordedBotCheck(TEST_SECRETS.fail) });
  try {
    const bot = await send(api.enquire, "/enquiries", {}, body);
    expect(bot.status).toBe(400);
    expect((await errorOf(bot)).code).toBe("bot_check");
  } finally {
    swapApiPorts({});
  }
  expect(await count()).toBe((n0 as number) + 1);
  const unknownItem = await send(api.enquire, "/enquiries", {}, { ...body, itemId: w.b.items.rice });
  expect(await errorOf(unknownItem)).toMatchObject({ code: "invalid", fields: ["itemId"] });
});

test("API reservation: a piece asked for is stored requested; a service is invalid; a fourth live piece from one network is 429", async () => {
  const body = { itemId: w.a.items.saree, qtyMilli: 1000, name: "Asha", phone: "+919800000001", noticeVersion: "v1", consentVersion: "v1", botToken: "t", website: "" };
  const ip = "198.18.0.9";
  for (let i = 0; i < 3; i++) expect((await send(api.reserve, "/reservations", {}, body, { ip })).status).toBe(202);
  const fourth = await send(api.reserve, "/reservations", {}, body, { ip });
  expect(fourth.status).toBe(429);
  expect(fourth.headers.get("retry-after")).not.toBeNull();
  const service = await send(api.reserve, "/reservations", {}, { ...body, itemId: w.a.items.haircut });
  expect(await errorOf(service)).toMatchObject({ code: "invalid", fields: ["itemId"] });
  expect((await q<{ n: number }>("select count(*)::int as n from ops.reservation where tenant_id = $1 and state = 'requested'", [w.a.tenantId]))[0]?.n).toBe(3);
});

test("API order: 201, the lines priced from the release's cells with the counter's line function and no offer discount; a replay answers the same bytes, one request stored", async () => {
  const key = "order-key-replay-0001";
  const body = { shopId: w.a.shopId, channel: "site", lines: [{ itemId: w.a.items.tea, qtyMilli: 2000 }, { itemId: w.a.items.saree, qtyMilli: 1000 }], offerCode: "FESTIVE10" };
  const first = await send(api.order, "/orders", {}, body, { headers: { "idempotency-key": key } });
  expect(first.status).toBe(201);
  const firstText = await first.text();
  const o = OrderCreated.parse(JSON.parse(firstText));
  expect(o.lines.map((l) => [l.itemId, l.price.minor, l.amount.minor])).toEqual([
    [w.a.items.tea, 24_000, lineAmount(2000, 24_000)],
    [w.a.items.saree, 180_000, lineAmount(1000, 180_000)],
  ]);
  expect(o.total.minor).toBe(lineAmount(2000, 24_000) + lineAmount(1000, 180_000)); // no offer discount
  expect(o.offerCode).toBe("FESTIVE10");
  expect(o.message).toContain("to be checked at the shop");
  expect(o.lines[0]?.price.ref).toMatch(/^⟨snap:/);
  const again = await send(api.order, "/orders", {}, body, { headers: { "idempotency-key": key } });
  expect(await again.text()).toBe(firstText);
  const stored = await q<{ code: string; channel: string; state: string }>("select code, channel, state from ops.order_request where tenant_id = $1", [w.a.tenantId]);
  expect(stored).toEqual([{ code: o.code, channel: "site", state: "new" }]);
  const other = await send(api.order, "/orders", {}, { ...body, lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] }, { headers: { "idempotency-key": key } });
  expect(other.status).toBe(409);

  // The status page under its code: received, no steps yet; no amount, no person.
  const status = await call(api.orderStatus, `${A()}/orders/${o.code}`, { slug: w.a.slug, code: o.code });
  expect(status.status).toBe(200);
  expect(status.headers.get("cache-control")).toBe("no-store");
  expect(OrderStatus.parse(await status.json())).toEqual({ code: o.code, request: "received", current: null, steps: [] });
  // Under another shop's slug the code names nothing: the one 404 (B verified for the call).
  await verify(w, w.b.tenantId);
  const elsewhere = await call(api.orderStatus, `/api/v1/sites/${w.b.slug}/orders/${o.code}`, { slug: w.b.slug, code: o.code });
  expect(await elsewhere.text()).toBe(NOT_FOUND);
  await verify(w, w.b.tenantId, false);
});

test("API order: a service, an item not published, or another tenant's branch is invalid", async () => {
  for (const [lines, shopId, field] of [
    [[{ itemId: w.a.items.haircut, qtyMilli: 1000 }], w.a.shopId, "lines"],
    [[{ itemId: w.b.items.rice, qtyMilli: 1000 }], w.a.shopId, "lines.0.itemId"],
    [[{ itemId: w.a.items.tea, qtyMilli: 1000 }], w.b.shopId, "shopId"],
  ] as const) {
    const r = await send(api.order, "/orders", {}, { shopId, channel: "widget", lines });
    expect(r.status, field).toBe(400);
    expect(await errorOf(r)).toMatchObject({ code: "invalid", fields: [field] });
  }
});

test("413 over 4 KB, 415 for anything but JSON, 400 for malformed JSON, an unknown field or a malformed key", async () => {
  const body = { ...person, shopId: w.a.shopId, message: "x" };
  const big = await send(api.enquire, "/enquiries", {}, undefined, { raw: JSON.stringify({ ...body, message: "y".repeat(5000) }) });
  expect(big.status).toBe(413);
  expect((await errorOf(big)).code).toBe("payload_too_large");
  const plain = await send(api.enquire, "/enquiries", {}, undefined, { raw: JSON.stringify(body), headers: { "content-type": "text/plain" } });
  expect(plain.status).toBe(415);
  const broken = await send(api.enquire, "/enquiries", {}, undefined, { raw: "{not json" });
  expect(await errorOf(broken)).toMatchObject({ code: "invalid" });
  const extra = await send(api.enquire, "/enquiries", {}, { ...body, admin: true });
  expect(extra.status).toBe(400);
  expect((await errorOf(extra)).code).toBe("invalid");
  const badKey = await send(api.enquire, "/enquiries", {}, body, { headers: { "idempotency-key": "short" } });
  expect(await errorOf(badKey)).toMatchObject({ code: "invalid", fields: ["Idempotency-Key"] });
  const noKey = await call(api.enquire, `${A()}/enquiries`, { slug: w.a.slug }, { body, ip: freshIp(), headers: { authorization: `Bearer ${w.a.key}`, origin: w.a.origin } });
  expect(await errorOf(noKey)).toMatchObject({ code: "idempotency_key_required" });
  // The body never reaches an error: no value of it in any answer above.
  for (const r of [big, plain, broken, extra, badKey]) expect(r.headers.get("access-control-allow-origin")).toBe(w.a.origin);
});

test("the sixth write from one IP in ten minutes is 429 with Retry-After", async () => {
  const body = { ...person, shopId: w.a.shopId, message: "Hello" };
  const ip = "198.18.7.7";
  const codes: number[] = [];
  for (let i = 0; i < 5; i++) codes.push((await send(api.enquire, "/enquiries", {}, body, { ip })).status);
  expect(codes).toEqual([202, 202, 202, 202, 202]);
  const last = await send(api.enquire, "/enquiries", {}, body, { ip });
  expect(last.status).toBe(429);
  expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await errorOf(last)).code).toBe("rate_limited");
});

test("paused intake answers 503 intake_paused to a POST while GETs still work", async () => {
  await withTx(w.db.app, { kind: "member", session: w.a.owner }, (c) => c.query(`update ops.site set intake = 'paused' where id = $1`, [w.a.siteId]));
  try {
    const r = await send(api.enquire, "/enquiries", {}, { ...person, shopId: w.a.shopId, message: "Open?" });
    expect(r.status).toBe(503);
    expect((await errorOf(r)).code).toBe("intake_paused");
    const o = await send(api.order, "/orders", {}, { shopId: w.a.shopId, channel: "site", lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] });
    expect(o.status).toBe(503);
    const site = await call(api.site, A(), { slug: w.a.slug }, { ip: freshIp() });
    expect(site.status).toBe(200);
    expect(((await site.json()) as { intake: string }).intake).toBe("paused");
  } finally {
    await withTx(w.db.app, { kind: "member", session: w.a.owner }, (c) => c.query(`update ops.site set intake = 'open' where id = $1`, [w.a.siteId]));
  }
});

test("the public routes write ops rows only: a scripted run of every write leaves books, snap, audit and approval row counts unchanged", async () => {
  const ops = async () =>
    (
      await q<Record<string, number>>(
        `select (select count(*) from ops.booking where tenant_id = $1)::int as bookings, (select count(*) from ops.booking_contact where tenant_id = $1)::int as contacts,
                (select count(*) from ops.site_request where tenant_id = $1)::int as requests, (select count(*) from ops.reservation where tenant_id = $1)::int as reservations,
                (select count(*) from ops.order_request where tenant_id = $1)::int as orders, (select count(*) from ops.idempotency where tenant_id = $1 and scope like 'site:%')::int as keys`,
        [w.a.tenantId],
      )
    )[0] as Record<string, number>;
  const books0 = await booksCounts(w.db);
  const ops0 = await ops();
  // The script: a hold and its booking, a release of another hold, an enquiry, a piece asked for, an order.
  const held = HoldCreated.parse(await (await send(api.hold, "/holds", {}, await slot(20), { headers: holdHeaders("device-token-for-the-s4-run-01") })).json());
  expect((await send(api.book, "/bookings", {}, { ...person, holdId: held.holdId, holdToken: held.holdToken })).status).toBe(202);
  const other = HoldCreated.parse(await (await send(api.hold, "/holds", {}, await slot(24), { headers: holdHeaders("device-token-for-the-s4-run-02") })).json());
  const released = await call(api.releaseHold, `${A()}/holds/${other.holdId}`, { slug: w.a.slug, id: other.holdId }, { method: "DELETE", ip: freshIp(), headers: writeHeaders(w.a, { "x-hold-token": other.holdToken }) });
  expect(released.status).toBe(200);
  expect((await send(api.enquire, "/enquiries", {}, { ...person, shopId: w.a.shopId, message: "Open on Sunday?" })).status).toBe(202);
  const piece = { itemId: w.a.items.saree, qtyMilli: 1000, name: "Asha", phone: "+919800000001", noticeVersion: "v1", consentVersion: "v1", botToken: "t", website: "" };
  expect((await send(api.reserve, "/reservations", {}, piece)).status).toBe(202);
  expect((await send(api.order, "/orders", {}, { shopId: w.a.shopId, channel: "site", lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] })).status).toBe(201);

  const books1 = await booksCounts(w.db);
  expect(Object.keys(books1).length).toBeGreaterThan(30);
  expect(books1).toEqual(books0);
  expect(books1).toEqual(before); // and across the whole file's run
  const ops1 = await ops();
  expect(Object.fromEntries(Object.keys(ops1).map((k) => [k, (ops1[k] as number) - (ops0[k] as number)]))).toEqual({
    bookings: 2,
    contacts: 1,
    requests: 1,
    reservations: 1,
    orders: 1,
    keys: 7,
  });
});

test("API order: with orders switched off in the release, the route is not there (404)", async () => {
  await switchCapability(w.db.app, w.a.owner, "cart", false).catch(() => undefined);
  await switchCapability(w.db.app, w.a.owner, "orders", false);
  await publish(w.db, w.a.tenantId, w.a.siteId);
  const r = await send(api.order, "/orders", {}, { shopId: w.a.shopId, channel: "site", lines: [{ itemId: w.a.items.tea, qtyMilli: 1000 }] });
  expect(r.status).toBe(404);
  expect(await r.text()).toBe(NOT_FOUND);
});
