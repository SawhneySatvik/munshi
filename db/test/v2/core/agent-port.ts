// The agent's port as the app builds it, over the real v2 database: a question (or a photo) starts an ai.run for the
// member who asked, and every write of the run is that member's, as munshi_app (the database admits a run, its
// evidence snapshots, a stored count or bill, a draft and a trace from nothing else): reads mint `evidence` snapshots
// stamped with the run; refs and a finding's cells are resolved by the read-only munshi_agent role under the tenant's
// RLS; a finding's state comes from core's findingState (the agent role holds no grant on ai.finding, and agent_view
// has no views yet); drafts are proposed for the run and wait for a person; a photo's evidence is stored by core's
// writers for that run; trace events land in ai.trace as kinds, fixed labels, ids and timings. Used by the agent tests
// (a1, h1–h3), so it imports nothing of the test harness; the app's own port (apps/web/lib/server/agent-port.ts) is
// built the same way.
import { findingState, mintSnapshot, proposeDraft, readRow, recordBillRead, recordShelfCount, resolveRef, type Session, withTx } from '@munshi/core';
import type pg from 'pg';
import { FLOW_LABELS } from '../../../../packages/agent/src/photo.ts';
import type { EvidencePort, TraceEvent } from '../../../../packages/agent/src/port.ts';
import { TRACE_LABELS } from '../../../../packages/agent/src/run.ts';

type Pools = { app: pg.Pool; agent: pg.Pool };
export type Trigger = 'question' | 'photo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A run's desk is fixed when it starts: a question's is picked by the router inside the run, so it is filed under `ask`;
// both photo flows (a shelf count, a bill) are the Stock desk's.
const DESK: Record<Trigger, string> = { question: 'ask', photo: 'stock' };
const LABELS = new Set([...TRACE_LABELS, ...FLOW_LABELS]);
// A label outside the agent's fixed lists is `unlisted`, so no model text, question, name or bill text reaches a trace.
const cleanLabel = (label: string) => (label.split(',').every((l) => LABELS.has(l)) ? label : 'unlisted');
// ai.trace.label holds [a-z0-9_.:-] only, at most 64: a list of fixed words is stored joined by ':', a longer one as
// unlisted.
const storedLabel = (label: string) => (/^[a-z0-9_.:-]{1,64}$/.test(label.replaceAll(',', ':')) ? label.replaceAll(',', ':') : 'unlisted');

export async function startRun(db: Pools, session: Session, trigger: Trigger = 'question'): Promise<string> {
  return withTx(db.app, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ai.run (tenant_id, trigger, desk) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2) returning id`,
      [trigger, DESK[trigger]],
    );
    return (rows[0] as { id: string }).id;
  });
}

// A read as the agent's role: one read-only transaction with only the tenant set.
async function asAgent<T>(agent: pg.Pool, tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await agent.connect();
  try {
    await c.query('begin read only');
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

export function agentPort(db: Pools, session: Session, runId: string): { port: EvidencePort; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  const tenantId = session.tenantId;
  const member = { kind: 'member', session } as const;
  const run = { session, runId };
  const port: EvidencePort = {
    async read(name, params) {
      const snap = await mintSnapshot(db.app, member, name, params, runId);
      return { snapshotId: snap.id, rows: snap.rows };
    },
    resolve: (ref) => asAgent(db.agent, tenantId, (c) => resolveRef(c, ref)),
    async finding(findingId) {
      const state = await findingState(db.app, tenantId, findingId);
      const row = state && (await asAgent(db.agent, tenantId, (c) => readRow(c, state)));
      if (!state || !row) return null;
      // By column name, the order the agent has always been shown a finding's row in (its handles are numbered in it).
      const cells = Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      return { id: findingId, kind: state.kind, snapshotId: state.snapshotId, row: state.row, cells, status: state.status, current: state.current, openDraft: state.openDraft };
    },
    propose: ({ command, payload, basedOn, payloadRefs, findingId }) =>
      proposeDraft(db.app, run, { command, payload, basedOn, payloadRefs, ...(findingId ? { findingId } : {}) }),
    recordCount: (count) => recordShelfCount(db.app, run, count),
    recordBill: (bill) => recordBillRead(db.app, run, bill),
    // The run read untrusted text (a bill's lines): marked tainted for good, as the member who started it.
    taint: async () => {
      await withTx(db.app, member, (c) => c.query('update ai.run set tainted = true where id = $1', [runId]));
    },
    async trace(event) {
      events.push(event);
      const seq = events.length; // taken before any await: two concurrent traces never share a seq
      await withTx(db.app, member, (c) =>
        c.query(
          `insert into ai.trace (tenant_id, run_id, seq, kind, label, ids, ms)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
          [runId, seq, event.kind, storedLabel(cleanLabel(event.label)), JSON.stringify(event.ids.filter((id) => UUID.test(id)).slice(0, 16)), Math.max(0, Math.round(event.ms))],
        ),
      );
    },
  };
  return { port, events };
}
