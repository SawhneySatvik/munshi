"use server";

// A booking made at the desk (BLUEPRINT §8.8): a walk-in or a phone call, booked by an owner or manager for a free slot
// the roster offers, confirmed in one step (source app). It is an ops row (core's bookAtDesk), not a book: it carries
// no idempotency claim, but the form still needs its key, and the exclusion constraint makes a double booking
// impossible whatever is posted twice (the second is refused as taken).
import { bookAtDesk } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function bookDeskAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/calendar", async (session) => {
    const shopId = idOf(form, "shop");
    const serviceItemId = idOf(form, "service");
    const customerId = idOf(form, "customer");
    const [staffId, start, shiftRel, shiftId] = field(form, "slot").split("|");
    if (!shopId || !serviceItemId || !staffId || !UUID.test(staffId) || !shiftId || !UUID.test(shiftId) || !start) return invalid();
    if (shiftRel !== "books.shift_pattern" && shiftRel !== "books.shift_change") return invalid();
    await bookAtDesk(await appPool(), session, { shopId, staffId, serviceItemId, start, shiftRel, shiftId, ...(customerId ? { customerId } : {}) });
    return undefined;
  });
}
