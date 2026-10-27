// The one time-zone module. Instants are Date (timestamptz in the database); a business date is the calendar date in
// the shop's IANA zone, carried as 'YYYY-MM-DD'. The tenant row holds the zone; Asia/Kolkata is the default. SQL that
// needs a business date reads the same zone from ops.tenant (`at time zone t.time_zone`).

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

const DAY_MS = 86_400_000;

function parts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

function parseDay(day: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError('not a YYYY-MM-DD date');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) !== day) throw new RangeError('not a calendar date');
  return { y, m: mo, d };
}

export function businessDate(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const p = parts(at, timeZone);
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
}

// The instant of local wall-clock time `minutes` after midnight on `day` in the zone. Resolved by correcting the zone's
// offset twice, which lands on the right side of a DST change; a wall time skipped by a spring-forward resolves forward.
export function localTime(day: string, minutes: number, timeZone = DEFAULT_TIME_ZONE): Date {
  const { y, m, d } = parseDay(day);
  const wall = Date.UTC(y, m - 1, d) + minutes * 60_000;
  let at = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(at), timeZone);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
    at += wall - shown;
  }
  return new Date(at);
}

// The instant a business day starts (local midnight).
export function dayStart(day: string, timeZone = DEFAULT_TIME_ZONE): Date {
  return localTime(day, 0, timeZone);
}
