// Red-proofs of the plan gate at volume (test/v2/perf/plans.test.ts), run under the perf config before a
// release: without sale_shop_day, a run of days' counter sales is read by a Seq Scan over books.sale; without
// order_state_late, the late orders by one over ops.order_state.
import type { Case } from './case.ts';

export const PERF_CASES: Case[] = [
  {
    sabotage: 'v2-perf-sale-shop-day',
    file: 'test/v2/perf/plans.test.ts',
    test: 'sales.week_total plans without a Seq Scan over a growing table, its estimate within 10× of its rows',
    config: 'vitest.perf.config.ts',
    sql: 'drop index books.sale_shop_day;',
  },
  {
    // Without order_state_late, the late orders are found by reading every order's projection.
    sabotage: 'v2-perf-order-state-late',
    file: 'test/v2/perf/plans.test.ts',
    test: 'watch.order_late plans without a Seq Scan over a growing table, its estimate within 10× of its rows',
    config: 'vitest.perf.config.ts',
    sql: 'drop index ops.order_state_late;',
  },
  {
    // An allowed Seq Scan the read no longer makes leaves its SEQ_ALLOWED entry stale (here the app role plans with seq
    // scans off in this clone, as if an index now won), and a stale entry fails.
    sabotage: 'v2-perf-stale-allowance',
    file: 'test/v2/perf/plans.test.ts',
    test: 'credit.overdue_total plans without a Seq Scan over a growing table, its estimate within 10× of its rows',
    config: 'vitest.perf.config.ts',
    sql: "do $s$ begin execute format('alter role munshi_app in database %I set enable_seqscan = off', current_database()); end $s$;",
  },
];
