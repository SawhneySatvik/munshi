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

// Instants (an offer's end, a slot, an order step) are read on the shop's clock.
const inShop = (lang: "en" | "hi", options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: ZONE, ...options });

/** An offer's last day: "31 October". */
export function untilDay(at: string, lang: "en" | "hi"): string {
  return inShop(lang, { day: "numeric", month: "long" }).format(new Date(at));
}

/** When a book row was published: "29 Oct 2026". */
export function publishedOn(at: string, lang: "en" | "hi"): string {
  return inShop(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(at));
}

/** A time as the shop's clock shows it: "4:30 pm". Slot and hold times are roster times, not book figures. */
export function clock(at: string, lang: "en" | "hi"): string {
  return inShop(lang, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

/** An order step's moment: "29 Oct, 4:30 pm". */
export function stepAt(at: string, lang: "en" | "hi"): string {
  return inShop(lang, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

/** "Thu 29 Oct" / "गुरु, 29 अक्तू॰" */
export function dayLabel(iso: string, lang: "en" | "hi"): string {
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
