// Watchers: deterministic SQL detectors (the watch.* named reads), one per planted kind. A run mints each detector's
// snapshot and writes one ops.finding per returned row, pointing at that row (⟨snap:ID·row·col⟩ are its numbers). The
// dedupe key is the kind plus the read's key columns, so re-running over the same situation raises nothing new.
// A watcher runs with no actor (a system scope): it never acts as a person, and it writes no book row.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import type { Cell } from './read.ts';
import { withTx } from './session.ts';
import { mintIn } from './snapshots.ts';
import { businessDate } from './time.ts';

export const WATCHERS = [
  { kind: 'shrinkage', query: 'watch.shrinkage' },
  { kind: 'price_creep', query: 'watch.price_creep' },
  { kind: 'expiry', query: 'watch.expiry' },
  { kind: 'overdue_credit', query: 'watch.overdue_credit' },
  { kind: 'short_settlement', query: 'watch.short_settlement' },
] as const;

export type Raised = { findingId: string; kind: string; dedupeKey: string; snapshotId: string; row: number };

const keyText = (cell: Cell | undefined) => (cell && cell.kind === 'text' ? cell.txt : cell && cell.kind === 'date' ? cell.day : '');

export function runWatchers(pool: pg.Pool, tenantId: string, asOf?: string): Promise<{ runId: string; asOf: string; raised: Raised[]; rows: number }> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');
    if (!t[0]) throw new CoreError('not_found');
    const day = asOf ?? businessDate(new Date(), t[0].time_zone);
    const { rows: run } = await c.query<{ id: string }>(
      `insert into ops.run (tenant_id, trigger) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, 'watcher') returning id`,
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
        const { rows: made } = await c.query<{ id: string }>(
          `insert into ops.finding (tenant_id, kind, dedupe_key, snapshot_id, snapshot_row, run_id)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)
           on conflict (tenant_id, dedupe_key) do nothing returning id`,
          [w.kind, dedupeKey, snap.id, i, runId],
        );
        if (made[0]) raised.push({ findingId: made[0].id, kind: w.kind, dedupeKey, snapshotId: snap.id, row: i });
      }
    }
    await c.query('update ops.run set ended_at = now() where id = $1', [runId]);
    return { runId, asOf: day, raised, rows };
  });
}
