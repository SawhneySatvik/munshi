import type { Lang } from "./types";

// The one time-zone module: every timestamp the app shows is read in the shop's zone here, then worded per language.
const ZONE = "Asia/Kolkata";

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h23",
});

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = { en: WEEKDAYS_EN, hi: ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"] };
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  hi: ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"],
};

type Moment = { weekday: number; day: number; month: number; hour: number; minute: number };

function inZone(iso: string): Moment {
  const p: Record<string, string> = {};
  for (const { type, value } of parts.formatToParts(new Date(iso))) p[type] = value;
  return {
    weekday: WEEKDAYS_EN.indexOf(p.weekday ?? ""),
    day: Number(p.day),
    month: Number(p.month) - 1,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

function partOf(hour: number): DayPart {
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "afternoon";
  if (hour >= 16 && hour < 20) return "evening";
  return "night";
}

// Hindi names the part of the day before the hour ("सुबह 7:30") where English puts am/pm after it.
const HINDI_PART: Record<DayPart, string> = { morning: "सुबह", afternoon: "दोपहर", evening: "शाम", night: "रात" };
const hindiDayPart = (hour: number) => HINDI_PART[partOf(hour)];

function clockOf(m: Moment, lang: Lang): string {
  const h12 = m.hour % 12 === 0 ? 12 : m.hour % 12;
  const hm = `${h12}:${String(m.minute).padStart(2, "0")}`;
  return lang === "hi" ? `${hindiDayPart(m.hour)} ${hm}` : `${hm} ${m.hour < 12 ? "am" : "pm"}`;
}

const dateOf = (m: Moment, lang: Lang) => `${m.day} ${MONTHS[lang][m.month]}`;

/** "7:41 am" · "सुबह 7:41" */
export function clock(iso: string, lang: Lang): string {
  return clockOf(inZone(iso), lang);
}

/** "Tue 27 Oct · 7:30 am" · "मंगल 27 अक्टूबर · सुबह 7:30" */
export function dayAndTime(iso: string, lang: Lang): string {
  const m = inZone(iso);
  return `${WEEKDAYS[lang][m.weekday]} ${dateOf(m, lang)} · ${clockOf(m, lang)}`;
}

/** "27 Oct, 7:02 am" · "27 अक्टूबर, सुबह 7:02" */
export function dateAndTime(iso: string, lang: Lang): string {
  const m = inZone(iso);
  return `${dateOf(m, lang)}, ${clockOf(m, lang)}`;
}

/** A calendar date ("2026-10-20") has no zone: "20 Oct" · "20 अक्टूबर". */
export function calendarDate(ymd: string, lang: Lang): string {
  const [, month, day] = ymd.split("-").map(Number);
  return `${day} ${MONTHS[lang][(month ?? 1) - 1]}`;
}

// The month pages' tabs and headings have always been worded by Intl, not by the table above; they keep that.
const MONTH_YEAR = {
  en: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
  hi: new Intl.DateTimeFormat("hi-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
};

/** A calendar month ("2026-10") has no zone either: "October 2026" · "अक्टूबर 2026". */
export function monthYear(ym: string, lang: Lang): string {
  return MONTH_YEAR[lang].format(new Date(`${ym}-01T00:00:00Z`));
}

/** The part of the shop's day an instant falls in (the greeting's), on the same hours as the Hindi clock's words. */
export function dayPart(iso: string): DayPart {
  return partOf(inZone(iso).hour);
}
