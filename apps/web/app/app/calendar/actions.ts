"use server";

// A booking made at the desk: a walk-in or a phone call, booked by an owner or manager for a free slot
// the roster offers, confirmed in one step (source app). It is an ops row (core's bookAtDesk), not a book: it carries
// no idempotency claim, but the form still needs its key, and the exclusion constraint makes a double booking
// impossible whatever is posted twice (the second is refused as taken).
import { bookAtDesk, moveBooking } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { ActState } from "../../../lib/app-types";
import type { OpsError } from "../../../lib/ops-types";
import { act, dayOf, field, idOf, invalid, wholeOf } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { errorOf } from "../../../lib/server/ops";
import { type MoveAsk, type MoveRefusal, moveTarget } from "../../../lib/server/schedule";
import { sessionFrom } from "../../../lib/server/session";
import { UUID } from "../../../lib/parse";
import { confirmBookingAction, declineBookingAction } from "../requests/actions";

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

// A move from the schedule: a confirmed booking dropped on another stylist or time. The database lets a booking change
// only its state, so a move is two of the desk's own commands, as the signed-in owner or manager: book the free slot
// core offers there (bookAtDesk, for the same customer and service), then cancel the old booking (moveBooking).
// Booking first means a refused slot changes nothing. They are two transactions: if the cancel is refused after the new
// booking stands, the answer says so, and the old booking is cancelled by hand.
export type MoveState =
  | { error: OpsError | MoveRefusal }
  | { slot: { at: string } }
  | { moved: { bookingId: string } }
  | { half: { bookingId: string } }
  | null;

function askOf(form: FormData): MoveAsk | null {
  const bookingId = idOf(form, "booking");
  const shopId = idOf(form, "shop");
  const staffId = idOf(form, "staff");
  const day = dayOf(form, "day");
  const minute = wholeOf(form, "minute", 0, 24 * 60 - 1);
  if (!bookingId || !shopId || !staffId || !day || minute === null) return null;
  return { bookingId, shopId, staffId, day, minute };
}

/** A read: whether core offers the dropped slot. Nothing is written; the board keeps the move as proposed. */
export async function checkMoveAction(_prev: MoveState, form: FormData): Promise<MoveState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const ask = askOf(form);
  if (!ask) return { error: "invalid" };
  try {
    const target = await moveTarget(session, ask);
    return typeof target === "string" ? { error: target } : { slot: { at: target.slot.start.toISOString() } };
  } catch (err) {
    return { error: errorOf(err) };
  }
}

/** The person's own confirmation of a proposed move, under the form's key. */
export async function moveBookingAction(_prev: MoveState, form: FormData): Promise<MoveState> {
  let out: MoveState = null;
  const state = await act(form, "/app/calendar", async (session) => {
    const ask = askOf(form);
    if (!ask) return invalid();
    const target = await moveTarget(session, ask);
    if (typeof target === "string") {
      out = { error: target };
      return undefined;
    }
    const pool = await appPool();
    const { slot } = target;
    const made = await bookAtDesk(pool, session, {
      shopId: target.shopId,
      staffId: slot.staffId,
      serviceItemId: target.serviceItemId,
      start: slot.start.toISOString(),
      shiftRel: slot.shiftRel,
      shiftId: slot.shiftId,
      ...(target.customerId ? { customerId: target.customerId } : {}),
    });
    try {
      await moveBooking(pool, session, { bookingId: target.bookingId, state: "cancelled" });
    } catch {
      out = { half: { bookingId: made.bookingId } };
      return undefined;
    }
    out = { moved: { bookingId: made.bookingId } };
    return undefined;
  });
  return state && "error" in state ? { error: state.error } : out;
}

// A confirmed booking cancelled from the schedule: the desk's own ops move (core's moveBooking), which the database
// allows only an active owner or manager. The customer is not messaged.
export async function cancelBookingAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/calendar", async (session) => {
    const bookingId = idOf(form, "booking");
    if (!bookingId) return invalid();
    await moveBooking(await appPool(), session, { bookingId, state: "cancelled" });
    return undefined;
  });
}

// A request picked on the schedule: the requests screen's own confirm (booking.confirm) and decline, and the calendar
// re-rendered after.
export async function confirmRequestAction(prev: ActState, form: FormData): Promise<ActState> {
  const state = await confirmBookingAction(prev, form);
  revalidatePath("/app/calendar");
  return state;
}

export async function declineRequestAction(prev: ActState, form: FormData): Promise<ActState> {
  const state = await declineBookingAction(prev, form);
  revalidatePath("/app/calendar");
  return state;
}
