// Guarantee clause 2 in the contract (BLUEPRINT §5.5): every number in a response is a figure's, and a figure carries the
// cell it came from. Red-proofs: db/test/v2/sabotage/core-contracts.ts.
import { expect, it } from 'vitest';
import { bareNumbers, numberSites } from '../src/figures.ts';
import { buildOpenApi } from '../src/openapi.ts';
import { DerivedMoney, IntFigure, MoneyFigure, RefAnswer } from '../src/index.ts';

const REF = '⟨snap:019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b·12·price⟩';

it('FIG1 no response of any route carries a number outside a figure', () => {
  expect(bareNumbers(buildOpenApi())).toEqual([]);
});

// Written from §5.1's table, not read from the schemas: which figures each route's responses hold.
it('FIG2 each route reaches exactly the figures its resource holds, and nothing else', () => {
  const money = 'MoneyFigure.minor';
  const int = 'IntFigure.value';
  expect(numberSites(buildOpenApi())).toEqual({
    site: [],
    catalogue: [money],
    services: [int, money],
    packages: [int, money],
    offers: [int, money],
    stylists: [],
    slots: [],
    mediaJpg: [],
    mediaSvg: [],
    ref: [int, money],
    hold: [],
    releaseHold: [],
    book: [],
    requestBooking: [],
    enquire: [],
    reserve: [],
    order: ['DerivedMoney.minor', money, 'RequestedQty.qtyMilli'],
    orderStatus: [],
    findings: [money],
    drafts: [],
    proposeDraft: [],
  });
});

it('FIG3 the walker finds a planted bare number, a number constant and an untyped node', () => {
  const doc = buildOpenApi();
  const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
  schemas.Slots = { type: 'object', properties: { count: { type: 'integer' }, odd: { type: 'string', enum: ['one', 2] }, any: {} }, additionalProperties: false };
  expect(bareNumbers(doc)).toEqual(['slots: Slots.any (untyped)', 'slots: Slots.count', 'slots: Slots.odd']);
});

it('FIG4 a figure is refused without its ref, and a derived figure without the refs it came from', () => {
  expect(MoneyFigure.safeParse({ minor: 249_900, currency: 'INR', ref: REF }).success).toBe(true);
  for (const bad of [{ minor: 249_900, currency: 'INR' }, { minor: 249_900, currency: 'INR', ref: null }, { minor: 249_900, currency: 'INR', ref: 'snap:1·2·price' }]) {
    expect(MoneyFigure.safeParse(bad).success).toBe(false);
  }
  expect(MoneyFigure.safeParse({ minor: 2499.5, currency: 'INR', ref: REF }).success).toBe(false);
  expect(IntFigure.safeParse({ value: 45 }).success).toBe(false);
  expect(DerivedMoney.safeParse({ minor: 499_800, currency: 'INR', from: [REF] }).success).toBe(true);
  expect(DerivedMoney.safeParse({ minor: 499_800, currency: 'INR', from: [] }).success).toBe(false);
});

it('CV1 a ref that cannot be traced answers exactly "Cannot verify", and a verified one carries its cell and source', () => {
  expect(RefAnswer.safeParse({ verified: false, label: 'Cannot verify' }).success).toBe(true);
  expect(RefAnswer.safeParse({ verified: false, label: 'Unknown' }).success).toBe(false);
  expect(RefAnswer.safeParse({ verified: false, label: 'Cannot verify', cell: { value: 1, ref: REF } }).success).toBe(false);
  const source = { table: 'books.price', id: '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b' };
  const verified = { verified: true, cell: { minor: 80_000, currency: 'INR', ref: REF }, source, publishedAt: '2026-10-29T10:00:00Z' };
  expect(RefAnswer.safeParse(verified).success).toBe(true);
  expect(RefAnswer.safeParse({ ...verified, cell: { minor: 80_000, currency: 'INR' } }).success).toBe(false);
  expect(RefAnswer.safeParse({ ...verified, cell: 80_000 }).success).toBe(false);
});
