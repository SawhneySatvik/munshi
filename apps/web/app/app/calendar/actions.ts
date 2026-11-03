"use server";

// A booking made at the desk: a walk-in or a phone call, booked by an owner or manager for a free slot
// the roster offers, confirmed in one step (source app). It is an ops row (core's bookAtDesk), not a book: it carries
// no idempotency claim, but the form still needs its key, and the exclusion constraint makes a double booking
// impossible whatever is posted twice (the second is refused as taken).
import { bookAtDesk } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { UUID } from "../../../lib/parse";

// The roster row a slot came from, as core's slot read named it: passed through as the token it is, and checked by core's
// own input schema (one of its two roster relations) and by the database against the booking.
type ShiftRel = Parameters<typeof bookAtDesk>[2]["shiftRel"];

export async function bookDeskAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/calendar", async (session) => {
    const shopId = idOf(form, "shop");
    const serviceItemId = idOf(form, "service");
    const customerId = idOf(form, "customer");
    const [staffId, start, shiftRel, shiftId] = field(form, "slot").split("|");
    if (!shopId || !serviceItemId || !staffId || !UUID.test(staffId) || !shiftId || !UUID.test(shiftId) || !start) return invalid();
    if (!shiftRel) return invalid();
    await bookAtDesk(await appPool(), session, { shopId, staffId, serviceItemId, start, shiftRel: shiftRel as ShiftRel, shiftId, ...(customerId ? { customerId } : {}) });
    return undefined;
  });
}
