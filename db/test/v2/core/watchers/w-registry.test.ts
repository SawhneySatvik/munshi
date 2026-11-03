// W-REG: the watcher registry is §7.3's seventeen, each keyed by the capability its row of the table names, owned by a
// desk of the registry (packages/agent/src/desks.ts) that has that capability among its parts, with a registered
// watch.* read whose key is non-empty and whose impact column is a money column. The expected table is BLUEPRINT
// §7.3's, written out here, not read back from watchers.ts. And every capability is some desk's part or opens none.
import { WATCHERS } from '@munshi/core';
import { expect, it } from 'vitest';
import { DESK_REGISTRY, NO_DESK } from '../../../../../packages/agent/src/desks.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { openTestDb } from '../../db.ts';

const SPEC: Record<string, string> = {
  shrinkage: 'stock',
  price_creep: 'buying',
  expiry: 'stock',
  overdue_credit: 'credit',
  short_settlement: 'counter',
  missing_settlement: 'counter', // P-4, beside §7.3's seventeen
  dead_stock: 'stock',
  unrecovered_advance: 'staff',
  hold_expiring: 'holds',
  regulars_lapsing: 'campaigns',
  package_expiry: 'packages',
  idle_stylist: 'bookings',
  stylist_absent_booked: 'bookings',
  unbilled_booking: 'bookings',
  hold_pressure: 'bookings',
  order_unanswered: 'orders',
  order_late: 'orders',
  advance_unapplied: 'orders',
  paypal_unrecorded: 'credit', // D-079: PayPal, beside §7.3's seventeen
};

it('W-REG the seventeen watchers of §7.3, each keyed by its capability, on a desk that owns it, over a registered read with a money impact', () => {
  expect(WATCHERS).toHaveLength(19);
  expect(Object.fromEntries(WATCHERS.map((w) => [w.kind, w.needs]))).toEqual(SPEC);
  for (const w of WATCHERS) {
    const desk = DESK_REGISTRY[w.desk as keyof typeof DESK_REGISTRY];
    expect(desk, w.kind).toBeDefined();
    expect(desk.parts.map(([, cap]) => cap as string), w.kind).toContain(w.needs);
    const q = QUERIES.get(w.query);
    expect(q, w.query).toBeDefined();
    expect(q?.key.length, w.query).toBeGreaterThan(0);
    if (w.impact) expect(q?.columns[w.impact]?.kind, w.kind).toBe('money');
  }
  expect(WATCHERS.filter((w) => !w.impact).map((w) => w.kind)).toEqual(['price_creep']);
});

it('W-REG every capability of ref.capability is some desk’s part, or one of the four that open none; the registry names no other', async () => {
  const db = await openTestDb();
  try {
    const { rows } = await db.admin.query<{ code: string }>('select code from ref.capability order by code');
    expect(rows).toHaveLength(21); // BLUEPRINT §2.5
    const parts = new Set(Object.values(DESK_REGISTRY).flatMap((d) => d.parts.map(([, cap]) => cap as string)));
    const codes = rows.map((r) => r.code);
    expect(codes.filter((code) => parts.has(code) === (NO_DESK as readonly string[]).includes(code))).toEqual([]);
    expect([...parts, ...NO_DESK].filter((cap) => !codes.includes(cap))).toEqual([]);
  } finally {
    await db.close();
  }
});
