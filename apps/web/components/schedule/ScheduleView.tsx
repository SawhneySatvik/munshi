"use client";

// /app/calendar?view=schedule: the day's bookings on a Bryntum Scheduler, a row per stylist at each branch (a column
// each on a phone, one branch at a time), coloured and labelled by the booking's state, over each stylist's usual hours
// and leave. A drop changes nothing: it is shown as a proposed move beside the original, checked against the slots core
// offers, and made only when the person confirms it (calendar/actions.ts). No money is shown here. A time is the row's
// own moment in <time>; a name comes from the books beside it.
import dynamic from "next/dynamic";
import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import {
  cancelBookingAction,
  checkMoveAction,
  confirmRequestAction,
  declineRequestAction,
  type MoveState,
  moveBookingAction,
} from "../../app/app/calendar/actions";
import { fill } from "../../lib/i18n";
import { APP } from "../../lib/i18n-app";
import { SCHEDULE, type ScheduleDict } from "../../lib/i18n-schedule";
import type { ScheduleEvent, SchedulePage } from "../../lib/server/schedule";
import { calendarDate, clock } from "../../lib/time";
import type { Lang } from "../../lib/types";
import { Button } from "../Button";
import { ActForm, Field, Name, Screen, Tabs } from "../app/Kit";
import { useLang } from "../LangProvider";
import { OpsError } from "../OpsError";
import type { BoardEvent } from "./BryntumBoard";
import "./schedule.css";

function Loading() {
  const { lang } = useLang();
  return <p className="field-note sched-loading">{SCHEDULE[lang].loading}</p>;
}

const BryntumBoard = dynamic(() => import("./BryntumBoard"), { ssr: false, loading: () => <Loading /> });

const PHONE = "(max-width: 640px)";
const STATES = ["confirmed", "requested", "held", "done", "no_show", "proposed"] as const;
const MARK: Record<string, keyof ScheduleDict> = { present: "markPresent", absent: "markAbsent", half_day: "markHalfDay", leave: "markLeave", off: "markOff" };
const REFUSAL = new Set(["not_movable", "service", "not_offered"]);

const Clock = ({ at, lang }: { at: string; lang: Lang }) => <time dateTime={at}>{clock(at, lang)}</time>;

type Proposal = { bookingId: string; resourceId: string; minute: number };

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const q = window.matchMedia(PHONE);
    const on = () => setPhone(q.matches);
    on();
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return phone;
}

function Refusal({ state }: { state: MoveState }) {
  const { lang } = useLang();
  if (!state || !("error" in state)) return null;
  const code = state.error;
  return REFUSAL.has(code) ? <p className="ops-error">{SCHEDULE[lang][code as keyof ScheduleDict]}</p> : <OpsError code={code as Parameters<typeof OpsError>[0]["code"]} />;
}

export function ScheduleView({ data }: { data: SchedulePage }) {
  const { lang } = useLang();
  const s = SCHEDULE[lang];
  const a = APP[lang];
  const phone = usePhone();
  const [shopId, setShopId] = useState(data.shops[0]?.id ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [checked, check, checking] = useActionState(checkMoveAction, null);
  const [moved, move, moving] = useActionState(moveBookingAction, null);

  const byId = useMemo(() => new Map(data.events.map((e) => [e.id, e])), [data.events]);
  const resource = useMemo(() => new Map(data.resources.map((r) => [r.id, r])), [data.resources]);

  // A move made (or half made) ends the proposal; the page has re-rendered from the books.
  useEffect(() => {
    if (moved && ("moved" in moved || "half" in moved)) setProposal(null);
  }, [moved]);

  const resources = (phone ? data.resources.filter((r) => r.shopId === shopId) : data.resources).map((r) => ({
    id: r.id,
    name: r.name,
    shop: r.shop,
    note: r.mark && MARK[r.mark] ? s[MARK[r.mark] as keyof ScheduleDict] : null,
  }));
  const shown = new Set(resources.map((r) => r.id));
  const original = proposal ? byId.get(proposal.bookingId) : undefined;
  const label = (e: ScheduleEvent) => (e.state === "confirmed" || e.state === "requested" || e.state === "held" || e.state === "done" || e.state === "no_show" ? s[e.state] : e.state);
  const events: BoardEvent[] = data.events
    .filter((e) => shown.has(e.resourceId))
    .map((e) => ({
      id: e.id,
      resourceId: e.resourceId,
      startMin: e.startMin,
      endMin: e.endMin,
      title: `${e.service} · ${e.who ?? s.walkIn}`,
      label: label(e),
      state: e.state,
      moving: proposal?.bookingId === e.id,
      draggable: e.movable && !proposal,
    }));
  if (proposal && original && shown.has(proposal.resourceId)) {
    events.push({
      id: `${original.id}~proposed`,
      resourceId: proposal.resourceId,
      startMin: proposal.minute,
      endMin: proposal.minute + (original.endMin - original.startMin),
      title: `${original.service} · ${original.who ?? s.walkIn}`,
      label: s.proposed,
      state: "proposed",
      draggable: false,
    });
  }
  const ranges = data.ranges
    .filter((r) => shown.has(r.resourceId))
    .map((r) => ({ ...r, label: r.kind === "leave" ? s.onLeave : s.usualHours }));

  function onDrop(bookingId: string, resourceId: string, minute: number) {
    const to = resource.get(resourceId);
    if (!to) return;
    setPicked(null);
    setProposal({ bookingId, resourceId, minute });
    const form = new FormData();
    form.set("booking", bookingId);
    form.set("shop", to.shopId);
    form.set("staff", to.staffId);
    form.set("day", data.day);
    form.set("minute", String(minute));
    startTransition(() => check(form));
  }

  const target = proposal ? resource.get(proposal.resourceId) : undefined;
  const fits = checked && "slot" in checked ? checked.slot.at : null;
  const pick = picked ? byId.get(picked) : undefined;
  const q = (day: string, view?: string) => `/app/calendar?${view ? `view=${view}&` : ""}day=${day}`;

  const aside = (
    <>
      {proposal && original && target && (
        <section className="sheet act sched-card" aria-labelledby="move-h">
          <h2 id="move-h" className="act-title">
            {s.moveHeading}
          </h2>
          <p>
            {fill(s.moveWhat, {
              service: <Name>{original.service}</Name>,
              who: original.who ? <Name>{original.who}</Name> : s.walkIn,
              from: <Clock at={original.startsAt} lang={lang} />,
              old: <Name>{resource.get(original.resourceId)?.name ?? ""}</Name>,
              to: fits ? <Clock at={fits} lang={lang} /> : "…",
              staff: <Name>{target.name}</Name>,
            })}
          </p>
          {checking && <p className="field-note">{s.moveChecking}</p>}
          {!checking && fits && <p className="field-note">{s.moveFits}</p>}
          {!checking && <Refusal state={checked} />}
          <p className="field-note">{s.moveHow}</p>
          <form action={move} className="act act-inline">
            <input type="hidden" name="key" value={`${data.formKey}-move-${proposal.bookingId.slice(-12)}`} />
            <input type="hidden" name="booking" value={proposal.bookingId} />
            <input type="hidden" name="shop" value={target.shopId} />
            <input type="hidden" name="staff" value={target.staffId} />
            <input type="hidden" name="day" value={data.day} />
            <input type="hidden" name="minute" value={String(proposal.minute)} />
            <Button type="submit" variant="primary" disabled={!fits || checking || moving}>
              {s.moveConfirm}
            </Button>
            <Button onClick={() => setProposal(null)} disabled={moving}>
              {s.moveDiscard}
            </Button>
          </form>
          <div role="status">
            <Refusal state={moved} />
          </div>
        </section>
      )}
      {moved && ("moved" in moved || "half" in moved) && (
        <p role="status" className={"moved" in moved ? "act-done" : "ops-error"}>
          {"moved" in moved ? s.moveDone : s.moveHalf}
        </p>
      )}
      <section className="sheet act sched-card" aria-labelledby="pick-h">
        <h2 id="pick-h" className="act-title">
          {s.pickHeading}
        </h2>
        {pick ? (
          <>
            <p className="app-title">
              <Clock at={pick.startsAt} lang={lang} />–<Clock at={pick.endsAt} lang={lang} /> <Name>{pick.service}</Name>
            </p>
            <p className="l-sub">
              {pick.who ? <Name>{pick.who}</Name> : s.walkIn} · <Name>{resource.get(pick.resourceId)?.name ?? ""}</Name> ·{" "}
              <Name>{resource.get(pick.resourceId)?.shop ?? ""}</Name>
            </p>
            <p>
              <span className={`sched-chip sched-${pick.state}`}>{label(pick)}</span>
            </p>
            {pick.state === "requested" && (
              <>
                <p className="field-note">{s.requestNote}</p>
                {data.canMove && (
                  <div className="l-row app-steps">
                    <ActForm action={confirmRequestAction} formKey={data.formKey} tag={`confirm-${pick.id.slice(-12)}`} submit={s.confirmRequest} inline primary>
                      <input type="hidden" name="booking" value={pick.id} />
                    </ActForm>
                    <ActForm action={declineRequestAction} formKey={data.formKey} tag={`decline-${pick.id.slice(-12)}`} submit={s.declineRequest} inline>
                      <input type="hidden" name="booking" value={pick.id} />
                    </ActForm>
                  </div>
                )}
              </>
            )}
            {pick.state === "held" && <p className="field-note">{s.heldNote}</p>}
            {pick.state === "confirmed" && data.canMove && (
              <ActForm action={cancelBookingAction} formKey={data.formKey} tag={`cancel-${pick.id.slice(-12)}`} submit={s.cancelBooking} inline>
                <input type="hidden" name="booking" value={pick.id} />
                <p className="field-note">{s.cancelNote}</p>
              </ActForm>
            )}
          </>
        ) : (
          <p className="field-note">{s.pickNone}</p>
        )}
        {!data.canMove && <p className="field-note">{s.readOnly}</p>}
      </section>
    </>
  );

  return (
    <Screen
      frame={data}
      id="schedule-h"
      wide
      kicker={fill(a.calendarKicker, { shop: <span data-name="">{data.shop}</span> })}
      title={a.calendarTitle}
      lede={s.lede}
      aside={aside}
    >
      <Tabs
        label={s.viewsLabel}
        items={[
          { href: q(data.day), text: s.viewList, on: false },
          { href: q(data.day, "schedule"), text: s.viewSchedule, on: true },
        ]}
      />
      <Tabs
        label={a.calendarTitle}
        items={[
          { href: q(data.prevDay, "schedule"), text: a.dayPrev, on: false },
          { href: q(data.day, "schedule"), text: <time dateTime={data.day}>{calendarDate(data.day, lang)}</time>, on: true },
          { href: q(data.nextDay, "schedule"), text: a.dayNext, on: false },
        ]}
      />
      {phone && data.shops.length > 1 && (
        <Field label={s.branchPick}>
          <select className="input" value={shopId} onChange={(e) => setShopId(e.target.value)}>
            {data.shops.map((x) => (
              <option key={x.id} value={x.id} data-name="">
                {x.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ul className="sched-legend" aria-label={s.legend}>
        {STATES.map((k) => (
          <li key={k}>
            <span className={`sched-chip sched-${k}`}>{s[k]}</span>
          </li>
        ))}
        <li>
          <span className="sched-chip sched-range-hours">{s.usualHours}</span>
        </li>
        <li>
          <span className="sched-chip sched-range-leave">{s.onLeave}</span>
        </li>
      </ul>
      <div className={`sched-board${phone ? " is-phone" : ""}`} data-testid="schedule-board">
        <BryntumBoard
          day={data.day}
          fromHour={data.fromHour}
          toHour={data.toHour}
          vertical={phone}
          grouped={data.shops.length > 1}
          columnTitle={s.stylist}
          unavailable={s.unavailable}
          resources={resources}
          events={events}
          ranges={ranges}
          onDrop={onDrop}
          onPick={(id) => setPicked(id.endsWith("~proposed") ? null : id)}
        />
      </div>
      {phone && <p className="field-note">{s.phoneNote}</p>}
      <p className="sched-credit">
        {s.credit}{" "}
        <a href="https://bryntum.com/products/scheduler/" rel="noopener noreferrer" target="_blank">
          bryntum.com
        </a>
      </p>
    </Screen>
  );
}
