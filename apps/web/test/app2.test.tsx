// BP-APP-2 on Elite's books as the showcase seed builds them (two branches, seven invented stylists on a weekly roster,
// Arjun covering Kalkaji on day 1, the desk's bookings on days 0–2, last month's attendance and salary run): the
// calendar, the requests, staff and salary. Each renders from its core view, every figure a <Figure> whose ref lands
// on a stored cell, no digit without a source in either language, absent once its capability is off. Each action
// writes as the signed-in member: desk bookings and declines as ops moves, booking.confirm, attendance.mark, leave.record
// and advance.give under the form's key, a salary.run draft decided only by decide(); a keyless form is refused.
import { randomBytes } from "node:crypto";
import { cleanup } from "@testing-library/react";
import { freeSlots, placeHold, requestBooking, switchCapability } from "@munshi/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { bookDeskAction } from "../app/app/calendar/actions";
import CalendarPage from "../app/app/calendar/page";
import { confirmBookingAction, declineBookingAction } from "../app/app/requests/actions";
import RequestsPage from "../app/app/requests/page";
import { advanceAction, leaveAction, markAction } from "../app/app/staff/actions";
import StaffPage from "../app/app/staff/page";
import { decideSalaryAction, makeSalaryDraftAction } from "../app/app/staff/salary/actions";
import SalaryPage from "../app/app/staff/salary/page";
import { appPool } from "../lib/server/db";
import type { CalendarPage as Cal, RequestsPage as Req, SalaryPage as Sal, StaffPage as Staff } from "../lib/server/people";
import { dataOf, isAbsent, resolves, sourcedInBoth } from "./app-render";
import { formOf } from "./ops-db";
import { fakeMatchMedia } from "./render";
import { openShowcase, SHOW_AS_OF, type Shows, showRows, signInShow } from "./showcase-db";

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
const keyless = (fields: Record<string, string>) => {
  const form = formOf(fields);
  form.delete("key");
  return form;
};
const calendar = (q: { day?: string; shop?: string; service?: string } = {}) => CalendarPage({ searchParams: Promise.resolve(q) });
const service = (ref: string) => e().services.get(ref) as string;
const hex = () => randomBytes(32).toString("hex");

/** A request from Elite's site: a hold on a free slot, then the visitor's details (the public role's own path). */
async function siteRequest(day: string): Promise<string> {
  const shopId = e().shops.get("Kalkaji") as string;
  const slots = await freeSlots(h.db.as("munshi_public"), { kind: "system", tenantId: e().tenantId }, { shopId, serviceItemId: service("s-cut-m"), day });
  const slot = slots[slots.length - 1];
  if (!slot) throw new Error("test: no free slot at Kalkaji");
  const pub = h.db.as("munshi_public");
  const { holdId, holdToken } = await placeHold(pub, e().tenantId, {
    shopId,
    staffId: slot.staffId,
    serviceItemId: service("s-cut-m"),
    start: slot.start.toISOString(),
    shiftRel: slot.shiftRel,
    shiftId: slot.shiftId,
    ipHash: hex(),
    deviceHash: hex(),
  });
  const { bookingId } = await requestBooking(pub, e().tenantId, {
    holdId,
    holdToken,
    name: "Sample visitor",
    phone: "+910000000000",
    waUpdates: true,
    noticeVersion: "v1",
    consentVersion: "v1",
  });
  return bookingId;
}

describe("the calendar (§8.8)", () => {
  test("day 1 at both branches, a column per stylist (Arjun at Kalkaji on his cover day); every digit sourced", async () => {
    await signInShow(h, e().owner);
    const el = await calendar({ day: `${addDay(SHOW_AS_OF, 1)}` });
    const data = dataOf<Cal>(el);
    const kalkaji = data.shops.find((s) => s.name === "Kalkaji");
    expect(kalkaji?.columns.find((c) => c.name === "Arjun")?.bookings.length).toBeGreaterThan(0);
    expect(data.shops.flatMap((s) => s.columns).reduce((n, c) => n + c.bookings.length, 0)).toBeGreaterThan(20);
    const text = sourcedInBoth(el);
    expect(text).toContain("Kirti Nagar");
  });

  test("the desk books a free slot (core's bookAtDesk, as the desk's member); a keyless form is refused", async () => {
    const desk = await signInShow(h, e().desks["Kirti Nagar"]);
    const shop = e().shops.get("Kirti Nagar") as string;
    const el = await calendar({ day: SHOW_AS_OF, shop, service: service("s-beard") });
    const options = dataOf<Cal>(el).desk?.options ?? [];
    expect(options.length).toBeGreaterThan(0);
    sourcedInBoth(el);
    const slot = (options[options.length - 1] as { value: string }).value;
    const count = async () => (await showRows(h, e().tenantId, "select 1 from ops.booking where source = 'app'")).length;
    const before = await count();
    expect(await bookDeskAction(null, keyless({ shop, service: service("s-beard"), slot }))).toEqual({ error: "other" });
    expect(await bookDeskAction(null, formOf({ shop, service: service("s-beard"), slot, customer: e().customers.get("Ritu M.") as string }))).toEqual({ done: true });
    expect(await count()).toBe(before + 1);
    // The same slot again is taken: the exclusion constraint refuses it.
    expect(await bookDeskAction(null, formOf({ shop, service: service("s-beard"), slot }))).toMatchObject({ error: expect.any(String) });
    expect(await count()).toBe(before + 1);
    expect(desk.memberId).toBeTruthy();
  });

  test("switched off, the calendar and the requests are absent", async () => {
    const owner = await signInShow(h, e().owner);
    await switchCapability(await appPool(), owner, "bookings", false);
    try {
      await isAbsent(() => calendar());
      // The requests screen stays only while the site is usable (Elite's is unverified here), so it too is absent.
      await isAbsent(() => RequestsPage());
    } finally {
      await switchCapability(await appPool(), owner, "bookings", true);
    }
  });
});

describe("requests (§8.11)", () => {
  test("a site request waits; a manager confirms it (booking.confirm with the key) and declines another", async () => {
    const day = addDay(SHOW_AS_OF, 4);
    const first = await siteRequest(day);
    const second = await siteRequest(day);
    const desk = await signInShow(h, e().desks.Kalkaji);
    const el = await RequestsPage();
    const waiting = dataOf<Req>(el).bookings;
    expect(waiting.map((b) => b.id).sort()).toEqual([first, second].sort());
    // On a demo the database pins the visitor's name and phone to the samples; the screen shows the stored name.
    expect(waiting.every((b) => Boolean(b.who))).toBe(true);
    expect(sourcedInBoth(el)).toContain("Kalkaji");
    cleanup();

    expect(await confirmBookingAction(null, keyless({ booking: first }))).toEqual({ error: "other" });
    const key = "booking-confirm-key-01";
    expect(await confirmBookingAction(null, formOf({ key, booking: first }))).toEqual({ done: true });
    const [b] = await showRows<{ state: string; handled_by: string }>(h, e().tenantId, "select state, handled_by::text from ops.booking where id = $1", [first]);
    expect(b).toEqual({ state: "confirmed", handled_by: desk.memberId });
    const [msg] = await showRows<{ created_by: string }>(h, e().tenantId, "select created_by::text from books.outbound_message where booking_id = $1", [first]);
    expect(msg?.created_by).toBe(desk.memberId);
    const [claim] = await showRows<{ command: string }>(h, e().tenantId, "select command from ops.idempotency where key = $1", [key]);
    expect(claim?.command).toBe("booking.confirm");

    expect(await declineBookingAction(null, formOf({ booking: second }))).toEqual({ done: true });
    const [d] = await showRows<{ state: string; handled_by: string }>(h, e().tenantId, "select state, handled_by::text from ops.booking where id = $1", [second]);
    expect(d).toEqual({ state: "declined", handled_by: desk.memberId });
    expect(dataOf<Req>(await RequestsPage()).bookings).toEqual([]);
  });
});

describe("staff (§8.10)", () => {
  test("the team: each one's week, today's mark and advance outstanding (a cell of staff.advances); every digit sourced", async () => {
    const owner = await signInShow(h, e().owner);
    expect(await advanceAction(null, formOf({ staff: e().staff.get("Kabir") as string, amount: "1500", method: "cash" }))).toEqual({ done: true });
    const [adv] = await showRows<{ created_by: string; amount_minor: string }>(h, e().tenantId, "select created_by::text, amount_minor::text from books.advance where staff_id = $1", [
      e().staff.get("Kabir"),
    ]);
    expect(adv).toEqual({ created_by: owner.memberId, amount_minor: "150000" });
    const el = await StaffPage();
    const data = dataOf<Staff>(el);
    expect(data.staff).toHaveLength(7);
    expect(data.staff.find((p) => p.name === "Kabir")?.owed).not.toBeNull();
    expect(data.staff.every((p) => p.week.length === 7)).toBe(true);
    expect(resolves(el)).toBeGreaterThanOrEqual(1);
    const text = sourcedInBoth(el);
    expect(text).toContain("₹1,500");
  });

  test("a manager marks today and records leave (attendance.mark, leave.record, with the key); the owner alone gives advances", async () => {
    const desk = await signInShow(h, e().desks["Kirti Nagar"]);
    const neha = e().staff.get("Neha") as string;
    const shop = e().shops.get("Kirti Nagar") as string;
    const today = dataOf<Staff>(await StaffPage()).today;
    expect(await markAction(null, keyless({ staff: neha, shop, day: today, status: "present" }))).toEqual({ error: "other" });
    expect(await markAction(null, formOf({ staff: neha, shop, day: today, status: "half_day" }))).toEqual({ done: true });
    const [mark] = await showRows<{ status: string; created_by: string; marked_by_role: string }>(
      h,
      e().tenantId,
      "select status, created_by::text, marked_by_role from books.attendance where staff_id = $1 and day = $2",
      [neha, today],
    );
    expect(mark).toEqual({ status: "half_day", created_by: desk.memberId, marked_by_role: "manager" });
    expect(await leaveAction(null, formOf({ staff: neha, kind: "sick", from: addDay(SHOW_AS_OF, 20), to: addDay(SHOW_AS_OF, 21) }))).toEqual({ done: true });
    const [leave] = await showRows<{ created_by: string }>(h, e().tenantId, "select created_by::text from books.leave where staff_id = $1 and kind = 'sick'", [neha]);
    expect(leave?.created_by).toBe(desk.memberId);
    expect(await advanceAction(null, formOf({ staff: neha, amount: "500", method: "upi" }))).toEqual({ error: "refused" });
    const page = dataOf<Staff>(await StaffPage()).staff.find((p) => p.id === neha);
    expect(page?.mark?.status).toBe("half_day");
    expect(page?.leave).toHaveLength(1);
  });
});

describe("salary (§8.10)", () => {
  test("this month's preview as cells; the owner makes the salary.run draft and approves it with decide(); a manager cannot", async () => {
    const owner = await signInShow(h, e().owner);
    const month = SHOW_AS_OF.slice(0, 7);
    const page = () => SalaryPage({ searchParams: Promise.resolve({ month }) });
    let el = await page();
    const data = dataOf<Sal>(el);
    expect(data.rows).toHaveLength(7);
    expect(data.drafts).toEqual([]);
    expect(resolves(el)).toBeGreaterThan(40);
    expect(sourcedInBoth(el)).toContain("Make the draft");
    cleanup();

    const fields = { start: data.periodStart, end: data.periodEnd };
    expect(await makeSalaryDraftAction(null, keyless(fields))).toEqual({ error: "other" });
    expect(await makeSalaryDraftAction(null, formOf(fields))).toEqual({ done: true });
    el = await page();
    const [draft] = dataOf<Sal>(el).drafts;
    expect(draft?.status).toBe("proposed");
    expect(sourcedInBoth(el)).toContain("Waiting for your approval");
    cleanup();

    await signInShow(h, e().desks.Kalkaji);
    expect(await decideSalaryAction(null, formOf({ draft: draft?.id as string, verdict: "approved" }))).toEqual({ error: "refused" });
    await signInShow(h, owner);
    expect(await decideSalaryAction(null, formOf({ draft: draft?.id as string, verdict: "approved" }))).toEqual({ done: true });
    const [run] = await showRows<{ created_by: string; decided_by: string }>(
      h,
      e().tenantId,
      `select r.created_by::text, d.decided_by::text from books.salary_run r join approval.decision d on d.tenant_id = r.tenant_id and d.id = r.decision_id
        where r.period_start = $1`,
      [data.periodStart],
    );
    expect(run).toEqual({ created_by: owner.memberId, decided_by: owner.memberId });
    const after = dataOf<Sal>(await page());
    expect(after.rows).toEqual([]);
    expect(after.runs[0]?.periodStart).toBe(data.periodStart);
  });

  test("switched off, salary is absent", async () => {
    const owner = await signInShow(h, e().owner);
    await switchCapability(await appPool(), owner, "salary", false);
    try {
      await isAbsent(() => SalaryPage({ searchParams: Promise.resolve({}) }));
    } finally {
      await switchCapability(await appPool(), owner, "salary", true);
    }
  });
});

function addDay(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
