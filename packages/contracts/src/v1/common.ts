// Shared shapes of API v1. Every export of a v1 schema module is a zod schema and becomes an OpenAPI component under
// its export name (schemas.ts), so this file exports nothing else.
//
// The figures, so every number shown traces to a ledger row: a number in a response exists only inside one of four
// shapes, each saying where its digits came from: a published snapshot cell (MoneyFigure, IntFigure, with `ref`), a
// code-derived sum of cells (DerivedMoney, with the refs it came from), or the caller's own number echoed back
// (RequestedQty, orders.ts). src/figures.ts refuses a number anywhere else in a response, and the generator will not
// write one.
import { z } from 'zod';
import { ERRORS } from './errors.ts';

// The SQL's id check (lowercase hex, any version), not z.uuid(), which checks RFC version bits the database does not.
export const Id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const Slug = z.string().regex(/^[a-z][a-z0-9-]{2,39}$/);
// Core's parseRef grammar exactly (packages/core/src/read.ts): ⟨snap:ID·row·col⟩.
export const Ref = z
  .string()
  .regex(/^⟨snap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}·[0-9]{1,6}·[a-z_][a-z0-9_]{0,62}⟩$/);
export const Currency = z.string().regex(/^[A-Z]{3}$/);
export const Timestamp = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();
export const OfferCode = z.string().regex(/^[A-Z0-9]{4,16}$/);
export const OrderCode = z.string().regex(/^ORD-[A-Z0-9]{4,6}$/);

export const MoneyFigure = z.strictObject({ minor: z.int().min(0), currency: Currency, ref: Ref });
export const IntFigure = z.strictObject({ value: z.int().min(0), ref: Ref });
// A site order's line amounts and total: computed by code with the counter's line function from published price
// cells, never by a model, never stored, recomputable from the request's stored release and lines.
export const DerivedMoney = z.strictObject({ minor: z.int().min(0), currency: Currency, from: z.array(Ref).min(1).max(20) });
export const TextCell = z.strictObject({ text: z.string().max(500), ref: Ref });
export const DateCell = z.strictObject({ date: IsoDate, ref: Ref });
export const TimestampCell = z.strictObject({ at: Timestamp, ref: Ref });

export const Version = z.string().regex(/^[a-z0-9_.-]{1,40}$/);
export const PersonName = z.string().min(1).max(80);
export const Phone = z.string().regex(/^\+?[0-9][0-9 ()-]{6,22}[0-9]$/);
export const Note = z.string().max(500);
export const BotToken = z.string().min(1).max(2048);
// The form's hidden field: a filled one is answered 202 and stored nowhere, so it takes any short string.
export const Honeypot = z.string().max(500);
export const TimeWindow = z.enum(['morning', 'afternoon', 'evening']);
export const MediaPath = z
  .string()
  .regex(/^\/api\/v1\/sites\/[a-z][a-z0-9-]{2,39}\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|svg)$/);

export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const Cursor = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
// Query strings arrive as text; an integer parameter is coerced, then range-checked (default 50, applied by the route).
export const Limit = z.coerce.number().int().min(1).max(100);
export const ListQuery = z.strictObject({ cursor: Cursor.optional(), limit: Limit.optional() });

export const SlugParams = z.strictObject({ slug: Slug });
export const WriteHeaders = z.strictObject({ 'Idempotency-Key': IdempotencyKey });
export const Received = z.strictObject({ id: Id, received: z.literal(true) });

export const ErrorCode = z.enum([
  'invalid',
  'idempotency_key_required',
  'stale_notice',
  'bot_check',
  'unauthenticated',
  'not_found',
  'slot_taken',
  'idempotency_mismatch',
  'gone',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'hold_limit',
  'intake_paused',
  'internal',
]);

const Fields = z.array(z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/)).max(20);
const RequestId = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
// The explicit type argument keeps each code's message its own literal; inferred, it widens to every message.
const detail = <C extends keyof typeof ERRORS>(code: C) =>
  z.strictObject({
    code: z.literal(code),
    message: z.literal<(typeof ERRORS)[C]['message']>(ERRORS[code].message),
    fields: Fields,
    requestId: RequestId,
  });

export const ErrorDetail = z.discriminatedUnion('code', [
  detail('invalid'),
  detail('idempotency_key_required'),
  detail('stale_notice'),
  detail('bot_check'),
  detail('unauthenticated'),
  detail('not_found'),
  detail('slot_taken'),
  detail('idempotency_mismatch'),
  detail('gone'),
  detail('payload_too_large'),
  detail('unsupported_media_type'),
  detail('rate_limited'),
  detail('hold_limit'),
  detail('intake_paused'),
  detail('internal'),
]);
export const ErrorBody = z.strictObject({ error: ErrorDetail });
