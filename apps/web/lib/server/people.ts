// The people screens' data (server only): the calendar, the requests, staff and salary, each read by its core
// view in the page's ONE transaction (page()). Null while the shop cannot use the capability, and the page answers 404.
// Money and day counts are refs into snapshot cells (staff.advances, salary.preview); a booking's or a shift's time and
// a leave's days are the rows' own moments, shown in <time>; names come from the vault beside them.
import "server-only";
import { type Session, viewCalendar, viewRequests, viewSalary, viewStaff } from "@munshi/core";
import type { Frame } from "../app-types";
import type { SourceRef } from "../types";
import { mintedAs, page, refTo, textOf } from "./ops";
import { frameOf, lab } from "./sell";

export type BookingRow = {
  id: string;
  service: string;
  startsAt: string;
  endsAt: string;
  state: string;
  source: string;
  expiresAt: string | null;
  who: string | null;
  staff: string;
  shop: string;
};
export type Column = { staffId: string; name: string; bookings: BookingRow[] };
export type CalendarPage = Frame & {
  day: string;
  shops: { id: string; name: string; columns: Column[] }[];
  services: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  desk: { shopId: string; serviceId: string; options: { value: string; staff: string; at: string }[] } | null;
  chosen: { shopId: string | null; serviceId: string | null };
};

export async function loadCalendar(session: Session, opts: { day?: string | null; shopId?: string | null; serviceId?: string | null }): Promise<CalendarPage | null> {
  return page(session, async (c) => {
    const v = await viewCalendar(c, session, opts);
    if (!v) return null;
    const names = new Map(v.staff.map((s) => [s.id, s.name]));
    const customers = new Map(v.customers.map((k) => [k.id, k.name]));
    const shopName = new Map(v.shops.map((s) => [s.id, s.name]));
    const row = (b: (typeof v.bookings)[number]): BookingRow => ({
      id: b.id,
      service: b.service,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      state: b.state,
      source: b.source,
      expiresAt: b.expiresAt,
      who: b.customerId ? (customers.get(b.customerId) ?? null) : b.contactName,
      staff: names.get(b.staffId) ?? "",
      shop: shopName.get(b.shopId) ?? "",
    });
    const shops = v.shops.map((s) => {
      // A column per stylist working there that day: those whose terms name this branch, and any booked here (a cover).
      const ids = [...new Set([...v.staff.filter((p) => p.shopId === s.id).map((p) => p.id), ...v.bookings.filter((b) => b.shopId === s.id).map((b) => b.staffId)])];
      return {
        id: s.id,
        name: s.name,
        columns: ids.map((id) => ({ staffId: id, name: names.get(id) ?? "", bookings: v.bookings.filter((b) => b.shopId === s.id && b.staffId === id).map(row) })),
      };
    });
    return {
      ...frameOf(v.viewer, []),
      day: v.day,
      shops,
      services: v.services.map((s) => ({ id: s.id, name: s.name })),
      customers: v.customers,
      desk: v.slots
        ? {
            shopId: v.slots.shopId,
            serviceId: v.slots.serviceId,
            options: v.slots.offered.map((o) => ({
              value: `${o.staffId}|${o.start.toISOString()}|${o.shiftRel}|${o.shiftId}`,
              staff: names.get(o.staffId) ?? "",
              at: o.start.toISOString(),
            })),
          }
        : null,
      chosen: { shopId: opts.shopId ?? null, serviceId: opts.serviceId ?? null },
    };
  });
}

export type RequestsPage = Frame & {
  bookingsOn: boolean;
  bookings: BookingRow[];
  requests: { id: string; kind: string; shop: string; who: string | null; preferredOn: string | null; window: string | null; note: string | null; at: string; items: string[] }[];
};

export async function loadRequests(session: Session): Promise<RequestsPage | null> {
  return page(session, async (c) => {
    const v = await viewRequests(c, session);
    if (!v) return null;
    const names = new Map(v.staff.map((s) => [s.id, s.name]));
    const shopName = new Map(v.shops.map((s) => [s.id, s.name]));
    return {
      ...frameOf(v.viewer, []),
      bookingsOn: v.bookingsOn,
      bookings: v.bookings.map((b) => ({
        id: b.id,
        service: b.service,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        state: b.state,
        source: b.source,
        expiresAt: b.expiresAt,
        who: b.contactName,
        staff: names.get(b.staffId) ?? "",
        shop: shopName.get(b.shopId) ?? "",
      })),
      requests: v.requests.map((q) => ({
        id: q.id,
        kind: q.kind,
        shop: shopName.get(q.shopId) ?? "",
        who: q.contactName,
        preferredOn: q.preferredOn,
        window: q.window,
        note: q.note,
        at: q.createdAt,
        items: q.items,
      })),
    };
  });
}

export type StaffRow = {
  id: string;
  name: string;
  shopId: string | null;
  shop: string;
  week: { weekday: number; starts: string | null; ends: string | null; off: boolean }[];
  mark: { status: string; byRole: string } | null;
  leave: { id: string; kind: string; firstDay: string; lastDay: string; halfDay: boolean }[];
  owed: SourceRef | null;
};
export type StaffPage = Frame & { today: string; shops: { id: string; name: string }[]; staff: StaffRow[] };

export async function loadStaff(session: Session): Promise<StaffPage | null> {
  return page(session, async (c) => {
    const v = await viewStaff(c, session);
    if (!v) return null;
    const shopName = new Map(v.shops.map((s) => [s.id, s.name]));
    const minted = v.advances.map((a) => ({ staffId: a.staffId, m: mintedAs(a.snapshot, lab("advanceLabel"), ["currency", "given", "recovered", "outstanding"]) }));
    const staff = v.staff.map((p): StaffRow => {
      const adv = minted.find((a) => a.staffId === p.id);
      const row = adv ? adv.m.cells.findIndex((r) => textOf(r.currency) === "INR") : -1;
      const mark = v.marks.find((m) => m.staffId === p.id);
      return {
        id: p.id,
        name: p.name,
        shopId: p.shopId,
        shop: p.shopId ? (shopName.get(p.shopId) ?? "") : "",
        week: v.roster.filter((r) => r.staffId === p.id).map((r) => ({ weekday: r.weekday, starts: r.starts, ends: r.ends, off: r.off })),
        mark: mark ? { status: mark.status, byRole: mark.byRole } : null,
        leave: v.leave.filter((l) => l.staffId === p.id).map((l) => ({ id: l.id, kind: l.kind, firstDay: l.firstDay, lastDay: l.lastDay, halfDay: l.halfDay })),
        owed: adv && row >= 0 ? refTo(adv.m, row, "outstanding", lab("advanceLabel")) : null,
      };
    });
    return { ...frameOf(v.viewer, minted.map((a) => a.m)), today: v.today, shops: v.shops.map((s) => ({ id: s.id, name: s.name })), staff };
  });
}

export type SalaryRow = { staffId: string; name: string; payKind: string; pay: SourceRef; days: SourceRef; unpaid: SourceRef; gross: SourceRef; recovered: SourceRef; net: SourceRef };
export type SalaryPage = Frame & {
  month: string;
  periodStart: string;
  periodEnd: string;
  rows: SalaryRow[];
  count: SourceRef;
  drafts: { id: string; status: string; at: string }[];
  runs: { id: string; periodStart: string; periodEnd: string; at: string; by: string }[];
};

export async function loadSalary(session: Session, month: string | null): Promise<SalaryPage | null> {
  return page(session, async (c) => {
    const v = await viewSalary(c, session, month);
    if (!v) return null;
    const m = mintedAs(v.preview, lab("salaryLabel"), ["pay_kind", "pay", "days", "unpaid_days", "gross", "outstanding", "recovered", "net"]);
    const names = new Map(v.staff.map((s) => [s.id, s.name]));
    const L = lab("salaryLabel");
    return {
      ...frameOf(v.viewer, [m]),
      month: v.month,
      periodStart: v.periodStart,
      periodEnd: v.periodEnd,
      count: { label: L, snapshotId: m.id, row: 1, col: "_count" },
      rows: m.cells.map((r, i) => ({
        staffId: textOf(r.staff_id),
        name: names.get(textOf(r.staff_id)) ?? "",
        payKind: textOf(r.pay_kind),
        pay: refTo(m, i, "pay", L),
        days: refTo(m, i, "days", L),
        unpaid: refTo(m, i, "unpaid_days", L),
        gross: refTo(m, i, "gross", L),
        recovered: refTo(m, i, "recovered", L),
        net: refTo(m, i, "net", L),
      })),
      drafts: v.drafts.map((d) => ({ id: d.id, status: d.status, at: d.createdAt })),
      runs: v.runs.map((r) => ({ id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, at: r.createdAt, by: r.by })),
    };
  });
}
