// The agent's port as the app builds it, over the real database: a question starts an ops.run; reads mint snapshots in
// a system scope (the tenant, no actor) stamped with that run; refs and findings are resolved by the read-only
// munshi_agent role under the tenant's RLS; drafts are proposed with the run as proposer; trace events land in
// ops.run_trace. Used by the agent tests (a1); the app's own port is built the same way.
import { CELL_COLUMNS, type Cell, type CellRow, cellFromRow, mintSnapshot, proposeDraft, resolveRef, withTx } from '@munshi/core';
import type { AgentPort, TraceEvent } from '../../packages/agent/src/port.ts';
import { type TestDb, tx } from './db.ts';

export async function startRun(db: TestDb, tenantId: string, startedBy: string): Promise<string> {
  return withTx(db.app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.run (tenant_id, trigger, started_by) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, 'question', $1) returning id`,
      [startedBy],
    );
    return (rows[0] as { id: string }).id;
  });
}

export function agentPort(db: TestDb, tenantId: string, runId: string): { port: AgentPort; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const system = { kind: 'system', tenantId } as const;
  const port: AgentPort = {
    async read(name, params) {
      const snap = await mintSnapshot(db.app, system, name, params, runId);
      return { snapshotId: snap.id, rows: snap.rows };
    },
    resolve: (ref) => tx(db.agent, { tenant: tenantId }, (c) => resolveRef(c, ref)),
    finding: (findingId) =>
      tx(db.agent, { tenant: tenantId }, async (c) => {
        const { rows } = await c.query<{ kind: string; snapshot_id: string; snapshot_row: number }>(
          'select kind, snapshot_id::text as snapshot_id, snapshot_row from agent_view.finding where id = $1',
          [findingId],
        );
        const f = rows[0];
        if (!f) return null;
        const { rows: stored } = await c.query<CellRow & { col: string }>(
          `select col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = $1 and row_no = $2 order by col`,
          [f.snapshot_id, f.snapshot_row],
        );
        const cells: Record<string, Cell> = Object.fromEntries(stored.map((s) => [s.col, cellFromRow(s)]));
        return { id: findingId, kind: f.kind, snapshotId: f.snapshot_id, row: f.snapshot_row, cells };
      }),
    propose: ({ command, payload, basedOn, payloadRefs, findingId }) =>
      proposeDraft(db.app, { tenantId, runId }, { command, payload, basedOn, payloadRefs, ...(findingId ? { findingId } : {}) }),
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
