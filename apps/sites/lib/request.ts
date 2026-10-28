// Sending a booking request. Until the API integration wires @munshi/sdk, nothing leaves the browser: the sample answers the way the
// API will (202 {id, received}), so the page's sent state is the real one. No name or phone is kept anywhere.
import type { BookingRequest } from "./types.ts";

export async function requestBooking(_input: BookingRequest, opts: { idempotencyKey: string }): Promise<{ id: string; received: true }> {
  await new Promise((r) => setTimeout(r, 600));
  return { id: `sample-${opts.idempotencyKey.slice(0, 8)}`, received: true };
}
