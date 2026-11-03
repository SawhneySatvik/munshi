"use client";

import { fill } from "../lib/i18n";
import { calendarDate } from "../lib/time";
import { useLang } from "./LangProvider";
import { Sticker } from "./Sticker";

/**
 * "Recorded demo · business day 27 Oct": while model answers are replayed from recordings, the sample shop's pages read
 * its books as of the day they were seeded as of, whatever today's date (the back office holds it there). `day` is the
 * business date the page read as of, as the server stored it; nothing shows without one.
 */
export function DemoDay({ day }: { day: string | null | undefined }) {
  const { lang, t } = useLang();
  if (!day) return null;
  return (
    <span className="demo-day" data-demo-day={day}>
      {/* One inline run inside the sticker (a flex box), so the space before the date is kept. */}
      <Sticker tone="yellow">
        <span>{fill(t.demoDay, { date: <time dateTime={day}>{calendarDate(day, lang)}</time> })}</span>
      </Sticker>
    </span>
  );
}
