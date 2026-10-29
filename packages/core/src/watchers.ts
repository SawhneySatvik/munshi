// Watchers: deterministic SQL detectors (the watch.* named reads), one per planted kind. A run mints each detector's
// snapshot and keeps one ai.finding per returned row, pointing at that row (⟨snap:ID·row·col⟩ are its numbers). The
// dedupe key is the kind plus the read's key columns, so re-running over the same situation raises nothing new.
// A watcher runs as the jobs role with no actor (a system scope on the jobs pool; the database admits a watch snapshot
// and a finding's raise from nothing else): it never acts as a person, and it writes no book row.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import type { Cell } from './read.ts';
import { withTx } from './session.ts';
import { mintIn } from './snapshots.ts';
import { businessDate } from './time.ts';

// desk: the agent's desk that explains it; impact: the money column holding the rupees at stake (none for a price creep).
export const WATCHERS = [
  { kind: 'shrinkage', query: 'watch.shrinkage', desk: 'stock', impact: 'loss' },
  { kind: 'price_creep', query: 'watch.price_creep', desk: 'stock', impact: null },
  { kind: 'expiry', query: 'watch.expiry', desk: 'stock', impact: 'at_risk_value' },
  { kind: 'overdue_credit', query: 'watch.overdue_credit', desk: 'credit', impact: 'overdue' },
  { kind: 'short_settlement', query: 'watch.short_settlement', desk: 'sales', impact: 'short' },
] as const;

export type Raised = { findingId: string; kind: string; dedupeKey: string; snapshotId: string; row: number };

const keyText = (cell: Cell | undefined) => (cell && cell.kind === 'text' ? cell.txt : cell && cell.kind === 'date' ? cell.day : '');

// The severity ladder on the impact cell, in paise: the IN defaults for a small shop (BLUEPRINT §7.4, INFERENCE).
export function severity(impact: Cell | undefined): 'low' | 'medium' | 'high' | 'critical' {
  const n = impact?.kind === 'money' ? Number(impact.num) : 0;
  return n >= 1_000_000 ? 'critical' : n >= 200_000 ? 'high' : n >= 50_000 ? 'medium' : 'low';
}

export function runWatchers(pool: pg.Pool, tenantId: string, asOf?: string): Promise<{ runId: string; asOf: string; raised: Raised[]; rows: number }> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');
    if (!t[0]) throw new CoreError('not_found');
    const day = asOf ?? businessDate(new Date(), t[0].time_zone);
    const { rows: run } = await c.query<{ id: string }>(
      `insert into ai.run (tenant_id, trigger, desk) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, 'watcher', 'watch') returning id`,
    );
    const runId = (run[0] as { id: string }).id;
    const raised: Raised[] = [];
    let rows = 0;
    for (const w of WATCHERS) {
      const snap = await mintIn(c, w.query, { as_of: day }, runId);
      const key = (QUERIES.get(w.query) as { key: string[] }).key;
      for (const [i, row] of snap.rows.entries()) {
        rows++;
        const dedupeKey = `${w.kind}:${key.map((k) => keyText(row[k])).join(':')}`;
        // Seen again: the open (or snoozed) finding names this run, and moves to this snapshot only if its row's cells
        // changed; with the same cells the database keeps its snapshot and pin (row_sha256, ai.finding_flow).
        const seen = await c.query(`update ai.finding set snapshot_id = $2, snapshot_row = $3, last_run_id = $4 where dedupe_key = $1 and status in ('open', 'snoozed')`, [
          dedupeKey,
          snap.id,
          i,
          runId,
        ]);
        if (seen.rowCount) continue;
        // A key dismissed in the last 30 days rests (MS012 would refuse its raise, and with it the whole run).
        const { rows: made } = await c.query<{ id: string }>(
          `insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id)
           select nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, '\\x00', $7, $8, $8
            where not exists (select 1 from ai.finding f where f.dedupe_key = $3 and f.status = 'dismissed' and f.closed_at > now() - interval '30 days')
           returning id`,
          [w.desk, w.kind, dedupeKey, severity(w.impact ? row[w.impact] : undefined), snap.id, i, w.impact, runId],
        );
        if (made[0]) raised.push({ findingId: made[0].id, kind: w.kind, dedupeKey, snapshotId: snap.id, row: i });
      }
    }
    await c.query(`update ai.run set ended_at = now(), outcome = 'raised' where id = $1`, [runId]);
    return { runId, asOf: day, raised, rows };
  });
}

export type FindingState = { kind: string; status: string; snapshotId: string; row: number; current: boolean; openDraft: boolean };

/**
 * What the agent checks before it explains a finding or drafts its fix: its kind and status; the row that holds its
 * numbers (its own: a finding moves to a newer snapshot whenever its row's cells change, so its own row is the latest
 * the watchers saw); whether the latest watcher run still sees it (`current`: that run named it, last_run_id; every
 * watcher run reads every kind); and whether a draft for it already awaits a decision. null: no such finding for this
 * tenant. A read, on any pool that can read findings (the app's, in a system scope).
 */
export function findingState(pool: pg.Pool, tenantId: string, findingId: string): Promise<FindingState | null> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ kind: string; status: string; snapshot_id: string; snapshot_row: number; current: boolean; open_draft: boolean }>(
      `select f.kind, f.status, f.snapshot_id::text as snapshot_id, f.snapshot_row,
              f.last_run_id is not distinct from (select r.id from ai.run r where r.trigger = 'watcher' and r.ended_at is not null
                                                   order by r.started_at desc, r.id desc limit 1) as current,
              exists (select 1 from approval.draft d where d.tenant_id = f.tenant_id and d.finding_id = f.id and d.status = 'proposed') as open_draft
         from ai.finding f where f.id = $1`,
      [findingId],
    );
    const f = rows[0];
    return f ? { kind: f.kind, status: f.status, snapshotId: f.snapshot_id, row: f.snapshot_row, current: f.current, openDraft: f.open_draft } : null;
  });
}
