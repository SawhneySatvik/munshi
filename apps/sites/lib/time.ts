// The one time module. Days are ISO dates (YYYY-MM-DD) in the shop's zone; arithmetic runs on UTC midnights, so no
// local clock or daylight saving can shift a day.
const ZONE = "Asia/Kolkata";

export function todayIn(zone = ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Thu 29 Oct" / "गुरु, 29 अक्तू॰" */
export function dayLabel(iso: string, lang: "en" | "hi"): string {
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
