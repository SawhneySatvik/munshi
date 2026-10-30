// The Munshi SDK (BLUEPRINT §5.6): a thin typed fetch client for API v1. No runtime dependencies; the types are generated
// from @munshi/contracts (schema.gen.ts), and each method's path is checked against them at compile time. Every figure
// it returns is a snapshot cell with its ref, and one that cannot be traced renders "Cannot verify". The key travels only
// in the Authorization header of a write; nothing here logs.
import type * as T from './schema.gen.ts';

export type * from './schema.gen.ts';
export { CANNOT_VERIFY, formatMoney, isRef } from './money.ts';
import { CANNOT_VERIFY, REF } from './money.ts';

type Ops = T.Operations;
type Params = Record<string, string | number>;
type Query = Record<string, string | number | undefined>;
export type WriteOptions = { idempotencyKey?: string };

// Every §5.3 code; the type makes the list complete and exact.
const CODES: Record<T.ErrorCode, true> = {
  invalid: true,
  idempotency_key_required: true,
  stale_notice: true,
  bot_check: true,
  unauthenticated: true,
  not_found: true,
  slot_taken: true,
  idempotency_mismatch: true,
  gone: true,
  payload_too_large: true,
  unsupported_media_type: true,
  rate_limited: true,
  hold_limit: true,
  intake_paused: true,
  internal: true,
};
const FIELD = /^[A-Za-z0-9_.-]{1,100}$/;
const KEY = /^mpk_[a-z][a-z0-9-]{2,39}_[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,128}$/;

// A §5.3 code, the HTTP status and the request id; never the server's text, so nothing a server or proxy wrote reaches a
// page or a log through it.
export class MunshiError extends Error {
  readonly status: number;
  readonly code: T.ErrorCode;
  readonly requestId: string | null;
  readonly fields: string[];
  constructor(status: number, code: T.ErrorCode, requestId: string | null, fields: string[] = []) {
    super(`Munshi API error ${code} (HTTP ${status})`);
    this.name = 'MunshiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.fields = fields;
  }
}

// 32 random bytes as 43 base64url characters. getRandomValues, not randomUUID, which a page outside a secure context
// (a plain-http demo page) does not have.
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// One per form render: a retry with the same key replays the first answer instead of writing twice (§5.4).
export function newIdempotencyKey(): string {
  return randomToken();
}

// The device token caps one live hold per browser (HOLD1): kept in localStorage where there is one, else per client.
function deviceStore(): () => string {
  let memory: string | undefined;
  return () => {
    try {
      const stored = globalThis.localStorage?.getItem('munshi.device');
      if (stored) return stored;
      const made = randomToken();
      globalThis.localStorage?.setItem('munshi.device', made);
      if (globalThis.localStorage) return made;
    } catch {
      // storage refused (a private window): fall back to memory
    }
    memory ??= randomToken();
    return memory;
  };
}

export function createClient(options: { baseUrl: string; key?: string }) {
  const base = `${options.baseUrl.replace(/\/+$/, '')}/api/v1`;
  const key = options.key;
  // Said without the value: a key never reaches an error, a log or a URL.
  if (key !== undefined && !KEY.test(key)) throw new Error('createClient: key is not a publishable key (mpk_<slug>_…)');
  const device = deviceStore();

  async function send(method: string, path: string, params: Params, query: Query | undefined, headers: Record<string, string>, body?: unknown) {
    let url = `${base}${path.replace(/\{([a-z]+)\}/g, (_, name: string) => {
      const value = params[name];
      if (value === undefined) throw new Error(`munshi: missing path parameter ${name}`);
      return encodeURIComponent(String(value));
    })}`;
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) search.set(k, String(v));
    // toString, not .size: URLSearchParams.size is missing before Safari 17, and every query would be dropped.
    const qs = search.toString();
    if (qs) url += `?${qs}`;
    const init: RequestInit = { method, headers: { accept: 'application/json', ...headers }, credentials: 'omit' };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
    const res = await fetch(url, init);
    const requestId = res.headers.get('x-request-id');
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    if (!res.ok || data === undefined) throw toError(res.status, data, requestId);
    return data;
  }

  const get = <K extends keyof Ops>(path: Ops[K]['path'], params: Params, query?: Query) =>
    send('GET', path, params, query, {}) as Promise<Ops[K]['response']>;

  function write<K extends keyof Ops>(method: Ops[K]['method'], path: Ops[K]['path'], params: Params, body: Ops[K]['body'], options: WriteOptions, extra: Record<string, string> = {}) {
    if (key === undefined) throw new Error('munshi: this call needs the publishable key of the site');
    const idempotencyKey = options.idempotencyKey ?? newIdempotencyKey();
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error('munshi: an Idempotency-Key is 8–128 of A–Z a–z 0–9 _ -');
    const headers = { authorization: `Bearer ${key}`, 'idempotency-key': idempotencyKey, ...extra };
    return send(method, path, params, undefined, headers, body) as Promise<Ops[K]['response']>;
  }

  return {
    site: (slug: string) => get<'site'>('/sites/{slug}', { slug }),
    catalogue: (slug: string, query: T.CatalogueQuery = {}) => get<'catalogue'>('/sites/{slug}/catalogue', { slug }, query),
    services: (slug: string, query: T.ListQuery = {}) => get<'services'>('/sites/{slug}/services', { slug }, query),
    packages: (slug: string, query: T.ListQuery = {}) => get<'packages'>('/sites/{slug}/packages', { slug }, query),
    offers: (slug: string, query: T.ListQuery = {}) => get<'offers'>('/sites/{slug}/offers', { slug }, query),
    stylists: (slug: string, query: T.StylistsQuery = {}) => get<'stylists'>('/sites/{slug}/stylists', { slug }, query),
    slots: (slug: string, query: T.SlotsQuery) => get<'slots'>('/sites/{slug}/slots', { slug }, query),
    // A ref that does not parse is answered here, without a request: it cannot trace to a cell.
    ref: async (slug: string, ref: string): Promise<T.RefAnswer> => {
      const m = REF.exec(ref);
      if (!m) return { verified: false, label: CANNOT_VERIFY };
      return get<'ref'>('/sites/{slug}/refs/{snapshot}/{row}/{col}', { slug, snapshot: m[1] as string, row: m[2] as string, col: m[3] as string });
    },
    orderStatus: (slug: string, code: string) => get<'orderStatus'>('/sites/{slug}/orders/{code}', { slug, code }),
    hold: (slug: string, body: T.HoldBody, options: WriteOptions = {}) =>
      write<'hold'>('POST', '/sites/{slug}/holds', { slug }, body, options, { 'x-munshi-device': device() }),
    releaseHold: (slug: string, holdId: string, holdToken: string, options: WriteOptions = {}) =>
      write<'releaseHold'>('DELETE', '/sites/{slug}/holds/{id}', { slug, id: holdId }, undefined, options, { 'x-hold-token': holdToken }),
    book: (slug: string, body: T.BookingBody, options: WriteOptions = {}) => write<'book'>('POST', '/sites/{slug}/bookings', { slug }, body, options),
    requestBooking: (slug: string, body: T.BookingRequestBody, options: WriteOptions = {}) =>
      write<'requestBooking'>('POST', '/sites/{slug}/booking-requests', { slug }, body, options),
    enquire: (slug: string, body: T.EnquiryBody, options: WriteOptions = {}) => write<'enquire'>('POST', '/sites/{slug}/enquiries', { slug }, body, options),
    reserve: (slug: string, body: T.ReservationBody, options: WriteOptions = {}) =>
      write<'reserve'>('POST', '/sites/{slug}/reservations', { slug }, body, options),
    order: (slug: string, body: T.OrderBody, options: WriteOptions = {}) => write<'order'>('POST', '/sites/{slug}/orders', { slug }, body, options),
  };
}

export type Client = ReturnType<typeof createClient>;

function toError(status: number, data: unknown, header: string | null): MunshiError {
  const e = (data as { error?: { code?: unknown; requestId?: unknown; fields?: unknown } } | undefined)?.error;
  // A body that is not the §5.3 shape (a proxy's page, an unknown code) is internal, and none of its text is kept.
  const known = typeof e?.code === 'string' && Object.hasOwn(CODES, e.code);
  const id = known && typeof e?.requestId === 'string' ? e.requestId : header;
  const fields = known && Array.isArray(e?.fields) ? e.fields.filter((f): f is string => typeof f === 'string' && FIELD.test(f)) : [];
  return new MunshiError(status, known ? (e?.code as T.ErrorCode) : 'internal', id !== null && REQUEST_ID.test(id) ? id : null, fields);
}
