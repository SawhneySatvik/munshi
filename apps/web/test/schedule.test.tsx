// The calendar's schedule view on Elite's books as the showcase seed builds them (two branches, seven stylists on a
// weekly roster, the desk's confirmed bookings on days 0–2). The board is read from the stored booking rows (checked
// here with the test's own SQL); a move from the board is the signed-in owner's or manager's own two desk commands
// (book the slot core offers, then cancel the old booking) and nothing else: a slot core does not offer, a request, a
// hold, a keyless form and a member who does not handle bookings each leave every row as it was. A check writes nothing.
// A cancel from the board is the same desk move, an owner's or manager's alone.
// Bryntum itself is a browser widget: the board is stubbed here (schedule-board.test.tsx covers it).
import { randomBytes } from "node:crypto";
import { addDays, addMember, dayStart, freeSlots, placeHold, requestBooking, type Session, type Slot } from "@munshi/core";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { cancelBookingAction, checkMoveAction, moveBookingAction } from "../app/app/calendar/actions";
import CalendarPage from "../app/app/calendar/page";
import { appPool } from "../lib/server/db";
import type { SchedulePage } from "../lib/server/schedule";
import { dataOf, sourcedInBoth } from "./helpers/app-render";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia } from "./helpers/render";
import { openShowcase, SHOW_AS_OF, type Shows, showRows, signInShow } from "./helpers/showcase-db";

vi.mock("../components/schedule/BryntumBoard", () => ({ default: () => null }));

const TZ = "Asia/Kolkata";
let h: Shows;
beforeAll(async () => {
  h = await openShowcase();
}, 300_000);
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const e = () => h.s.elite;
const schedule = (day: string) => CalendarPage({ searchParams: Promise.resolve({ view: "schedule", day }) });
const minuteOf = (day: string, at: Date) => Math.round((at.getTime() - dayStart(day, TZ).getTime()) / 60_000);
const hex = () => randomBytes(32).toString("hex");

type Row = { id: string; shop_id: string; staff_id: string; service_item_id: string; customer_id: string | null; state: string; starts_at: Date; ends_at: Date };
const COLS = `id::text, shop_id::text, staff_id::text, service_item_id::text, customer_id::text, state, lower(during) as starts_at, upper(during) as ends_at`;
const onDay = `(lower(during) at time zone '${TZ}')::date = $1::date`;
const all = () => showRows<Row & { handled_by: string | null; source: string }>(h, e().tenantId, `select ${COLS}, handled_by::text, source from ops.booking order by id`);

/** The day's first confirmed booking with a customer, and the slots core offers for its service at its branch. */
async function confirmedOn(day: string): Promise<{ b: Row; slots: Slot[] }> {
  const [b] = await showRows<Row>(h, e().tenantId, `select ${COLS} from ops.booking where state = 'confirmed' and customer_id is not null and ${onDay} order by lower(during), id limit 1`, [day]);
  if (!b) throw new Error("test: no confirmed booking that day");
  const slots = await freeSlots(h.db.as("munshi_public"), { kind: "system", tenantId: e().tenantId }, { shopId: b.shop_id, serviceItemId: b.service_item_id, day });
  return { b, slots };
}

const moveForm = (b: { id: string; shop_id: string }, staffId: string, day: string, minute: number) =>
  formOf({ booking: b.id, shop: b.shop_id, staff: staffId, day, minute: String(minute) });

test("day 1: a row per stylist at each branch and every live booking that day, as the rows store them; no digit without a source", async () => {
  await signInShow(h, e().owner);
  const day = addDays(SHOW_AS_OF, 1);
  const el = await schedule(day);
  const data = dataOf<SchedulePage>(el);
  expect(data.day).toBe(day);
  expect(data.canMove).toBe(true);

  const stored = await showRows<Row>(
    h,
    e().tenantId,
    `select ${COLS} from ops.booking where ${onDay} and (state in ('requested', 'confirmed', 'done', 'no_show') or (state = 'held' and expires_at > now()))`,
    [day],
  );
  expect(stored.length).toBeGreaterThan(20);
  expect(data.events.map((x) => x.id).sort()).toEqual(stored.map((r) => r.id).sort());
  for (const r of stored) {
    const ev = data.events.find((x) => x.id === r.id);
    expect(ev, r.id).toMatchObject({
      resourceId: `${r.shop_id}:${r.staff_id}`,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at.toISOString(),
      startMin: minuteOf(day, r.starts_at),
      endMin: minuteOf(day, r.ends_at),
      state: r.state,
    });
    expect(data.resources.some((x) => x.id === ev?.resourceId)).toBe(true);
  }
  // Arjun covers Kalkaji on day 1: he has a row there as well as at his own branch.
  const arjun = e().staff.get("Arjun") as string;
  expect(data.resources.filter((r) => r.staffId === arjun).map((r) => r.shop).sort()).toEqual(["Kalkaji", "Kirti Nagar"]);
  // The weekly roster gives each stylist's usual hours; every figure on the page is a time in <time> or a name.
  expect(data.ranges.some((r) => r.kind === "hours")).toBe(true);
  expect(data.snapshots).toEqual([]);
  // The board loads in the browser only; the page around it says whose widget draws it, and that the data is a sample.
  const text = sourcedInBoth(el);
  expect(text).toContain("Bryntum Scheduler (trial)");
  expect(text).toContain("synthetic data");
  expect(text).not.toMatch(/[ऀ-ॿ]/);
});

test("a move to a slot core offers: the new slot booked for the same customer, the old one cancelled, both as the signed-in manager", async () => {
  const day = addDays(SHOW_AS_OF, 1);
  const { b, slots } = await confirmedOn(day);
  const branch = [...e().shops].find(([, id]) => id === b.shop_id)?.[0] as "Kalkaji" | "Kirti Nagar";
  const desk = await signInShow(h, e().desks[branch]);
  const slot = slots.find((s) => s.staffId !== b.staff_id) ?? slots[0];
  if (!slot) throw new Error("test: no free slot for the move");
  const minute = minuteOf(day, slot.start);
  const before = await all();

  // A check is a read.
  expect(await checkMoveAction(null, moveForm(b, slot.staffId, day, minute))).toEqual({ slot: { at: slot.start.toISOString() } });
  expect(await all()).toEqual(before);
  // A form without its key is refused before core.
  const keyless = moveForm(b, slot.staffId, day, minute);
  keyless.delete("key");
  expect(await moveBookingAction(null, keyless)).toEqual({ error: "other" });
  expect(await all()).toEqual(before);

  const out = await moveBookingAction(null, moveForm(b, slot.staffId, day, minute));
  expect(out).toMatchObject({ moved: { bookingId: expect.any(String) } });
  const made = (out as { moved: { bookingId: string } }).moved.bookingId;
  const after = await all();
  expect(after).toHaveLength(before.length + 1);
  expect(after.find((r) => r.id === b.id)).toMatchObject({ state: "cancelled", handled_by: desk.memberId });
  expect(after.find((r) => r.id === made)).toMatchObject({
    state: "confirmed",
    source: "app",
    handled_by: desk.memberId,
    staff_id: slot.staffId,
    shop_id: b.shop_id,
    service_item_id: b.service_item_id,
    customer_id: b.customer_id,
    starts_at: slot.start,
  });
  // Every other row as it was.
  expect(after.filter((r) => r.id !== b.id && r.id !== made)).toEqual(before.filter((r) => r.id !== b.id));
});

test("a drop where core offers no slot is refused, and nothing is written", async () => {
  await signInShow(h, e().owner);
  const day = addDays(SHOW_AS_OF, 2);
  const { b, slots } = await confirmedOn(day);
  const free = slots[0];
  if (!free) throw new Error("test: no free slot that day");
  const before = await all();
  // Five minutes past a free slot is off the quarter-hour grid; three in the morning is outside every roster.
  for (const minute of [minuteOf(day, free.start) + 5, 3 * 60]) {
    expect(await checkMoveAction(null, moveForm(b, free.staffId, day, minute))).toEqual({ error: "not_offered" });
    expect(await moveBookingAction(null, moveForm(b, free.staffId, day, minute))).toEqual({ error: "not_offered" });
  }
  expect(await all()).toEqual(before);
});

test("a request does not move from the board (it is confirmed or declined), and nothing is written", async () => {
  const day = addDays(SHOW_AS_OF, 5);
  const shopId = e().shops.get("Kalkaji") as string;
  const serviceItemId = e().services.get("s-cut-m") as string;
  const pub = h.db.as("munshi_public");
  const slots = await freeSlots(pub, { kind: "system", tenantId: e().tenantId }, { shopId, serviceItemId, day });
  const [hold, other] = [slots[0], slots[slots.length - 1]];
  if (!hold || !other) throw new Error("test: no free slot at Kalkaji");
  const placed = await placeHold(pub, e().tenantId, {
    shopId,
    staffId: hold.staffId,
    serviceItemId,
    start: hold.start.toISOString(),
    shiftRel: hold.shiftRel,
    shiftId: hold.shiftId,
    ipHash: hex(),
    deviceHash: hex(),
  });
  const { bookingId } = await requestBooking(pub, e().tenantId, {
    holdId: placed.holdId,
    holdToken: placed.holdToken,
    name: "Sample visitor",
    phone: "+910000000000",
    waUpdates: true,
    noticeVersion: "v1",
    consentVersion: "v1",
  });
  await signInShow(h, e().desks.Kalkaji);
  const data = dataOf<SchedulePage>(await schedule(day));
  expect(data.events.find((x) => x.id === bookingId)).toMatchObject({ state: "requested", movable: false });
  const before = await all();
  const form = moveForm({ id: bookingId, shop_id: shopId }, other.staffId, day, minuteOf(day, other.start));
  expect(await moveBookingAction(null, form)).toEqual({ error: "not_movable" });
  expect(await all()).toEqual(before);
});

test("a member who does not handle bookings moves nothing", async () => {
  const day = addDays(SHOW_AS_OF, 1);
  const { b, slots } = await confirmedOn(day);
  const slot = slots[0];
  if (!slot) throw new Error("test: no free slot");
  const staffId = await addMember(await appPool(), e().owner, { name: "Sample counter hand", role: "staff" });
  await signInShow(h, { tenantId: e().tenantId, memberId: staffId } as Session);
  const before = await all();
  const out = await moveBookingAction(null, moveForm(b, slot.staffId, day, minuteOf(day, slot.start)));
  expect(out && "error" in out).toBe(true);
  expect(await all()).toEqual(before);
});

test("a confirmed booking is cancelled from the board by a manager, under their name; a member who does not handle bookings changes nothing", async () => {
  const day = addDays(SHOW_AS_OF, 2);
  const [b] = await showRows<Row>(h, e().tenantId, `select ${COLS} from ops.booking where state = 'confirmed' and ${onDay} order by lower(during) desc, id limit 1`, [day]);
  if (!b) throw new Error("test: no confirmed booking that day");
  const helper = await addMember(await appPool(), e().owner, { name: "Sample helper", role: "staff" });
  await signInShow(h, { tenantId: e().tenantId, memberId: helper } as Session);
  const before = await all();
  const refused = await cancelBookingAction(null, formOf({ booking: b.id }));
  expect(refused && "error" in refused).toBe(true);
  expect(await all()).toEqual(before);

  const desk = await signInShow(h, e().desks.Kalkaji);
  expect(await cancelBookingAction(null, formOf({ booking: b.id }))).toEqual({ done: true });
  const after = await all();
  expect(after.find((r) => r.id === b.id)).toMatchObject({ state: "cancelled", handled_by: desk.memberId });
  expect(after.filter((r) => r.id !== b.id)).toEqual(before.filter((r) => r.id !== b.id));
});
