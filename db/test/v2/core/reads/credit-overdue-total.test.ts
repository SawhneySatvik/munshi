// credit.overdue_total (the owner home's overdue-credit card): over the kirana seed it states the answer key's overdue
// customers, the sum of what they owe past due, and their credit term — the same customers watch.overdue_credit flags
// (the ₹40 near miss stays out). Expected values come from kirana.answers.json and the seed's 30-day term, not from a
// database read.
import { readFileSync } from 'node:fs';
import { mintSnapshot } from '@munshi/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Kirana, seedKirana } from '../../../../seed/kirana.ts';
import { openTestDb, type TestDb } from '../../db.ts';

type Answer = { kind: string; expect: Record<string, number> };
const OVERDUE = (JSON.parse(readFileSync(new URL('../../../../seed/kirana.answers.json', import.meta.url), 'utf8')) as { plants: Answer[] }).plants.filter(
  (a) => a.kind === 'overdue_credit',
);
const AS_OF = '2026-10-27';
const CREDIT_TERM_DAYS = 30; // the seed gives every udhaar due 30 days later (commands.ts, CREDIT_DAYS)

let db: TestDb;
let k: Kirana;
beforeAll(async () => {
  db = await openTestDb();
  k = await seedKirana(db.as('munshi_app'), { asOf: AS_OF });
}, 120_000);
afterAll(() => db.close());

// The owner's home card reads it as a display read: the owner's own scope (the app mints only as a member).
const owner = () => ({ kind: 'member', session: k.owner }) as const;

it('credit.overdue_total counts the overdue customers, sums what they owe past due, and states their credit term', async () => {
  const total = await mintSnapshot(db.as('munshi_app'), owner(), 'credit.overdue_total', { as_of: AS_OF });
  const owed = OVERDUE.reduce((sum, a) => sum + (a.expect.overdue as number), 0);
  console.log(`credit.overdue_total: ${JSON.stringify(total.rows)}; answer key: ${OVERDUE.length} customers, ${owed} paise`);
  expect(OVERDUE.length).toBe(3);
  expect(total.rows).toEqual([
    {
      customers: { kind: 'integer', num: String(OVERDUE.length) },
      overdue: { kind: 'money', num: String(owed), currency: 'INR' },
      credit_days: { kind: 'integer', num: String(CREDIT_TERM_DAYS) },
    },
  ]);

  // The same customers the watcher flags, so the card's count and total agree with the findings beside it.
  const flagged = await mintSnapshot(db.as('munshi_app'), owner(), 'watch.overdue_credit', { as_of: AS_OF });
  expect(flagged.rows.length).toBe(OVERDUE.length);
  const sum = flagged.rows.reduce((s, r) => s + Number((r.overdue as { num: string }).num), 0);
  expect(sum).toBe(owed);
});

it('credit.overdue_total still returns its one row when nothing is overdue', async () => {
  // Ninety days before the seed's as_of, no udhaar has fallen due yet.
  const early = await mintSnapshot(db.as('munshi_app'), owner(), 'credit.overdue_total', { as_of: '2026-07-29' });
  expect(early.rows).toEqual([{ customers: { kind: 'integer', num: '0' }, overdue: { kind: 'money', num: '0', currency: 'INR' }, credit_days: { kind: 'null' } }]);
});
