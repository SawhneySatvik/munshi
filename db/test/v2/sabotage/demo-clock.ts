// Red-proofs of a recorded demo on any day: the back office holds a sample shop's business day where its seed left it
// (test/v2/core/brief/schedule.test.ts), the tick sets the hold while answers are replayed, so Ask replays the recorded
// answer and the screens name the day (apps/web/test/demo-clock), and a signed-in page names its shop's data class and
// slug on <html>, which the capture guard reads with the visitor's session cookie (test/v2/deploy/capture-guard). Each
// breaks one and names the test that must then fail.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const V2 = { config: 'vitest.v2.config.ts' } as const;
const SCHEDULE = 'test/v2/core/brief/schedule.test.ts';
const HOLD =
  'held, a sample shop stays on the day it was seeded as of, its brief written for that day; a real shop, a sandbox and a showcase shop follow the clock';
const SCHEDULED = 'packages/core/src/brief-schedule.ts';
const CLOCK = 'test/demo-clock.test.tsx';
const ASK = 'on a later day the tick keeps the demo shop on its seeded day: Ask replays the recorded answer, cited as of that day';
const LABEL = "Reports read the seeded days, and Home, Reports and Ask name the demo's business day in both languages";
const MARK = "signed in, <html> names the shop's data class and a sample shop's slug; signed out, neither";
const SIGNED_IN = "--mode app reads a signed-in page with the visitor's session cookie, follows no redirect with it, and never prints it";
const GUARD = { file: 'test/v2/deploy/capture-guard.test.ts', test: SIGNED_IN, ...V2 };
const HELD = 'const held = opts.holdSampleDay ? await seededDay(pool, tenantId) : null;';

export const DEMO_CLOCK_CASES: Case[] = [
  // The hold does nothing: a sample shop's watchers and brief follow the clock.
  { sabotage: 'v2-demo-day-unheld', file: SCHEDULE, test: HOLD, ...V2, ts: { file: SCHEDULED, from: HELD, to: 'const held: string | null = null;' } },
  // Every shop is held: a real shop and a sandbox too.
  {
    sabotage: 'v2-demo-day-real-held',
    file: SCHEDULE,
    test: HOLD,
    ...V2,
    ts: { file: SCHEDULED, from: " and t.data_class = 'synthetic' and not t.sandbox)", to: ')' },
  },
  // Every sample shop is held: a showcase shop too, on its seed's tomorrow.
  {
    sabotage: 'v2-demo-day-showcase-held',
    file: SCHEDULE,
    test: HOLD,
    ...V2,
    ts: { file: SCHEDULED, from: "t.data_class = 'synthetic' and not", to: "t.data_class <> 'live' and not" },
  },
  // A visitor's sandbox is held on the day its first watchers ran.
  { sabotage: 'v2-demo-day-sandbox-held', file: SCHEDULE, test: HOLD, ...V2, ts: { file: SCHEDULED, from: " and not t.sandbox)", to: ')' } },
  // The held day is the latest one watchers ran as of: a day a clock-bound run moved on to stays.
  {
    sabotage: 'v2-demo-day-latest',
    file: SCHEDULE,
    test: HOLD,
    ...V2,
    ts: { file: SCHEDULED, from: "select min((s.params->>'as_of')::date)::text", to: "select max((s.params->>'as_of')::date)::text" },
  },
  // The tick never asks for the hold: the next tick moves the demo to the clock's day and Ask finds no recording.
  {
    sabotage: 'web-demo-tick-unheld',
    file: CLOCK,
    test: ASK,
    ...WEB,
    ts: { file: 'apps/web/app/api/internal/tick/route.ts', from: 'holdSampleDay: recordedMode()', to: 'holdSampleDay: false' },
  },
  // No page names the demo's day.
  { sabotage: 'web-demo-day-unlabelled', file: CLOCK, test: LABEL, ...WEB, ts: { file: 'apps/web/components/DemoDay.tsx', from: '  if (!day) return null;', to: '  return null;' } },
  // The Ask page drops the day it asks as of.
  {
    sabotage: 'web-ask-day-dropped',
    file: CLOCK,
    test: LABEL,
    ...WEB,
    ts: { file: 'apps/web/app/app/ask/page.tsx', from: 'const day = recorded ? floor.askDate : null;', to: 'const day = null;' },
  },
  // Home's kicker names the morning again, whatever the hour.
  {
    sabotage: 'web-brief-kicker-morning',
    file: CLOCK,
    test: LABEL,
    ...WEB,
    ts: { file: 'apps/web/lib/i18n.ts', from: '  briefKicker: "Brief · {when}",', to: '  briefKicker: "Morning brief · {when}",' },
  },
  // The guard fetches app pages signed out again: no page of the app can pass.
  { sabotage: 'v2-capture-app-cookie-dropped', ...GUARD, ts: { file: 'scripts/capture-guard.ts', from: 'const got = await page(url, fetchFn, cookie);', to: 'const got = await page(url, fetchFn);' } },
  // The guard follows a redirect with the session cookie.
  {
    sabotage: 'v2-capture-app-cookie-follows',
    ...GUARD,
    ts: { file: 'scripts/capture-guard.ts', from: "cookie ? { redirect: 'manual', headers: { cookie } }", to: "cookie ? { redirect: 'follow', headers: { cookie } }" },
  },
  // The CLI never reads MUNSHI_CAPTURE_COOKIE.
  {
    sabotage: 'v2-capture-cli-cookie-unread',
    ...GUARD,
    ts: { file: 'scripts/capture-guard.ts', from: 'env.MUNSHI_CAPTURE_COOKIE || undefined', to: 'undefined' },
  },
  // <html> carries the language only.
  { sabotage: 'web-html-unmarked', file: CLOCK, test: MARK, ...WEB, ts: { file: 'apps/web/app/layout.tsx', from: '<html lang={lang} {...mark}>', to: '<html lang={lang}>' } },
];
