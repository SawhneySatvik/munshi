"use client";

// The people screens: the calendar, the requests, staff and salary. A booking's time, a shift's hours and a leave's days
// are the rows' own moments, in <time>; money and day counts are <Figure>s of snapshot cells.
import { bookDeskAction } from "../../app/app/calendar/actions";
import { confirmBookingAction, declineBookingAction } from "../../app/app/requests/actions";
import { advanceAction, leaveAction, markAction } from "../../app/app/staff/actions";
import { decideSalaryAction, makeSalaryDraftAction } from "../../app/app/staff/salary/actions";
import { fill } from "../../lib/i18n";
import { APP, type AppDict } from "../../lib/i18n-app";
import type { BookingRow, CalendarPage, RequestsPage, SalaryPage, StaffPage } from "../../lib/server/people";
import { calendarDate, clock, monthYear } from "../../lib/time";
import type { Lang } from "../../lib/types";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { ActForm, Field, Group, Name, Row, Screen, Tabs, Tag, When } from "./Kit";

const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const Day = ({ day, lang }: { day: string; lang: Lang }) => <time dateTime={day}>{calendarDate(day, lang)}</time>;
const Clock = ({ at, lang }: { at: string; lang: Lang }) => <time dateTime={at}>{clock(at, lang)}</time>;
// A shift's hours ("11:00") are the roster row's own.
const Hour = ({ hm }: { hm: string }) => <time dateTime={hm}>{hm}</time>;

const STATE: Record<string, keyof AppDict> = {
  requested: "bookingRequested",
  confirmed: "bookingConfirmed",
  done: "bookingDone",
  no_show: "bookingNoShow",
};

function BookingLine({ b, showStaff = false }: { b: BookingRow; showStaff?: boolean }) {
  const { lang } = useLang();
  const a = APP[lang];
  const held = b.state === "held";
  return (
    <Row
      title={
        <>
          <Clock at={b.startsAt} lang={lang} />–<Clock at={b.endsAt} lang={lang} /> <Name>{b.service}</Name>
        </>
      }
      sub={
        <>
          {showStaff && (
            <>
              <Name>{b.staff}</Name> · <Name>{b.shop}</Name> ·{" "}
            </>
          )}
          {b.who ? <Name>{b.who}</Name> : a.bookingWalkIn}
        </>
      }
      amt={
        held ? (
          <Tag tone="warn">{fill(a.bookingHeld, { at: b.expiresAt ? <Clock at={b.expiresAt} lang={lang} /> : "" })}</Tag>
        ) : (
          <Tag tone={b.state === "requested" ? "warn" : b.state === "confirmed" ? "ok" : "ink"}>{a[STATE[b.state] ?? "bookingConfirmed"]}</Tag>
        )
      }
    />
  );
}

/** /app/calendar: a day's bookings at every branch, a column per stylist; holds faint, requests marked; the desk's form. */
export function CalendarView({ data }: { data: CalendarPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const desk = data.may.includes("booking.confirm");
  const q = (day: string) => `/app/calendar?day=${day}${data.chosen.shopId ? `&shop=${data.chosen.shopId}` : ""}${data.chosen.serviceId ? `&service=${data.chosen.serviceId}` : ""}`;
  return (
    <Screen
      frame={data}
      id="calendar-h"
      kicker={fill(a.calendarKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.calendarTitle}
      lede={a.calendarLede}
      aside={
        desk && (
          <section className="sheet act" aria-labelledby="desk-h">
            <h2 id="desk-h" className="act-title">
              {a.deskHeading}
            </h2>
            <form method="get" action="/app/calendar" className="act">
              <input type="hidden" name="day" value={data.day} />
              <Field label={a.branch}>
                <select name="shop" className="input" defaultValue={data.chosen.shopId ?? data.shops[0]?.id}>
                  {data.shops.map((s) => (
                    <option key={s.id} value={s.id} data-name="">
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={a.deskService}>
                <select name="service" className="input" defaultValue={data.chosen.serviceId ?? ""}>
                  <option value="" disabled>
                    {a.pick}
                  </option>
                  {data.services.map((s) => (
                    <option key={s.id} value={s.id} data-name="">
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className="press">
                {a.deskFind}
              </button>
            </form>
            {data.desk &&
              (data.desk.options.length ? (
                <ActForm action={bookDeskAction} formKey={data.formKey} tag="desk" submit={a.deskSubmit} primary inline>
                  <input type="hidden" name="shop" value={data.desk.shopId} />
                  <input type="hidden" name="service" value={data.desk.serviceId} />
                  <Field label={a.deskSlot}>
                    <select name="slot" className="input" required>
                      {data.desk.options.map((o) => (
                        <option key={o.value} value={o.value} data-name="">
                          {clock(o.at, lang)} · {o.staff}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={a.customer}>
                    <select name="customer" className="input" defaultValue="">
                      <option value="">{a.bookingWalkIn}</option>
                      {data.customers.map((k) => (
                        <option key={k.id} value={k.id} data-name="">
                          {k.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </ActForm>
              ) : (
                <p className="field-note">{a.deskNoSlots}</p>
              ))}
            <p className="field-note">{a.deskNote}</p>
          </section>
        )
      }
    >
      <Tabs
        label={a.calendarTitle}
        items={[
          { href: q(shift(data.day, -1)), text: a.dayPrev, on: false },
          { href: q(data.day), text: <Day day={data.day} lang={lang} />, on: true },
          { href: q(shift(data.day, 1)), text: a.dayNext, on: false },
        ]}
      />
      {data.shops.map((s) => (
        <section key={s.id} className="app-board" aria-labelledby={`shop-${s.id}`}>
          <h2 id={`shop-${s.id}`} className="ops-h">
            <Name>{s.name}</Name>
          </h2>
          <div className="app-cols">
            {s.columns.map((col) => (
              <Group key={col.staffId} id={`col-${s.id}-${col.staffId}`} title={<Name>{col.name}</Name>} empty={a.calendarEmpty}>
                {col.bookings.map((b) => (
                  <BookingLine key={b.id} b={b} />
                ))}
              </Group>
            ))}
          </div>
        </section>
      ))}
    </Screen>
  );
}

const WINDOW: Record<string, keyof AppDict> = { morning: "windowMorning", afternoon: "windowAfternoon", evening: "windowEvening" };

/** /app/requests: booking requests to confirm or decline, and the site's enquiries and booking requests. */
export function RequestsView({ data }: { data: RequestsPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const can = data.may.includes("booking.confirm");
  return (
    <Screen frame={data} id="requests-h" kicker={fill(a.requestsKicker, { shop: <span data-name="">{data.shop}</span> })} title={a.requestsTitle} lede={a.requestsLede}>
      {data.bookingsOn && (
        <Group id="breq-h" title={a.bookingRequestsHeading} empty={a.bookingRequestsEmpty}>
          {data.bookings.map((b) => (
            <div key={b.id}>
              <BookingLine b={b} showStaff />
              {can && (
                <div className="l-row app-steps">
                  <ActForm action={confirmBookingAction} formKey={data.formKey} tag={`confirm-${b.id.slice(-12)}`} submit={a.confirm} inline primary>
                    <input type="hidden" name="booking" value={b.id} />
                  </ActForm>
                  <ActForm action={declineBookingAction} formKey={data.formKey} tag={`decline-${b.id.slice(-12)}`} submit={a.decline} inline>
                    <input type="hidden" name="booking" value={b.id} />
                  </ActForm>
                </div>
              )}
            </div>
          ))}
        </Group>
      )}
      <Group id="sreq-h" title={a.siteRequestsHeading} note={a.siteRequestNote} empty={a.siteRequestsEmpty}>
        {data.requests.map((r) => (
          <Row
            key={r.id}
            title={
              <>
                {r.who ? <Name>{r.who}</Name> : "—"} <Tag>{r.kind === "enquiry" ? a.kindEnquiry : a.kindBookingRequest}</Tag>
              </>
            }
            sub={
              <>
                <Name>{r.shop}</Name> · <When at={r.at} />
                {r.preferredOn && <> · {fill(a.prefers, { day: <Day day={r.preferredOn} lang={lang} />, window: r.window ? a[WINDOW[r.window] ?? "windowMorning"] : "" })}</>}
              </>
            }
          >
            {r.items.length > 0 && (
              <p className="app-line">
                <Name>{r.items.join(", ")}</Name>
              </p>
            )}
            {r.note && (
              <blockquote className="app-quote" data-said="">
                {r.note}
              </blockquote>
            )}
          </Row>
        ))}
      </Group>
    </Screen>
  );
}

const WEEKDAY = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], hi: ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"] };
const STATUS: Record<string, keyof AppDict> = { present: "statusPresent", absent: "statusAbsent", half_day: "statusHalf", leave: "statusLeave", off: "statusOff" };
const ROLE: Record<string, keyof AppDict> = { owner: "roleOwnerWord", manager: "roleManagerWord", staff: "roleStaffWord" };
const LEAVE: Record<string, keyof AppDict> = { paid: "leavePaid", unpaid: "leaveUnpaid", sick: "leaveSick" };

/** /app/staff: the team with each one's week, today's mark, leave and advance outstanding; the forms that record them. */
export function StaffView({ data }: { data: StaffPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const people = data.staff.filter((p) => p.name);
  return (
    <Screen
      frame={data}
      id="staff-h"
      kicker={fill(a.staffKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.staffTitle}
      lede={a.staffLede}
      aside={
        <>
          {data.may.includes("leave.record") && (
            <ActForm action={leaveAction} formKey={data.formKey} tag="leave" title={a.leaveHeading} submit={a.leaveSubmit}>
              <Field label={a.leaveWho}>
                <select name="staff" className="input" defaultValue="" required>
                  <option value="" disabled>
                    {a.pick}
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id} data-name="">
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={a.leaveKind}>
                <select name="kind" className="input" defaultValue="paid">
                  <option value="paid">{a.leavePaid}</option>
                  <option value="unpaid">{a.leaveUnpaid}</option>
                  <option value="sick">{a.leaveSick}</option>
                </select>
              </Field>
              <div className="act-pair">
                <Field label={a.leaveFrom}>
                  <input name="from" type="date" className="input" required />
                </Field>
                <Field label={a.leaveTo}>
                  <input name="to" type="date" className="input" />
                </Field>
              </div>
            </ActForm>
          )}
          {data.may.includes("advance.give") && (
            <ActForm action={advanceAction} formKey={data.formKey} tag="advance" title={a.advanceHeading} submit={a.advanceSubmit}>
              <Field label={a.leaveWho}>
                <select name="staff" className="input" defaultValue="" required>
                  <option value="" disabled>
                    {a.pick}
                  </option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id} data-name="">
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={a.advanceAmount}>
                <input name="amount" className="input" inputMode="decimal" required autoComplete="off" />
              </Field>
              <Field label={a.advanceMethod}>
                <select name="method" className="input" defaultValue="cash">
                  <option value="cash">{a.methodCash}</option>
                  <option value="upi">{a.methodUpi}</option>
                  <option value="bank">{a.methodBank}</option>
                </select>
              </Field>
              <p className="field-note">{a.advanceNote}</p>
            </ActForm>
          )}
        </>
      }
    >
      <Group id="team-h" title={a.staffHeading} empty={a.staffEmpty}>
        {data.staff.map((p) => (
          <Row
            key={p.id}
            title={<Name>{p.name}</Name>}
            sub={
              <>
                {p.shop && <Name>{p.shop}</Name>}
                {p.owed && <> · {fill(a.advanceOwed, { n: <Figure cell={p.owed} /> })}</>}
              </>
            }
            amt={
              p.mark ? (
                <Tag tone={p.mark.status === "present" ? "ok" : "ink"}>{a[STATUS[p.mark.status] ?? "statusPresent"]}</Tag>
              ) : (
                <Tag tone="warn">{a.notMarked}</Tag>
              )
            }
          >
            <p className="l-sub">
              {p.week
                .slice()
                .sort((x, y) => x.weekday - y.weekday)
                .map((d, i) => (
                  <span key={d.weekday}>
                    {i > 0 && " · "}
                    {WEEKDAY[lang][d.weekday - 1]}{" "}
                    {d.off || !d.starts || !d.ends ? (
                      a.rosterOff
                    ) : (
                      <>
                        <Hour hm={d.starts} />–<Hour hm={d.ends} />
                      </>
                    )}
                  </span>
                ))}
            </p>
            {p.mark && <p className="l-sub">{fill(a.markedBy, { role: a[ROLE[p.mark.byRole] ?? "roleStaffWord"] })}</p>}
            {p.leave.map((l) => (
              <p key={l.id} className="l-sub">
                {fill(a.leaveLine, { kind: a[LEAVE[l.kind] ?? "leavePaid"], from: <Day day={l.firstDay} lang={lang} />, to: <Day day={l.lastDay} lang={lang} /> })}
              </p>
            ))}
            {data.may.includes("attendance.mark") && p.shopId && (
              <ActForm action={markAction} formKey={data.formKey} tag={`mark-${p.id.slice(-12)}`} submit={a.markSubmit} inline label={`${a.todayMark}: ${p.name}`}>
                <input type="hidden" name="staff" value={p.id} />
                <input type="hidden" name="shop" value={p.shopId} />
                <input type="hidden" name="day" value={data.today} />
                <Field label={a.todayMark}>
                  <select name="status" className="input" defaultValue={p.mark?.status ?? "present"}>
                    {Object.entries(STATUS).map(([k, w]) => (
                      <option key={k} value={k}>
                        {a[w]}
                      </option>
                    ))}
                  </select>
                </Field>
              </ActForm>
            )}
          </Row>
        ))}
      </Group>
    </Screen>
  );
}

const DRAFT: Record<string, keyof AppDict> = { executed: "draftExecuted", rejected: "draftRejected", stale: "draftStale" };

/** /app/staff/salary: the month's preview (every figure a cell), the draft the owner makes from it, and the runs. */
export function SalaryView({ data }: { data: SalaryPage }) {
  const { lang } = useLang();
  const a = APP[lang];
  const owner = data.may.includes("salary.run");
  const waiting = data.drafts.filter((d) => d.status === "proposed");
  const month = (by: number) => {
    const [y, m] = data.month.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
  };
  const label = (m: string) => <time dateTime={m}>{monthYear(m, lang)}</time>;
  return (
    <Screen
      frame={data}
      id="salary-h"
      kicker={fill(a.salaryKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.salaryTitle}
      lede={a.salaryLede}
      aside={
        owner &&
        data.rows.length > 0 &&
        waiting.length === 0 && (
          <ActForm action={makeSalaryDraftAction} formKey={data.formKey} tag="draft" title={a.makeDraft} submit={a.makeDraft} primary>
            <input type="hidden" name="start" value={data.periodStart} />
            <input type="hidden" name="end" value={data.periodEnd} />
            <p className="field-note">{fill(a.previewCount, { n: <Figure cell={data.count} /> })}</p>
            <p className="field-note">{a.makeDraftNote}</p>
          </ActForm>
        )
      }
    >
      <Tabs label={a.month} items={[-1, 0, 1].map((by) => ({ href: `/app/staff/salary?month=${month(by)}`, text: label(month(by)), on: by === 0 }))} />
      <Group id="drafts-salary" title={a.draftsSalaryHeading} empty={a.draftsSalaryEmpty}>
        {data.drafts.map((d) => (
          <Row
            key={d.id}
            title={d.status === "proposed" ? <Tag tone="warn">{a.draftWaiting}</Tag> : <Tag>{a[DRAFT[d.status] ?? "draftExecuted"]}</Tag>}
            sub={<When at={d.at} />}
          >
            {d.status === "proposed" && owner && (
              <div className="app-steps">
                <ActForm action={decideSalaryAction} formKey={data.formKey} tag={`approve-${d.id.slice(-12)}`} submit={a.approve} inline primary>
                  <input type="hidden" name="draft" value={d.id} />
                  <input type="hidden" name="verdict" value="approved" />
                </ActForm>
                <ActForm action={decideSalaryAction} formKey={data.formKey} tag={`reject-${d.id.slice(-12)}`} submit={a.reject} inline>
                  <input type="hidden" name="draft" value={d.id} />
                  <input type="hidden" name="verdict" value="rejected" />
                </ActForm>
              </div>
            )}
          </Row>
        ))}
      </Group>
      <Group id="preview-h" title={a.previewHeading} empty={a.previewEmpty}>
        {data.rows.map((r) => (
          <Row
            key={r.staffId}
            title={<Name>{r.name}</Name>}
            sub={fill(r.payKind === "monthly" ? a.previewPayMonth : a.previewPay, { pay: <Figure cell={r.pay} /> })}
            amt={<Figure cell={r.net} />}
          >
            <p className="l-sub">
              {fill(a.previewLine, {
                days: <Figure cell={r.days} />,
                unpaid: <Figure cell={r.unpaid} />,
                gross: <Figure cell={r.gross} />,
                recovered: <Figure cell={r.recovered} />,
              })}
            </p>
          </Row>
        ))}
      </Group>
      <Group id="runs-h" title={a.runsHeading} empty={a.runsEmpty}>
        {data.runs.map((r) => (
          <Row
            key={r.id}
            title={fill(a.runLine, { from: <Day day={r.periodStart} lang={lang} />, to: <Day day={r.periodEnd} lang={lang} /> })}
            sub={
              <>
                {fill(a.runBy, { name: <Name>{r.by}</Name> })} · <When at={r.at} />
              </>
            }
          />
        ))}
      </Group>
    </Screen>
  );
}
