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

export type FindingState = { status: string; seen: { snapshotId: string; row: number } | null; openDraft: boolean };

/**
 * What the agent checks before it explains a finding or drafts its fix: its status; where the latest watcher run of its
 * kind still sees it (`seen`) — the newest snapshot of the kind's watch read is the finding's own, or holds a row with
 * the same key cells (a situation that persists keeps its first finding, so its own snapshot is older, and the agent
 * works from the latest row); null when that run no longer sees it; and whether a draft for it already awaits a
 * decision. null: no such finding for this tenant.
 */
export function findingState(pool: pg.Pool, tenantId: string, findingId: string): Promise<FindingState | null> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ kind: string; status: string; snapshot_id: string; snapshot_row: number }>(
      'select kind, status, snapshot_id::text as snapshot_id, snapshot_row from ops.finding where id = $1',
      [findingId],
    );
    const f = rows[0];
    if (!f) return null;
    const query = WATCHERS.find((w) => w.kind === f.kind)?.query;
    const key = query ? (QUERIES.get(query) as { key: string[] }).key : [];
    const { rows: state } = await c.query<{ snapshot_id: string | null; row_no: number | null; open_draft: boolean }>(
      `with latest as (select id from snap.snapshot where query_name = $1 order by created_at desc limit 1),
            mine as (select col, kind, txt, day from snap.snapshot_cell where snapshot_id = $2 and row_no = $3 and col = any($4::text[])),
            seen as (
              select l.id, $3::integer as row_no from latest l where l.id = $2
              union all
              select sc.snapshot_id, sc.row_no from snap.snapshot_cell sc join latest l on l.id = sc.snapshot_id and l.id <> $2
               group by sc.snapshot_id, sc.row_no
              having count(*) filter (where exists (select 1 from mine m where m.col = sc.col and m.kind = sc.kind
                                        and m.txt is not distinct from sc.txt and m.day is not distinct from sc.day))
                     = cardinality($4::text[])
            )
       select (select id::text from seen order by row_no limit 1) as snapshot_id,
              (select row_no from seen order by row_no limit 1) as row_no,
              exists (select 1 from approval.draft d where d.finding_id = $5 and d.status = 'proposed') as open_draft`,
      [query ?? '', f.snapshot_id, f.snapshot_row, key, findingId],
    );
    const s = state[0] as { snapshot_id: string | null; row_no: number | null; open_draft: boolean };
    const seen = s.snapshot_id === null ? null : { snapshotId: s.snapshot_id, row: s.row_no as number };
    return { status: f.status, seen, openDraft: s.open_draft };
  });
}
