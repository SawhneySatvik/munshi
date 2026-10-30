// Watchers: deterministic SQL detectors (the watch.* named reads), one per kind (BLUEPRINT §7.3). A run mints each
// detector's snapshot and keeps one ai.finding per returned row, pointing at that row (⟨snap:ID·row·col⟩ are its
// numbers). The dedupe key is the kind plus the read's key columns, so re-running over the same situation raises nothing
// new. A watcher runs for a shop only while the capability it needs is on; a kind that ran and no longer returns a key
// resolves that key's finding (§7.4), and a kind that did not run leaves its findings as they were.
// A watcher runs as the jobs role with no actor (a system scope on the jobs pool; the database admits a watch snapshot
// and a finding's raise from nothing else): it never acts as a person, and it writes no book row.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import { QUERIES } from './queries.ts';
import type { Cell } from './read.ts';
import { withTx } from './session.ts';
import { mintIn } from './snapshots.ts';
import { businessDate } from './time.ts';

// index.ts exports this file; the AI back office's other core modules ride on it, so no lane edits the shared index.
export * from './allow.ts';
export * from './brief.ts';
export * from './findings.ts';

// needs: the capability that runs it; desk: the desk that owns it (§7.2, packages/agent/src/desks.ts); impact: the money
// column holding the rupees at stake (none for a price creep); instant: the read also takes the run's instant (`at`),
// for the watchers measured in minutes and hours.
export const WATCHERS = [
  { kind: 'shrinkage', query: 'watch.shrinkage', needs: 'stock', desk: 'stock', impact: 'loss' },
  { kind: 'price_creep', query: 'watch.price_creep', needs: 'buying', desk: 'stock', impact: null },
  { kind: 'expiry', query: 'watch.expiry', needs: 'stock', desk: 'stock', impact: 'at_risk_value' },
  { kind: 'overdue_credit', query: 'watch.overdue_credit', needs: 'credit', desk: 'sales', impact: 'overdue' },
  { kind: 'short_settlement', query: 'watch.short_settlement', needs: 'counter', desk: 'sales', impact: 'short' },
  { kind: 'dead_stock', query: 'watch.dead_stock', needs: 'stock', desk: 'stock', impact: 'stock_value' },
  { kind: 'unrecovered_advance', query: 'watch.unrecovered_advance', needs: 'staff', desk: 'staff', impact: 'outstanding' },
  { kind: 'hold_expiring', query: 'watch.hold_expiring', needs: 'holds', desk: 'stock', impact: 'price', instant: true },
  { kind: 'regulars_lapsing', query: 'watch.regulars_lapsing', needs: 'campaigns', desk: 'customers', impact: 'monthly_spend' },
  { kind: 'package_expiry', query: 'watch.package_expiry', needs: 'packages', desk: 'packages', impact: 'value_left' },
  { kind: 'idle_stylist', query: 'watch.idle_stylist', needs: 'bookings', desk: 'bookings', impact: 'idle_value' },
  { kind: 'stylist_absent_booked', query: 'watch.stylist_absent_booked', needs: 'bookings', desk: 'bookings', impact: 'value' },
  { kind: 'unbilled_booking', query: 'watch.unbilled_booking', needs: 'bookings', desk: 'bookings', impact: 'price', instant: true },
  { kind: 'hold_pressure', query: 'watch.hold_pressure', needs: 'bookings', desk: 'bookings', impact: 'held_value', instant: true },
  { kind: 'order_unanswered', query: 'watch.order_unanswered', needs: 'orders', desk: 'orders', impact: 'total', instant: true },
  { kind: 'order_late', query: 'watch.order_late', needs: 'orders', desk: 'orders', impact: 'total' },
  { kind: 'advance_unapplied', query: 'watch.advance_unapplied', needs: 'orders', desk: 'orders', impact: 'unapplied' },
] as const;

export type Raised = { findingId: string; kind: string; dedupeKey: string; snapshotId: string; row: number };

const keyText = (cell: Cell | undefined) => (cell && cell.kind === 'text' ? cell.txt : cell && cell.kind === 'date' ? cell.day : '');

// The severity ladder on the impact cell, in paise: the IN defaults for a small shop (BLUEPRINT §7.4, INFERENCE).
export function severity(impact: Cell | undefined): 'low' | 'medium' | 'high' | 'critical' {
  const n = impact?.kind === 'money' ? Math.abs(Number(impact.num)) : 0;
  return n >= 1_000_000 ? 'critical' : n >= 200_000 ? 'high' : n >= 50_000 ? 'medium' : 'low';
}

/**
 * The capabilities on for the current tenant (RLS), the one place watchers read them: per capability its latest switch
 * (ops.capability_switch, latest wins); no switch row reads as off, as in can() (capabilities.ts): sign-up and
 * provisioning write the pack's switches. A needs_grant capability's platform grant is can()'s, not read here.
 */
export async function capabilitiesOn(c: pg.ClientBase): Promise<Set<string>> {
  const { rows } = await c.query<{ code: string }>(
    `select r.code from ref.capability r
      where coalesce((select s.is_on from ops.capability_switch s where s.capability = r.code order by s.at desc, s.id desc limit 1), false)`,
  );
  return new Set(rows.map((r) => r.code));
}

/**
 * One watcher run for the tenant. `asOf` is the business date the date-bounded reads stop at (default: today in the
 * shop's zone); `at` the instant the minute- and hour-bounded reads measure from (default: now). Neither enters a key.
 */
export function runWatchers(
  pool: pg.Pool,
  tenantId: string,
  asOf?: string,
  at?: Date,
): Promise<{ runId: string; asOf: string; raised: Raised[]; resolved: string[]; rows: number }> {
  return withTx(pool, { kind: 'system', tenantId }, async (c) => {
    const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');
    if (!t[0]) throw new CoreError('not_found');
    const instant = at ?? new Date();
    const day = asOf ?? businessDate(instant, t[0].time_zone);
    const { rows: run } = await c.query<{ id: string }>(
      `insert into ai.run (tenant_id, trigger, desk) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, 'watcher', 'watch') returning id`,
    );
    const runId = (run[0] as { id: string }).id;
    const on = await capabilitiesOn(c);
    // A snoozed finding whose time has come is open again before this run sees it.
    await c.query(`update ai.finding set status = 'open' where status = 'snoozed' and snoozed_until <= now()`);
    const raised: Raised[] = [];
    const resolved: string[] = [];
    let rows = 0;
    for (const w of WATCHERS) {
      if (!on.has(w.needs)) continue;
      const snap = await mintIn(c, w.query, 'instant' in w ? { as_of: day, at: instant.toISOString() } : { as_of: day }, runId);
      const key = (QUERIES.get(w.query) as { key: string[] }).key;
      const keys: string[] = [];
      for (const [i, row] of snap.rows.entries()) {
        rows++;
        const dedupeKey = `${w.kind}:${key.map((k) => keyText(row[k])).join(':')}`;
        keys.push(dedupeKey);
        // Seen again: the open (or snoozed) finding names this run, and moves to this snapshot only if its row's cells
        // changed; with the same cells the database keeps its snapshot and pin (row_sha256, ai.finding_flow).
        const seen = await c.query(`update ai.finding set snapshot_id = $2, snapshot_row = $3, last_run_id = $4 where dedupe_key = $1 and status in ('open', 'snoozed')`, [
          dedupeKey,
          snap.id,
          i,
          runId,
        ]);
        if (seen.rowCount) continue;
        // A key dismissed in the last 30 days rests (MS012 would refuse its raise, and with it the whole run). A row that
        // names its shop raises that branch's finding; any other row the tenant's (shop_id null, R4 N4).
        const shop = row.shop_id?.kind === 'text' ? row.shop_id.txt : null;
        const { rows: made } = await c.query<{ id: string }>(
          `insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id, shop_id)
           select nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, '\\x00', $7, $8, $8, $9::uuid
            where not exists (select 1 from ai.finding f where f.dedupe_key = $3 and f.status = 'dismissed' and f.closed_at > now() - interval '30 days')
           returning id`,
          [w.desk, w.kind, dedupeKey, severity(w.impact ? row[w.impact] : undefined), snap.id, i, w.impact, runId, shop],
        );
        if (made[0]) raised.push({ findingId: made[0].id, kind: w.kind, dedupeKey, snapshotId: snap.id, row: i });
      }
      // The situation cleared: this kind's read covers every branch of the tenant, and a key it no longer returns is
      // resolved, by this run with no actor (the database stamps closed_at). It may recur later as a new finding.
      const { rows: gone } = await c.query<{ id: string }>(
        `update ai.finding set status = 'resolved', last_run_id = $3 where kind = $1 and status in ('open', 'snoozed') and dedupe_key <> all ($2::text[]) returning id::text`,
        [w.kind, keys, runId],
      );
      resolved.push(...gone.map((g) => g.id));
    }
    await c.query(`update ai.run set ended_at = now(), outcome = 'raised' where id = $1`, [runId]);
    return { runId, asOf: day, raised, resolved, rows };
  });
}

export type FindingState = { kind: string; status: string; snapshotId: string; row: number; current: boolean; openDraft: boolean };

/**
 * What the agent checks before it explains a finding or drafts its fix: its kind and status; the row that holds its
 * numbers (its own: a finding moves to a newer snapshot whenever its row's cells change, so its own row is the latest
 * the watchers saw); whether the latest watcher run still sees it (`current`: that run named it, last_run_id; a run
 * reads every kind whose capability is on, and resolves what it no longer sees, so an open finding that is not current
 * is one whose capability went off); and whether a draft for it already awaits a decision. null: no such finding for
 * this tenant. A read, on any pool that can read findings (the app's, in a system scope).
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
