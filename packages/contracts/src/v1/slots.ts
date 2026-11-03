// GET /sites/{slug}/slots: free start times for one day, each naming the roster row it comes from, so the slot is
// recomputable. Slot times are roster times, not book figures, so they carry no ref. One day is one document, not a
// cursor list: a shop's day is bounded by its stylists and the 15-minute grid.
import { z } from 'zod';
import { Id, IsoDate, Timestamp } from './common.ts';

export const ShiftRel = z.enum(['books.shift_pattern', 'books.shift_change']);
export const SlotsQuery = z.strictObject({ shop: Id, service: Id, date: IsoDate, stylist: Id.optional() });
export const Slot = z.strictObject({ stylistId: Id, start: Timestamp, shiftRel: ShiftRel, shiftId: Id });
export const Slots = z.strictObject({ date: IsoDate, shopId: Id, serviceId: Id, slots: z.array(Slot).max(2000) });
