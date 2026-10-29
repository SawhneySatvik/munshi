// Jobs for orders: a request nobody handled expires 7 days after it arrived (BLUEPRINT §2.10.16). order_request_flow
// lets the jobs role move only a new or drafted request past its expires_at to expired; the WHERE restates that rule.
// Built with registerJob from jobs-core.ts (never jobs.ts, so there is no import cycle).
import type pg from 'pg';
import { type Job, registerJob } from './jobs-core.ts';

const count = (r: pg.QueryResult) => r.rowCount ?? 0;

export const ORDER_JOBS: Job[] = [
  registerJob('order_requests', {
    every: 'hour',
    perTenant: true,
    run: async (c) => ({
      requests: count(await c.query(`update ops.order_request set state = 'expired' where state in ('new', 'drafted') and expires_at <= now()`)),
    }),
  }),
];
