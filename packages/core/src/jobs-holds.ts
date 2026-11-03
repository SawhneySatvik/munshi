// Jobs for holds: `holds` expires every lapsed hold, as munshi_jobs with no actor, once a minute per tenant: a piece
// held past held_until (ops.reservation), and a slot held past expires_at (ops.booking), whose overlap exclusion would
// otherwise keep the slot taken. Each WHERE restates its flow trigger's own rule, so a loosened trigger never widens
// the job. Built with registerJob from jobs-core.ts (never jobs.ts, so there is no import cycle).
import type pg from 'pg';
import { type Job, registerJob } from './jobs-core.ts';

const count = (r: pg.QueryResult) => r.rowCount ?? 0;

export const HOLD_JOBS: Job[] = [
  registerJob('holds', {
    every: 'minute',
    perTenant: true,
    run: async (c) => ({
      reservations: count(await c.query(`update ops.reservation set state = 'expired' where state = 'held' and held_until <= now()`)),
      slot_holds: count(await c.query(`update ops.booking set state = 'expired' where state = 'held' and expires_at <= now()`)),
    }),
  }),
];
