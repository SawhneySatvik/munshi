// GET /sites/{slug}/slots (BLUEPRINT §5.1, §8.8): free start times for one day, each naming the roster row it comes
// from, so the slot is recomputable (SLOT1). Slot times are roster times, not book figures (decision 14). One day is one
// document, not a cursor list: a shop's day is bounded by its stylists and the 15-minute grid.
import { z } from 'zod';
import { Id, IsoDate, Timestamp } from './common.ts';

export const ShiftRel = z.enum(['books.shift_pattern', 'books.shift_change']);
export const SlotsQuery = z.strictObject({ shop: Id, service: Id, date: IsoDate, stylist: Id.optional() });
export const Slot = z.strictObject({ stylistId: Id, start: Timestamp, shiftRel: ShiftRel, shiftId: Id });
export const Slots = z.strictObject({ date: IsoDate, shopId: Id, serviceId: Id, slots: z.array(Slot).max(2000) });
