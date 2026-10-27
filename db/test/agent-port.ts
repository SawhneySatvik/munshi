// The agent's port as the app builds it, over the real database: a question (or a photo) starts an ops.run; reads mint
// snapshots in a system scope (the tenant, no actor) stamped with that run; refs and findings are resolved by the
// read-only munshi_agent role under the tenant's RLS; drafts are proposed with the run as proposer; a photo's evidence
// is stored by core's writers for that run; trace events land in ops.run_trace. Used by the agent tests (a1, h1–h3) and
// by scripts/hero-smoke.ts, so it imports nothing of the test harness; the app's own port is built the same way.
import {
  CELL_COLUMNS,
  type Cell,
  type CellRow,
  cellFromRow,
  findingState,
  mintSnapshot,
  proposeDraft,
  recordBillRead,
  recordShelfCount,
  resolveRef,
  withTx,
} from '@munshi/core';
import type pg from 'pg';
import type { EvidencePort, TraceEvent } from '../../packages/agent/src/port.ts';

type Pools = { app: pg.Pool; agent: pg.Pool };

export async function startRun(db: Pools, tenantId: string, startedBy: string, trigger: 'question' | 'photo' = 'question'): Promise<string> {
  return withTx(db.app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.run (tenant_id, trigger, started_by) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2) returning id`,
      [trigger, startedBy],
    );
    return (rows[0] as { id: string }).id;
  });
}

// A read as the agent's role: one transaction with only the tenant set.
async function asAgent<T>(agent: pg.Pool, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await agent.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
}

export function agentPort(db: Pools, tenantId: string, runId: string): { port: EvidencePort; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const system = { kind: 'system', tenantId } as const;
  const run = { tenantId, runId };
  const port: EvidencePort = {
    async read(name, params) {
      const snap = await mintSnapshot(db.app, system, name, params, runId);
      return { snapshotId: snap.id, rows: snap.rows };
    },
    resolve: (ref) => asAgent(db.agent, tenantId, (c) => resolveRef(c, ref)),
    finding: (findingId) =>
      asAgent(db.agent, tenantId, async (c) => {
        const { rows } = await c.query<{ kind: string; snapshot_id: string; snapshot_row: number }>(
          'select kind, snapshot_id::text as snapshot_id, snapshot_row from agent_view.finding where id = $1',
          [findingId],
        );
        const f = rows[0];
        const state = f && (await findingState(db.app, tenantId, findingId));
        if (!f || !state) return null;
        const at = state.seen ?? { snapshotId: f.snapshot_id, row: f.snapshot_row }; // where the latest watcher run sees it
        const { rows: stored } = await c.query<CellRow & { col: string }>(
          `select col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = $1 and row_no = $2 order by col`,
          [at.snapshotId, at.row],
        );
        const cells: Record<string, Cell> = Object.fromEntries(stored.map((s) => [s.col, cellFromRow(s)]));
        return { id: findingId, kind: f.kind, snapshotId: at.snapshotId, row: at.row, cells, status: state.status, current: state.seen !== null, openDraft: state.openDraft };
      }),
    propose: ({ command, payload, basedOn, payloadRefs, findingId }) =>
      proposeDraft(db.app, run, { command, payload, basedOn, payloadRefs, ...(findingId ? { findingId } : {}) }),
    recordCount: (count) => recordShelfCount(db.app, run, count),
    recordBill: (bill) => recordBillRead(db.app, run, bill),
    async trace(event) {
      events.push(event);
      await withTx(db.app, system, (c) =>
        c.query(
          `insert into ops.run_trace (tenant_id, run_id, seq, kind, label, refs)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)`,
          [runId, events.length, event.kind, event.label, JSON.stringify(event.ids)],
        ),
      );
    },
  };
  return { port, events };
}
