// Red-proofs of the owner app's screen fixes: a decision card's actions wrap inside the card (apps/web/test/card-layout),
// the PayPal sticker stays short, the greeting follows the shop's clock (apps/web/test/lang-toggle), and the overdue card
// never states a negative credit term (test/v2/core/reads/credit-overdue-total). Each breaks one and names the test
// that must then fail.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const LAYOUT = 'test/card-layout.test.ts';
const WRAP = 'the note field takes a whole row of the decide form, and the decide form wraps its row (no width overflows)';
const STICKER = 'the PayPal sticker is short in both languages, and the recorded note beside it is plain text that wraps';
const GREETING = "the greeting follows the shop's clock in both languages, and names no part of the day with no clock";
const TERM = 'credit.overdue_total never states a negative credit term: an entry due before it was given counts, as zero days';

export const HOME_POLISH_CASES: Case[] = [
  // harness-level: the decide row's wrap turned off in DraftCard.css as the test reads it (vitest empties stylesheets)
  { sabotage: 'web-decide-nowrap-planted', file: LAYOUT, test: WRAP, ...WEB },
  // The recorded PayPal sticker carries the whole explanation again: one unbreakable line.
  {
    sabotage: 'web-paypal-sticker-long',
    file: LAYOUT,
    test: STICKER,
    ...WEB,
    ts: {
      file: 'apps/web/lib/i18n-paypal.ts',
      from: '  recordedLabel: "PayPal sandbox demo",',
      to: '  recordedLabel: "PayPal sandbox (recorded: sandbox keys not set, nothing is sent to PayPal)",',
    },
  },
  // Home greets "Good morning" whatever the hour.
  {
    sabotage: 'web-greeting-always-morning',
    file: 'test/lang-toggle.test.tsx',
    test: GREETING,
    ...WEB,
    ts: { file: 'apps/web/components/OwnerHome.tsx', from: 'greeting: now ? t[GREET[dayPart(now)]] : t.greetAny', to: 'greeting: t.greetMorning' },
  },
  // The term is the raw difference again: an entry due before it was given makes it negative.
  {
    sabotage: 'v2-credit-term-negative',
    file: 'test/v2/core/reads/credit-overdue-total.test.ts',
    test: TERM,
    config: 'vitest.v2.config.ts',
    ts: {
      file: 'packages/core/src/queries.ts',
      from: 'greatest(0, g.due_on - (g.at at time zone (select time_zone from tz))::date) as term',
      to: 'g.due_on - (g.at at time zone (select time_zone from tz))::date as term',
    },
  },
];
