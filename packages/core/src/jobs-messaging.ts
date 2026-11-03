// Jobs for messaging; jobs.ts spreads them into JOBS. Built with registerJob from jobs-core.ts (never jobs.ts, so there
// is no import cycle). The outbox runs at every trigger, per shop: it sends what the books queued, each
// delivery at most once (outbox.ts).
import { type Job, registerJob } from './jobs-core.ts';
import { sweepOutbox } from './outbox.ts';

export const MESSAGING_JOBS: Job[] = [registerJob('outbox', { every: 'minute', perTenant: true, run: sweepOutbox })];
