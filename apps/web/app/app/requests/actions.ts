"use server";

// A booking request: confirmed by booking.confirm, an owner's or manager's own command under the
// form's key, which writes the customer through the vault and their confirmation message in one transaction; or
// declined with a reason code (core's moveBooking, an ops move the database allows only an owner or manager).
import { moveBooking } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, command, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { flushOutbox } from "../../../lib/server/outbox";

const PATH = "/app/requests";

export async function confirmBookingAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const bookingId = idOf(form, "booking");
    if (!bookingId) return invalid();
    await command(session, "booking.confirm", { bookingId }, key);
    await flushOutbox();
    return undefined;
  });
}

export async function declineBookingAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const bookingId = idOf(form, "booking");
    if (!bookingId) return invalid();
    await moveBooking(await appPool(), session, { bookingId, state: "declined", reason: "staff_unavailable" });
    return undefined;
  });
}
