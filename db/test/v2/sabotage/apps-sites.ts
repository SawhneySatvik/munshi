// Red-proofs of the hosted shop sites (apps/sites/test/*). Each breaks one protection; the named test must
// then fail. The two gates are harness-level (the gate plants the break, as a file it removes after); the page tests'
// cases are source mutations applied as vitest loads the module.
import type { Case } from './case.ts';

const SITES = { dir: 'apps/sites', config: 'vitest.config.ts' } as const;
const FIGURE = 'apps/sites/components/Figure.tsx';
const SOURCE = 'apps/sites/components/Source.tsx';
const SHELL = 'apps/sites/components/Shell.tsx';
const PIECE = 'apps/sites/components/Piece.tsx';
const SEND = 'apps/sites/lib/send.ts';

const BUNDLE1 = "a build for one business carries no other business's data or art, and is newer than every source";
const CLOSURE = 'apps/sites imports only the SDK, contracts types, React, Next and its own files; no core, db or pg';
const E1 = 'every Elite page renders from the API: each price and duration on it is a published cell with its ref, and nothing else carries digits';
const E2 = '"source" shows the book row a figure was published from, and "Cannot verify" for a ref no release has';
const E3 = 'a live slot is held and turned into a booking request: one held booking, then its contact, and no books row';
const E4 = 'a capability the release has off hides its section: packages off drops the nav entry, the home section and the page';
const P1 = 'every Prabhave page renders from the API: each price on it is a published cell with its ref';
const P2 = 'a piece hold is stored as one requested reservation; holds off removes the ask';
const P3 = 'an order is sent once under one Idempotency-Key even when the answer is lost; its ORD- code is the stored request and opens its status page';
const E5 = 'Elite presents as the live salon: no sample banner, note or "sample site" on any page in either language, and search engines may index it';
const P4 = 'Prabhave presents as the live shop: no sample banner, note, catalogue line or "sample site" on any page in either language, and search engines may index it';
const VARIANT = 'apps/sites/lib/variant.ts';
// The live predicate switched off: every sample label comes back.
const SAMPLE_BUILD = { file: VARIANT, from: 'process.env.NEXT_PUBLIC_MUNSHI_SITE_SAMPLE !== "1"', to: 'false && process.env.NEXT_PUBLIC_MUNSHI_SITE_SAMPLE !== "1"' };

export const APPS_SITES_CASES: Case[] = [
  { sabotage: 'v2-sites-bundle-leak', file: 'test/bundle.test.ts', test: BUNDLE1, ...SITES },
  { sabotage: 'v2-sites-closure-core', file: 'test/closure.test.ts', test: CLOSURE, ...SITES },
  // a price shown without its ref
  {
    sabotage: 'v2-sites-figure-ref-dropped',
    file: 'test/elite.test.tsx',
    test: E1,
    ...SITES,
    ts: { file: FIGURE, from: '{...("ref" in fig ? { "data-ref": fig.ref } : { "data-from": fig.from.join(" ") })}', to: '{...("ref" in fig ? {} : { "data-from": fig.from.join(" ") })}' },
  },
  // an unresolvable ref shown as verified
  {
    sabotage: 'v2-sites-source-trusts-everything',
    file: 'test/elite.test.tsx',
    test: E2,
    ...SITES,
    ts: { file: SOURCE, from: 'r.answer?.verified ? (', to: 'r.answer ? (' },
  },
  // the nav ignores the release's capabilities
  { sabotage: 'v2-sites-capability-ignored', file: 'test/elite.test.tsx', test: E4, ...SITES, ts: { file: SHELL, from: '(l) => !l.cap || has(site, l.cap)', to: '() => true' } },
  // the booking is sent without the hold's token
  { sabotage: 'v2-sites-booking-token-dropped', file: 'test/elite.test.tsx', test: E3, ...SITES, ts: { file: 'apps/sites/components/Booking.tsx', from: '      holdToken: held.holdToken,\n', to: '      holdToken: "x".repeat(43),\n' } },
  // the hold ask shown although the release has holds off
  { sabotage: 'v2-sites-holds-ignored', file: 'test/prabhave.test.tsx', test: P2, ...SITES, ts: { file: 'apps/sites/app/[lang]/catalogue/[id]/page.tsx', from: 'holds: has(site, "holds")', to: 'holds: true' } },
  // a fresh key on every try, so a retry after a lost answer is a second request
  { sabotage: 'v2-sites-order-key-fresh', file: 'test/prabhave.test.tsx', test: P3, ...SITES, ts: { file: SEND, from: 'if (current && current.body === text) return { key: current.key, next: current };', to: '' } },
  // an order price rendered from the request, not the cell
  { sabotage: 'v2-sites-order-price-invented', file: 'test/prabhave.test.tsx', test: P1, ...SITES, ts: { file: PIECE, from: '<Money fig={piece.price} lang={lang} what={piece.name} />', to: '<span className="fig">₹{piece.price.minor / 100}</span>' } },
  // the live predicate off: the salon shows its sample labels again
  { sabotage: 'v2-sites-elite-sample-labels', file: 'test/elite.test.tsx', test: E5, ...SITES, ts: SAMPLE_BUILD },
  // the live predicate off: the shop shows its sample labels again
  { sabotage: 'v2-sites-prabhave-sample-labels', file: 'test/prabhave.test.tsx', test: P4, ...SITES, ts: SAMPLE_BUILD },
  // the live site still asks search engines to stay out
  {
    sabotage: 'v2-sites-live-noindex',
    file: 'test/elite.test.tsx',
    test: E5,
    ...SITES,
    ts: { file: 'apps/sites/app/[lang]/layout.tsx', from: 'robots: live ? { index: true, follow: true } : { index: false, follow: false },', to: 'robots: { index: false, follow: false },' },
  },
];
