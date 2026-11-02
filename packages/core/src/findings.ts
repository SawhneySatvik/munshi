// A person's moves on a finding (BLUEPRINT §7.4): snooze it for 1, 3 or 7 days, or dismiss it with a dismiss code, an
// owner's or a manager's call. Both are ops, not books: the member's own request, as munshi_app, which ai.finding_flow
// admits only from an active member (stamping who dismissed and when) and records in ai.finding_event. Nobody resolves a finding by hand: a watcher run of
// its kind does, when it no longer sees it (watchers.ts). A dismissed key rests 30 days before it may be raised again.
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { type Session, withTx } from './session.ts';

export const DISMISS_REASONS = ['not_relevant', 'already_handled', 'other'] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

const findingId = z.guid();

// Quieting a finding is an owner's or a manager's call: staff are refused here (the database's finding_flow admits any
// active member until the migrator adds the same role check there).
async function move(pool: pg.Pool, session: Session, ids: string[], sql: string, values: unknown[]): Promise<void> {
  if (ids.length === 0 || !ids.every((id) => findingId.safeParse(id).success)) throw new CoreError('invalid', { fields: ['findingId'] });
  await withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ role: string }>('select role from ops.member where id = $1 and active', [session.memberId]);
    if (rows[0]?.role !== 'owner' && rows[0]?.role !== 'manager') throw new CoreError('refused');
    // One transaction for the batch: every finding moves, or none does.
    for (const id of ids) {
      const { rowCount } = await c.query(sql, [id, ...values]);
      if (rowCount !== 1) throw new CoreError('not_found');
    }
  });
}

/** The open findings of one kind, oldest first: what a card that stands for all of them (the overdue card) acts on. */
export async function openFindingIds(pool: pg.Pool, session: Session, kind: string): Promise<string[]> {
  const { rows } = await withTx(pool, { kind: 'member', session }, (c) =>
    c.query<{ id: string }>(`select id::text from ai.finding where kind = $1 and status = 'open' order by created_at, snapshot_row`, [kind]),
  );
  return rows.map((r) => r.id);
}

/** Snoozes a finding, or several in one transaction (the overdue card's), for 1, 3 or 7 days. */
export async function snoozeFinding(pool: pg.Pool, session: Session, id: string | string[], days: 1 | 3 | 7): Promise<void> {
  if (![1, 3, 7].includes(days)) throw new CoreError('invalid', { fields: ['days'] });
  return move(pool, session, [id].flat(), `update ai.finding set status = 'snoozed', snoozed_until = now() + make_interval(days => $2) where id = $1`, [days]);
}

/** Dismisses a finding, or several in one transaction, with a dismiss code. */
export async function dismissFinding(pool: pg.Pool, session: Session, id: string | string[], reason: DismissReason): Promise<void> {
  if (!DISMISS_REASONS.includes(reason)) throw new CoreError('invalid', { fields: ['reason'] });
  return move(pool, session, [id].flat(), `update ai.finding set status = 'dismissed', close_reason = $2 where id = $1`, [reason]);
}
