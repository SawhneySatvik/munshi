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
const SETTLE = "the settlements sheet's buttons wrap in a row of their own, never a ledger row's two columns";
const STAMP = "approving a PayPal link draft on the credit book leaves the approved stamp Home's tray shows";
const REMIND ='the owner approves the overdue reminder for Mohan L.; counter staff cannot; a customer with no phone is refused for that, not for the role';
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
  // The demo seed gives Mohan L. no number and no consent again: the owner's approval of his reminder is refused.
  {
    sabotage: 'web-remind-mohan-unreachable',
    file: 'test/decide.test.tsx',
    test: REMIND,
    ...WEB,
    ts: { file: 'db/seed/kirana.ts', from: "const REACHABLE = new Map([['Mohan L.', '+919800000103']]);", to: 'const REACHABLE = new Map<string, string>();' },
  },
  // harness-level: the settlements sheet's buttons back in a ledger row's two columns, as the test reads the source
  { sabotage: 'web-settle-actions-as-row', file: LAYOUT, test: SETTLE, ...WEB },
  // The credit book's decision shows its status line only again, no stamp.
  {
    sabotage: 'web-paypal-decided-no-stamp',
    file: 'test/paypal-credit.test.tsx',
    test: STAMP,
    ...WEB,
    ts: {
      file: 'apps/web/components/PayPalLink.tsx',
      from: '<Stamp tone={state.decided === "executed" ? "approved" : "rejected"}>{t[state.decided === "executed" ? "approved" : state.decided]}</Stamp>',
      to: '',
    },
  },
  // A reminder refused for the customer's consent reads as the approver's role again.
  {
    sabotage: 'web-remind-consent-as-role',
    file: 'test/decide.test.tsx',
    test: REMIND,
    ...WEB,
    ts: { file: 'apps/web/app/actions.ts', from: 'err.fields?.includes("consent")', to: 'err.fields?.includes("consent_")' },
  },
];
