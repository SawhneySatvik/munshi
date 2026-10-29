// Jobs for holds. Empty until its lane fills it; jobs.ts spreads it into JOBS. Built with registerJob from jobs-core.ts
// (never jobs.ts, so there is no import cycle).
import type { Job } from './jobs-core.ts';

export const HOLD_JOBS: Job[] = [];
