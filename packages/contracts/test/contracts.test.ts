// The rules of API v1 the contracts carry, and the SQL's limits (db/schema/14_sites_public.sql, 21_orders.sql).
// Red-proofs: db/test/v2/sabotage/core-contracts.ts.
import { expect, it } from 'vitest';
import type { z } from 'zod';
import {
  BookingBody,
  BookingRequestBody,
  buildOpenApi,
  ERRORS,
  ErrorBody,
  ErrorCode,
  EnquiryBody,
  HoldToken,
  IdempotencyKey,
  Id,
  Limit,
  Look,
  OrderBody,
  OrderCode,
  Ref,
  ReservationBody,
  type RouteDef,
  routes,
  Slug,
  Version,
} from '../src/index.ts';

const table = Object.entries(routes) as [string, RouteDef][];
const ID = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b';
const REF = `⟨snap:${ID}·12·price⟩`;
const ok = (s: z.ZodType, v: unknown) => s.safeParse(v).success;
type Shape = { shape: Record<string, z.ZodType> };

it('every error answers the one body, its message fixed per code, never a database message or a value', () => {
  expect(ErrorCode.options).toEqual(Object.keys(ERRORS));
  for (const [code, { message }] of Object.entries(ERRORS)) {
    const body = { error: { code, message, fields: ['lines.0.qtyMilli'], requestId: 'bom1::req-1' } };
    expect(ok(ErrorBody, body)).toBe(true);
    expect(ok(ErrorBody, { error: { ...body.error, message: 'duplicate key value violates unique constraint "order_code"' } })).toBe(false);
    expect(ok(ErrorBody, { error: { ...body.error, fields: ['+910000000000 is not a mobile'] } })).toBe(false);
    expect(ok(ErrorBody, { error: { ...body.error, detail: 'x' } })).toBe(false);
  }
  const doc = buildOpenApi() as { paths: Record<string, Record<string, { operationId: string; responses: Record<string, Record<string, unknown>> }>> };
  let errorResponses = 0;
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      const route = routes[op.operationId as keyof typeof routes] as RouteDef;
      for (const [status, response] of Object.entries(op.responses)) {
        if (status.startsWith('2')) continue;
        errorResponses++;
        expect((response.content as Record<string, { schema: unknown }>)['application/json']?.schema).toEqual({ $ref: '#/components/schemas/ErrorBody' });
        const codes = response['x-munshi-error-codes'] as (keyof typeof ERRORS)[];
        for (const code of codes) expect([op.operationId, ERRORS[code].status]).toEqual([op.operationId, Number(status)]);
        expect(codes.every((c) => route.errors.includes(c))).toBe(true);
      }
      expect(route.errors).toContain('internal');
    }
  }
  expect(errorResponses).toBeGreaterThan(table.length * 2);
});

it('every POST and DELETE requires Idempotency-Key, 8 to 128 of A-Z a-z 0-9 _ -, and no GET takes one', () => {
  const writes = table.filter(([, r]) => r.method !== 'GET');
  expect(writes.map(([id]) => id).sort()).toEqual(['book', 'enquire', 'hold', 'order', 'proposeDraft', 'releaseHold', 'requestBooking', 'reserve']);
  for (const [id, r] of table) {
    const header = (r.headers as unknown as Shape | undefined)?.shape['Idempotency-Key'];
    if (r.method === 'GET') expect([id, header]).toEqual([id, undefined]);
    else expect([id, header]).toEqual([id, IdempotencyKey]);
  }
  for (const good of ['abcdEFG8', 'a'.repeat(128), 'form-render_01', crypto.randomUUID()]) expect(ok(IdempotencyKey, good)).toBe(true);
  for (const bad of ['abcdEF7', 'a'.repeat(129), 'has space1', 'semi;colon1', '']) expect(ok(IdempotencyKey, bad)).toBe(false);
});

it('published reads take no key, the public writes take the publishable key, the secret-key routes are deferred', () => {
  const doc = buildOpenApi() as { components: { securitySchemes: Record<string, Record<string, unknown>> }; paths: Record<string, Record<string, { operationId: string; security: unknown }>> };
  expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['publishableKey', 'secretKey']);
  expect(doc.components.securitySchemes.publishableKey).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'mpk_<slug>_<43 base64url characters>' });
  expect(doc.components.securitySchemes.secretKey).toMatchObject({ type: 'http', scheme: 'bearer', 'x-munshi-deferred': true });
  for (const [id, r] of table) {
    const expected = r.path.startsWith('/sites/') ? (r.method === 'GET' ? 'none' : 'publishable') : 'secret';
    expect([id, r.auth, r.deferred]).toEqual([id, expected, expected === 'secret']);
  }
  for (const item of Object.values(doc.paths)) {
    for (const op of Object.values(item)) {
      const r = routes[op.operationId as keyof typeof routes] as RouteDef;
      const security = { none: [], publishable: [{ publishableKey: [] }], secret: [{ secretKey: [] }] }[r.auth];
      expect([op.operationId, op.security]).toEqual([op.operationId, security]);
    }
  }
});

it('every list answers a cursor page and takes cursor and limit, at most 100', () => {
  const lists = table.filter(([, r]) => r.query && 'limit' in (r.query as unknown as Shape).shape);
  expect(lists.map(([id]) => id).sort()).toEqual(['catalogue', 'drafts', 'findings', 'offers', 'packages', 'services', 'stylists']);
  for (const [id, r] of lists) {
    const page = (r.response as unknown as Shape).shape;
    expect([id, Object.keys(page)]).toEqual([id, ['data', 'next']]);
    expect(ok(r.response as z.ZodType, { data: [], next: null })).toBe(true);
    expect(ok(r.response as z.ZodType, { data: [], next: 'eyJrIjoiYiJ9' })).toBe(true);
    expect(ok(r.response as z.ZodType, { data: [] })).toBe(false);
    expect((r.query as unknown as Shape).shape.cursor?.safeParse(undefined).success).toBe(true);
  }
  expect(Limit.parse('1')).toBe(1);
  expect(Limit.parse('100')).toBe(100);
  for (const bad of ['0', '101', '500', '2.5', 'ten']) expect(ok(Limit, bad)).toBe(false);
});

it('every params, query, header and body schema refuses an unknown field', () => {
  let parts = 0;
  for (const [id, r] of table) {
    for (const part of [r.params, r.query, r.headers, r.body]) {
      if (!part) continue;
      parts++;
      const issues = part.safeParse({ notInTheContract: 'x' }).error?.issues ?? [];
      expect([id, issues.some((i) => i.code === 'unrecognized_keys')]).toEqual([id, true]);
    }
  }
  expect(parts).toBeGreaterThan(table.length);
});

it("the contract's limits are the SQL's", () => {
  const base = {
    holdId: ID,
    holdToken: 'A'.repeat(43),
    name: 'Asha',
    phone: '+91 98765 43210',
    whatsappUpdates: false,
    noticeVersion: 'v1',
    consentVersion: 'v1',
    botToken: 't',
    website: '',
  };
  expect(ok(BookingBody, base)).toBe(true);
  expect(ok(BookingBody, { ...base, name: 'n'.repeat(80), note: 'n'.repeat(500) })).toBe(true);
  expect(ok(BookingBody, { ...base, name: 'n'.repeat(81) })).toBe(false); // contact_name between 1 and 80
  expect(ok(BookingBody, { ...base, name: '' })).toBe(false);
  expect(ok(BookingBody, { ...base, note: 'n'.repeat(501) })).toBe(false); // note <= 500
  expect(ok(BookingBody, { ...base, website: undefined })).toBe(false); // the honeypot is declared, so a bot's fill is a 202
  expect(ok(BookingBody, { ...base, phone: 'call me' })).toBe(false);

  const { holdId: _holdId, holdToken: _holdToken, ...contact } = base;
  const request = { ...contact, shopId: ID, serviceIds: [ID], preferredOn: '2026-11-02', timeWindow: 'evening' };
  expect(ok(BookingRequestBody, request)).toBe(true);
  expect(ok(BookingRequestBody, { ...request, serviceIds: [ID, ID, ID] })).toBe(true);
  expect(ok(BookingRequestBody, { ...request, serviceIds: [ID, ID, ID, ID] })).toBe(false); // item_ids <= 3
  expect(ok(BookingRequestBody, { ...request, serviceIds: [] })).toBe(false);
  expect(ok(BookingRequestBody, { ...request, timeWindow: 'night' })).toBe(false);
  const { serviceIds: _s, preferredOn: _p, timeWindow: _t, ...enquiry } = request;
  expect(ok(EnquiryBody, { ...enquiry, message: 'm'.repeat(500) })).toBe(true);
  expect(ok(EnquiryBody, { ...enquiry, message: 'm'.repeat(501) })).toBe(false);
  expect(ok(EnquiryBody, { ...enquiry, message: '' })).toBe(false);
  expect(ok(ReservationBody, { ...enquiry, shopId: undefined, whatsappUpdates: undefined, itemId: ID, qtyMilli: 1000 })).toBe(false); // strict
  const { shopId: _shop, whatsappUpdates: _wa, ...person } = enquiry;
  expect(ok(ReservationBody, { ...person, itemId: ID, qtyMilli: 1000 })).toBe(true);
  expect(ok(ReservationBody, { ...person, itemId: ID })).toBe(false); // qty_milli is not null

  const line = { itemId: ID, qtyMilli: 2000 };
  const order = { shopId: ID, channel: 'site', lines: [line] };
  expect(ok(OrderBody, { ...order, lines: Array(20).fill(line), offerCode: 'DIWALI10' })).toBe(true);
  expect(ok(OrderBody, { ...order, lines: Array(21).fill(line) })).toBe(false); // lines between 1 and 20
  expect(ok(OrderBody, { ...order, lines: [] })).toBe(false);
  for (const qtyMilli of [0, 1.5, 1_000_000_001, -1000]) expect(ok(OrderBody, { ...order, lines: [{ ...line, qtyMilli }] })).toBe(false);
  expect(ok(OrderBody, { ...order, lines: [{ ...line, qtyMilli: 1_000_000_000 }] })).toBe(true);
  for (const offerCode of ['diwali10', 'ABC', 'A'.repeat(17), 'DIWALI-10']) expect(ok(OrderBody, { ...order, offerCode })).toBe(false); // ^[A-Z0-9]{4,16}$
  expect(ok(OrderBody, { ...order, channel: 'whatsapp' })).toBe(false); // a release-priced cart is site or widget
  expect(ok(OrderBody, { ...order, total: 4998 })).toBe(false); // a client's total is never read

  for (const code of ['ORD-7K2Q', 'ORD-7K2Q9X']) expect(ok(OrderCode, code)).toBe(true);
  for (const code of ['ORD-7K2', 'ORD-7K2Q9XY', 'ord-7k2q', 'ORD7K2Q']) expect(ok(OrderCode, code)).toBe(false);
  expect(ok(Version, 'v'.repeat(40))).toBe(true);
  for (const v of ['v'.repeat(41), 'V1', 'v 1']) expect(ok(Version, v)).toBe(false);
  for (const s of ['elite', 'suit-shop']) expect(ok(Slug, s)).toBe(true);
  for (const s of ['ab', '1elite', 'Elite', 'e'.repeat(41)]) expect(ok(Slug, s)).toBe(false);
  expect(ok(Id, ID)).toBe(true);
  for (const id of [ID.toUpperCase(), 'not-an-id', `${ID}0`]) expect(ok(Id, id)).toBe(false);
  expect(ok(Ref, REF)).toBe(true);
  for (const r of [`⟨snap:${ID}·12·Price⟩`, `⟨snap:${ID}·1234567·price⟩`, `snap:${ID}·12·price`]) expect(ok(Ref, r)).toBe(false);
  expect(ok(HoldToken, 'A'.repeat(43))).toBe(true);
  expect(ok(HoldToken, 'A'.repeat(42))).toBe(false);

  const look = { tokens: { '--accent': '#1a2b3c', '--radius-card': '12px' }, fontPair: 'serif_sans', profile: {}, art: {} };
  expect(ok(Look, look)).toBe(true);
  expect(ok(Look, { ...look, tokens: { light: look.tokens, dark: look.tokens } })).toBe(true);
  expect(ok(Look, { ...look, tokens: { '--accent': '#1A2B3C' } })).toBe(false); // colours ^#[0-9a-f]{6}$
  expect(ok(Look, { ...look, tokens: { '--radius-card': 'url(x)' } })).toBe(false); // no bracket, colon or semicolon
  expect(ok(Look, { ...look, tokens: { '--shadow': '0' } })).toBe(false); // only the fixed names
  expect(ok(Look, { ...look, art: { hero: 'https://elsewhere.example/a.svg' } })).toBe(false); // art is the media route
});
