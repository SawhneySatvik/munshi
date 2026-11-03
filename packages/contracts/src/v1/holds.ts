// POST /sites/{slug}/holds and DELETE /sites/{slug}/holds/{id}: ten minutes on a stylist's calendar (ops.booking,
// held). A hold moves only with its token, which travels in a header or the booking's body, never a URL.
import { z } from 'zod';
import { BotToken, Id, IdempotencyKey, Slug, Timestamp } from './common.ts';
import { ShiftRel } from './slots.ts';

export const HoldToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
// The random token the SDK keeps in the browser; its hash caps one live hold per device.
export const DeviceToken = z.string().regex(/^[A-Za-z0-9_-]{22,128}$/);
export const HoldHeaders = z.strictObject({ 'Idempotency-Key': IdempotencyKey, 'X-Munshi-Device': DeviceToken });
export const HoldBody = z.strictObject({
  shopId: Id,
  stylistId: Id,
  serviceId: Id,
  start: Timestamp,
  shiftRel: ShiftRel,
  shiftId: Id,
  botToken: BotToken,
});
export const HoldCreated = z.strictObject({ holdId: Id, holdToken: HoldToken, expiresAt: Timestamp });
export const HoldParams = z.strictObject({ slug: Slug, id: Id });
export const ReleaseHoldHeaders = z.strictObject({ 'Idempotency-Key': IdempotencyKey, 'X-Hold-Token': HoldToken });
export const HoldReleased = z.strictObject({ holdId: Id, released: z.literal(true) });
