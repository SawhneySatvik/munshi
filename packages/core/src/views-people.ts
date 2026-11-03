// The people screens (apps/web/lib/server/people.ts shows them): the calendar (a day's bookings by stylist across
// branches, and the free slots for a desk booking), the requests waiting (booking requests and the site's enquiries),
// staff (roster, today's attendance, leave and advances) and salary (the month's preview, the salary.run drafts and the
// runs). In the page's one transaction, each only while the shop can use its capability. Money is a cell of a named
// read; a time or a day a row holds is shown as that row's own moment; a staff member's or a customer's name comes from
// the vault beside the figures, never as one.
import { can } from './capabilities.ts';
import { COUNT_COL, type CellRef } from './read.ts';
import { mayReadIn } from './read-roles.ts';
import type { Session } from './session.ts';
import { type Slot, slotsIn } from './slots.ts';
import { addDays, businessDate } from './time.ts';
import { type Client, customerList, mint, read, type StoredSnapshot, type Viewer, viewer } from './views-common.ts';
import { type Shop, shopList } from './views-sell.ts';

export type Person = { id: string; name: string; shopId: string | null };

/** Every staff member by name (the vault's contact through their link in effect), with the branch of their terms. */
export async function staffList(c: Client): Promise<Person[]> {
  const rows = await read<{ id: string; name: string | null; erased: boolean; shop_id: string | null }>(
    c,
    `select s.id::text, ct.name, ct.erased_at is not null as erased,
            (select t.shop_id::text from books.staff_terms t where t.tenant_id = s.tenant_id and t.staff_id = s.id
              order by t.effective_from desc, t.created_at desc, t.id desc limit 1) as shop_id
       from books.staff s
       left join lateral (select l.contact_id from books.party_contact l where l.tenant_id = s.tenant_id and l.staff_id = s.id and l.effective_from <= now()
                           order by l.effective_from desc, l.created_at desc, l.id desc limit 1) l on true
       left join ops.contact ct on ct.tenant_id = s.tenant_id and ct.id = l.contact_id
      order by ct.name, s.id`,
  );
  return rows.map((r) => ({ id: r.id, name: r.erased ? 'Erased' : (r.name ?? ''), shopId: r.shop_id }));
}

const services = (c: Client) =>
  read<{ id: string; name: string; duration_min: number }>(
    c,
    `select i.id::text, r.name, r.duration_min from books.item i
       join lateral (select v.name, v.duration_min from books.item_revision v where v.tenant_id = i.tenant_id and v.item_id = i.id and v.effective_from <= now()
                      order by v.effective_from desc, v.created_at desc, v.id desc limit 1) r on true
      where i.kind = 'service' and r.duration_min is not null order by r.name, i.id`,
  );

export type Booking = {
  id: string;
  shopId: string;
  staffId: string;
  service: string;
  startsAt: string;
  endsAt: string;
  state: string;
  source: string;
  expiresAt: string | null;
  customerId: string | null;
  contactName: string | null;
};

const BOOKING_COLS = `b.id::text, b.shop_id::text, b.staff_id::text, b.state, b.source, lower(b.during) as starts_at, upper(b.during) as ends_at,
  b.expires_at, b.customer_id::text,
  (select r.name from books.item_revision r where r.tenant_id = b.tenant_id and r.item_id = b.service_item_id and r.effective_from <= now()
    order by r.effective_from desc, r.created_at desc, r.id desc limit 1) as service,
  (select bc.contact_name from ops.booking_contact bc where bc.tenant_id = b.tenant_id and bc.booking_id = b.id and bc.erased_at is null) as contact_name`;
type BookingRow = {
  id: string;
  shop_id: string;
  staff_id: string;
  state: string;
  source: string;
  starts_at: Date;
  ends_at: Date;
  expires_at: Date | null;
  customer_id: string | null;
  service: string;
  contact_name: string | null;
};
const booking = (b: BookingRow): Booking => ({
  id: b.id,
  shopId: b.shop_id,
  staffId: b.staff_id,
  service: b.service,
  startsAt: b.starts_at.toISOString(),
  endsAt: b.ends_at.toISOString(),
  state: b.state,
  source: b.source,
  expiresAt: b.expires_at?.toISOString() ?? null,
  customerId: b.customer_id,
  contactName: b.contact_name,
});

export type CalendarView = {
  viewer: Viewer;
  day: string;
  shops: Shop[];
  staff: Person[];
  bookings: Booking[];
  services: { id: string; name: string; durationMin: number }[];
  customers: { id: string; name: string }[];
  // The free slots for the desk's chosen branch and service that day (slotsIn: the roster less what is booked).
  slots: { shopId: string; serviceId: string; offered: Slot[] } | null;
};

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A day's bookings at every branch (live holds, requests, confirmed, done, no-shows), and the desk's free slots. */
export async function viewCalendar(
  c: Client,
  session: Session,
  opts: { day?: string | null; shopId?: string | null; serviceId?: string | null } = {},
): Promise<CalendarView | null> {
  if (!(await can(c, session, 'bookings')) || !(await mayReadIn(c, 'screen.calendar'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const day = opts.day && DAY.test(opts.day) ? opts.day : businessDate(new Date(), me.timeZone);
  const shops = await shopList(c);
  const rows = await read<BookingRow>(
    c,
    `select ${BOOKING_COLS} from ops.booking b
      where (lower(b.during) at time zone (select time_zone from ops.tenant))::date = $1::date
        and (b.state in ('requested', 'confirmed', 'done', 'no_show') or (b.state = 'held' and b.expires_at > now()))
      order by lower(b.during), b.id limit 500`,
    [day],
  );
  const list = await services(c);
  const shop = shops.find((s) => s.id === opts.shopId);
  const service = list.find((s) => s.id === opts.serviceId);
  const slots =
    shop && service && UUID.test(service.id) ? { shopId: shop.id, serviceId: service.id, offered: await slotsIn(c, { shopId: shop.id, serviceItemId: service.id, day }) } : null;
  return {
    viewer: me,
    day,
    shops,
    staff: await staffList(c),
    bookings: rows.map(booking),
    services: list.map((s) => ({ id: s.id, name: s.name, durationMin: s.duration_min })),
    customers: await customerList(c),
    slots,
  };
}

export type SiteRequest = {
  id: string;
  kind: string;
  shopId: string;
  contactName: string | null;
  preferredOn: string | null;
  window: string | null;
  note: string | null;
  createdAt: string;
  items: string[];
};
export type RequestsView = { viewer: Viewer; shops: Shop[]; staff: Person[]; bookings: Booking[]; requests: SiteRequest[]; bookingsOn: boolean };

/** The booking requests to confirm or decline, and the site's enquiries and booking requests not yet handled. The
 * office's (read-roles.ts): no named read stands for it, so it is gated as the screen it is (SCREENS). */
export async function viewRequests(c: Client, session: Session): Promise<RequestsView | null> {
  if (!(await mayReadIn(c, 'screen.requests'))) return null; // the office's (read-roles.ts SCREENS)
  const bookingsOn = await can(c, session, 'bookings');
  if (!bookingsOn && !(await can(c, session, 'site'))) return null;
  const me = await viewer(c, session);
  const rows = bookingsOn
    ? await read<BookingRow>(c, `select ${BOOKING_COLS} from ops.booking b where b.state = 'requested' order by lower(b.during), b.id limit 200`)
    : [];
  const requests = await read<{
    id: string;
    kind: string;
    shop_id: string;
    contact_name: string | null;
    preferred_on: string | null;
    time_window: string | null;
    note: string | null;
    created_at: Date;
    items: string[];
  }>(
    c,
    `select q.id::text, q.kind, q.shop_id::text, q.contact_name, q.preferred_on::text, q.time_window, q.note, q.created_at,
            array(select (select r.name from books.item_revision r where r.tenant_id = q.tenant_id and r.item_id = x and r.effective_from <= now()
                           order by r.effective_from desc, r.created_at desc, r.id desc limit 1)
                    from unnest(q.item_ids) x) as items
       from ops.site_request q where q.status = 'new' and q.erased_at is null order by q.created_at, q.id limit 200`,
  );
  return {
    viewer: me,
    shops: await shopList(c),
    staff: await staffList(c),
    bookings: rows.map(booking),
    bookingsOn,
    requests: requests.map((q) => ({
      id: q.id,
      kind: q.kind,
      shopId: q.shop_id,
      contactName: q.contact_name,
      preferredOn: q.preferred_on,
      window: q.time_window,
      note: q.note,
      createdAt: q.created_at.toISOString(),
      items: q.items.filter(Boolean),
    })),
  };
}

export type Shift = { staffId: string; shopId: string; weekday: number; starts: string | null; ends: string | null; off: boolean };
export type Mark = { staffId: string; status: string; byRole: string; inAt: string | null; outAt: string | null };
export type Leave = { id: string; staffId: string; kind: string; firstDay: string; lastDay: string; halfDay: boolean };
export type StaffView = {
  viewer: Viewer;
  today: string;
  shops: Shop[];
  staff: Person[];
  roster: Shift[];
  marks: Mark[];
  leave: Leave[];
  advances: { staffId: string; snapshot: StoredSnapshot }[];
};

// A staff page reads each staff member's advances (staff.advances); past this many, the rest are not read.
const ADVANCE_ROWS = 60;

/** The week's roster in effect per weekday, today's attendance (the mark that counts), leave from today on, advances. */
export async function viewStaff(c: Client, session: Session): Promise<StaffView | null> {
  if (!(await can(c, session, 'staff')) || !(await mayReadIn(c, 'staff.advances'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const today = businessDate(new Date(), me.timeZone);
  const staff = await staffList(c);
  const roster = await read<{ staff_id: string; shop_id: string; weekday: number; starts: string | null; ends: string | null; off: boolean }>(
    c,
    `select distinct on (p.staff_id, p.weekday) p.staff_id::text, p.shop_id::text, p.weekday, to_char(p.starts, 'HH24:MI') as starts, to_char(p.ends, 'HH24:MI') as ends, p.off
       from books.shift_pattern p where p.effective_from <= $1::date
      order by p.staff_id, p.weekday, p.effective_from desc, p.created_at desc, p.id desc`,
    [today],
  );
  // The day's mark that counts: an owner's or manager's over a staff member's own, then the latest.
  const marks = await read<{ staff_id: string; status: string; marked_by_role: string; in_at: Date | null; out_at: Date | null }>(
    c,
    `select distinct on (a.staff_id) a.staff_id::text, a.status, a.marked_by_role, a.in_at, a.out_at from books.attendance a
      where a.day = $1::date order by a.staff_id, a.marked_by_role = 'staff', a.created_at desc, a.id desc`,
    [today],
  );
  const leave = await read<{ id: string; staff_id: string; kind: string; first_day: string; last_day: string; half_day: boolean }>(
    c,
    `select l.id::text, l.staff_id::text, l.kind, l.first_day::text, l.last_day::text, l.half_day from books.leave l
      where l.reverses_id is null and l.last_day >= $1::date and not exists (select 1 from books.leave x where x.tenant_id = l.tenant_id and x.reverses_id = l.id)
      order by l.first_day, l.id limit 200`,
    [today],
  );
  const advances: StaffView['advances'] = [];
  const given = await read<{ staff_id: string }>(c, 'select distinct staff_id::text from books.advance order by 1');
  for (const g of given.slice(0, ADVANCE_ROWS)) advances.push({ staffId: g.staff_id, snapshot: await mint(c, 'staff.advances', { staff_id: g.staff_id }) });
  return {
    viewer: me,
    today,
    shops: await shopList(c),
    staff,
    roster: roster.map((r) => ({ staffId: r.staff_id, shopId: r.shop_id, weekday: r.weekday, starts: r.starts, ends: r.ends, off: r.off })),
    marks: marks.map((m) => ({ staffId: m.staff_id, status: m.status, byRole: m.marked_by_role, inAt: m.in_at?.toISOString() ?? null, outAt: m.out_at?.toISOString() ?? null })),
    leave: leave.map((l) => ({ id: l.id, staffId: l.staff_id, kind: l.kind, firstDay: l.first_day, lastDay: l.last_day, halfDay: l.half_day })),
    advances,
  };
}

export type SalaryDraft = { id: string; status: string; periodStart: string; periodEnd: string; basedOn: CellRef[]; createdAt: string };
export type SalaryView = {
  viewer: Viewer;
  month: string;
  periodStart: string;
  periodEnd: string;
  staff: Person[];
  preview: StoredSnapshot;
  drafts: SalaryDraft[];
  runs: { id: string; periodStart: string; periodEnd: string; createdAt: string; by: string }[];
};

const MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/** A month's salary preview (salary.preview, every figure a cell), its salary.run drafts and the runs made. */
export async function viewSalary(c: Client, session: Session, month: string | null): Promise<SalaryView | null> {
  if (!(await can(c, session, 'salary')) || !(await mayReadIn(c, 'salary.preview'))) return null; // the office's (read-roles.ts)
  const me = await viewer(c, session);
  const m = month && MONTH.test(month) ? month : businessDate(new Date(), me.timeZone).slice(0, 7);
  const periodStart = `${m}-01`;
  const periodEnd = addDays(`${addDays(periodStart, 32).slice(0, 7)}-01`, -1);
  const drafts = await read<{ id: string; status: string; payload: { periodStart: string; periodEnd: string }; based_on: CellRef[]; created_at: Date }>(
    c,
    `select id::text, status, payload, based_on, created_at from approval.draft
      where command = 'salary.run' and payload->>'periodStart' = $1 order by created_at desc limit 20`,
    [periodStart],
  );
  const runs = await read<{ id: string; period_start: string; period_end: string; created_at: Date; by: string }>(
    c,
    `select r.id::text, r.period_start::text, r.period_end::text, r.created_at, m.display_name as by
       from books.salary_run r join ops.member m on m.tenant_id = r.tenant_id and m.id = r.created_by
      order by r.period_start desc, r.created_at desc limit 12`,
  );
  return {
    viewer: me,
    month: m,
    periodStart,
    periodEnd,
    staff: await staffList(c),
    preview: await mint(c, 'salary.preview', { period_start: periodStart, period_end: periodEnd }),
    drafts: drafts.map((d) => ({
      id: d.id,
      status: d.status,
      periodStart: d.payload.periodStart,
      periodEnd: d.payload.periodEnd,
      basedOn: d.based_on,
      createdAt: d.created_at.toISOString(),
    })),
    runs: runs.map((r) => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, createdAt: r.created_at.toISOString(), by: r.by })),
  };
}

/** The draft a salary page makes cites its preview's row count (the preview's every cell is re-read at approval). */
export const previewCount = (snapshotId: string): CellRef => ({ snapshotId, row: 0, col: COUNT_COL });
