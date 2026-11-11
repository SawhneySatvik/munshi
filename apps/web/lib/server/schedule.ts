// The calendar's schedule view (server only): the day's bookings on a timeline, one row per stylist at each branch,
// read by core's calendar view in the page's one transaction, with each stylist's usual hours and leave from the staff
// view when the member may read it. No money is shown, so no snapshot is minted for it.
//
// A move is checked here against the free slots core offers for the booking's service at the target branch that day
// (the roster less what is booked, the database's own calendar rules), never against a time the browser computed:
// the browser names a stylist and a wall-clock minute of the shop's day, and only a slot core offered at that instant
// can be booked. Only a confirmed booking moves; a request is confirmed or declined, a hold is the public's.
import "server-only";
import { addDays, dayStart, localTime, type Session, type Slot, viewCalendar, viewStaff } from "@munshi/core";
import type { Frame } from "../app-types";
import { page } from "./ops";
import { frameOf } from "./sell";

export type ScheduleResource = { id: string; staffId: string; shopId: string; name: string; shop: string; mark: string | null };
export type ScheduleEvent = {
  id: string;
  resourceId: string;
  /** the row's own moments, for <time> */
  startsAt: string;
  endsAt: string;
  /** minutes after the shop's local midnight that day: where the bar sits on the board */
  startMin: number;
  endMin: number;
  state: string;
  source: string;
  service: string;
  who: string | null;
  movable: boolean;
};
export type ScheduleRange = { id: string; resourceId: string; startMin: number; endMin: number; kind: "hours" | "leave" };
export type SchedulePage = Frame & {
  day: string;
  prevDay: string;
  nextDay: string;
  shops: { id: string; name: string }[];
  resources: ScheduleResource[];
  events: ScheduleEvent[];
  ranges: ScheduleRange[];
  /** the board's window, in whole hours of the shop's day */
  fromHour: number;
  toHour: number;
  canMove: boolean;
};

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const HM = /^([0-9]{2}):([0-9]{2})$/;
const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const minuteOf = (hm: string | null) => {
  const m = hm ? HM.exec(hm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const resourceId = (shopId: string, staffId: string) => `${shopId}:${staffId}`;

/** The schedule for `day` (today in the shop's zone by default). Null while the shop cannot use bookings. */
export async function loadSchedule(session: Session, day: string | null): Promise<SchedulePage | null> {
  return page(session, async (c) => {
    const v = await viewCalendar(c, session, { day: day && DAY.test(day) ? day : null });
    if (!v) return null;
    const staff = await viewStaff(c, session);
    const zone = v.viewer.timeZone;
    const midnight = dayStart(v.day, zone).getTime();
    const minutes = (iso: string) => Math.round((Date.parse(iso) - midnight) / 60_000);
    const names = new Map(v.staff.map((s) => [s.id, s.name]));
    const customers = new Map(v.customers.map((k) => [k.id, k.name]));
    const canMove = v.viewer.mayRun.has("booking.confirm");

    const resources: ScheduleResource[] = [];
    for (const s of v.shops) {
      // A row per stylist whose terms name this branch, and any booked here that day (a cover).
      const ids = new Set([...v.staff.filter((p) => p.shopId === s.id).map((p) => p.id), ...v.bookings.filter((b) => b.shopId === s.id).map((b) => b.staffId)]);
      for (const id of ids) {
        const mark = staff && staff.today === v.day ? (staff.marks.find((m) => m.staffId === id)?.status ?? null) : null;
        resources.push({ id: resourceId(s.id, id), staffId: id, shopId: s.id, name: names.get(id) ?? "", shop: s.name, mark });
      }
    }

    const events = v.bookings.map(
      (b): ScheduleEvent => ({
        id: b.id,
        resourceId: resourceId(b.shopId, b.staffId),
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        startMin: minutes(b.startsAt),
        endMin: minutes(b.endsAt),
        state: b.state,
        source: b.source,
        service: b.service,
        who: b.customerId ? (customers.get(b.customerId) ?? null) : b.contactName,
        movable: canMove && b.state === "confirmed" && Date.parse(b.startsAt) > Date.now(),
      }),
    );

    const ranges: ScheduleRange[] = [];
    if (staff) {
      const dow = isoDow(v.day);
      for (const r of resources) {
        const shift = staff.roster.find((x) => x.staffId === r.staffId && x.weekday === dow && x.shopId === r.shopId && !x.off);
        const from = minuteOf(shift?.starts ?? null);
        const to = minuteOf(shift?.ends ?? null);
        if (from !== null && to !== null && to > from) ranges.push({ id: `hours-${r.id}`, resourceId: r.id, startMin: from, endMin: to, kind: "hours" });
        if (staff.leave.some((l) => l.staffId === r.staffId && l.firstDay <= v.day && v.day <= l.lastDay)) {
          ranges.push({ id: `leave-${r.id}`, resourceId: r.id, startMin: 0, endMin: 24 * 60, kind: "leave" });
        }
      }
    }

    const spans = [...events.map((e) => [e.startMin, e.endMin]), ...ranges.filter((r) => r.kind === "hours").map((r) => [r.startMin, r.endMin])];
    const fromHour = Math.max(0, Math.min(9, ...spans.map(([a]) => Math.floor((a as number) / 60))));
    const toHour = Math.min(24, Math.max(21, ...spans.map(([, b]) => Math.ceil((b as number) / 60))));

    return {
      ...frameOf(v.viewer, []),
      day: v.day,
      prevDay: addDays(v.day, -1),
      nextDay: addDays(v.day, 1),
      shops: v.shops.map((s) => ({ id: s.id, name: s.name })),
      resources,
      events,
      ranges,
      fromHour,
      toHour,
      canMove,
    };
  });
}

export type MoveAsk = { bookingId: string; shopId: string; staffId: string; day: string; minute: number };
export type MoveTarget = {
  bookingId: string;
  shopId: string;
  serviceItemId: string;
  customerId: string | null;
  slot: Slot;
};
export type MoveRefusal = "not_movable" | "service" | "not_offered";

/**
 * The slot a move lands on, read in one transaction: the booking (confirmed, on that day), its service (by the name
 * the calendar view gives, which must name one service), and the free slot core offers for that service at the target
 * branch, for that stylist, at that instant. A refusal names why; nothing is written.
 */
export async function moveTarget(session: Session, ask: MoveAsk): Promise<MoveTarget | MoveRefusal> {
  if (!DAY.test(ask.day) || !Number.isInteger(ask.minute) || ask.minute < 0 || ask.minute >= 24 * 60) return "not_offered";
  return page(session, async (c) => {
    const v = await viewCalendar(c, session, { day: ask.day });
    if (!v) return "not_movable";
    const booking = v.bookings.find((b) => b.id === ask.bookingId);
    if (booking?.state !== "confirmed") return "not_movable";
    const services = v.services.filter((s) => s.name === booking.service);
    const service = services.length === 1 ? services[0] : undefined;
    if (!service) return "service";
    const at = localTime(ask.day, ask.minute, v.viewer.timeZone).getTime();
    const offered = await viewCalendar(c, session, { day: ask.day, shopId: ask.shopId, serviceId: service.id });
    const slot = offered?.slots?.offered.find((o) => o.staffId === ask.staffId && o.start.getTime() === at);
    if (!slot) return "not_offered";
    return { bookingId: booking.id, shopId: ask.shopId, serviceItemId: service.id, customerId: booking.customerId, slot };
  });
}
