// A person's moves on a finding (BLUEPRINT §7.4): snooze it for 1, 3 or 7 days, or dismiss it with a dismiss code. Both
// are ops, not books: the member's own request, as munshi_app, which ai.finding_flow admits only from an active member
// (stamping who dismissed and when) and records in ai.finding_event. Nobody resolves a finding by hand: a watcher run of
// its kind does, when it no longer sees it (watchers.ts). A dismissed key rests 30 days before it may be raised again.
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Session, withTx } from './session.ts';

export const DISMISS_REASONS = ['not_relevant', 'already_handled', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

const findingId = z.guid();

async function move(pool: pg.Pool, session: Session, id: string, sql: string, values: unknown[]): Promise<void> {
  if (!findingId.safeParse(id).success) throw new CoreError('invalid', { fields: ['findingId'] });
  const { rowCount } = await withTx(pool, { kind: 'member', session }, (c) => c.query(sql, [id, ...values]));
  if (rowCount !== 1) throw new CoreError('not_found');
}

export async function snoozeFinding(pool: pg.Pool, session: Session, id: string, days: 1 | 3 | 7): Promise<void> {
  if (![1, 3, 7].includes(days)) throw new CoreError('invalid', { fields: ['days'] });
  return move(pool, session, id, `update ai.finding set status = 'snoozed', snoozed_until = now() + make_interval(days => $2) where id = $1`, [days]);
}

export async function dismissFinding(pool: pg.Pool, session: Session, id: string, reason: DismissReason): Promise<void> {
  if (!DISMISS_REASONS.includes(reason)) throw new CoreError('invalid', { fields: ['reason'] });
  return move(pool, session, id, `update ai.finding set status = 'dismissed', close_reason = $2 where id = $1`, [reason]);
}
