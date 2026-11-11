"use client";

// The calendar's day list with the way to its schedule view above it: the list itself is the calendar's own view.
import { CalendarView } from "../app/PeopleViews";
import { Tabs } from "../app/Kit";
import { useLang } from "../LangProvider";
import { SCHEDULE } from "../../lib/i18n-schedule";
import type { CalendarPage } from "../../lib/server/people";
import "../app/app.css";
import "./schedule.css";

export function CalendarTabs({ data }: { data: CalendarPage }) {
  const { lang } = useLang();
  const s = SCHEDULE[lang];
  return (
    <>
      <div className="wrap sched-switch">
        <Tabs
          label={s.viewsLabel}
          items={[
            { href: `/app/calendar?day=${data.day}`, text: s.viewList, on: true },
            { href: `/app/calendar?view=schedule&day=${data.day}`, text: s.viewSchedule, on: false },
          ]}
        />
      </div>
      <CalendarView data={data} />
    </>
  );
}
