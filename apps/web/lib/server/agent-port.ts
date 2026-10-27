// The agent's port as the app builds it (server only). A question or a photo starts an ops.run for the signed-in
// member's shop; the agent then gets a port bound to that ONE tenant and that ONE run, and nothing else:
// - read: core mints a snapshot of a named read in a `system` scope (the tenant, no actor) stamped with the run;
// - resolve and finding: run on the agent's own pool, connected as the read-only munshi_agent role, in a transaction
//   that sets only the run's tenant (forced RLS keeps every other shop's rows out); the pool refuses to serve as any
//   other role (agentPool's gate);
// - propose: core's proposeDraft with the run as proposer: a draft waits for a person, nothing applies;
// - recordCount / recordBill: core's evidence writers for this run (a photo's count, a read bill);
// - trace: ops.run_trace keeps the event's kind, a fixed label and ids, stamped with the time. A label outside the
//   agent's fixed lists is stored as "unlisted" and anything that is not a uuid is dropped from its ids, so no model
//   text, question, name or bill text can reach a trace through this port.
// The models run as the edition's roles, replayed from apps/web/fixtures in recorded mode (MUNSHI_MODEL_MODE, default
// recorded): the agent never reaches a model the app did not name.
import path from "node:path";
import { type Deps, type EvidencePort, FLOW_LABELS, parseMode, TRACE_LABELS, type TraceEvent } from "@munshi/agent";
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
  type Session,
  withTx,
} from "@munshi/core";
import pg from "pg";
import { readEdition } from "../edition";
import { config } from "./config";
import { appPool } from "./db";
import { repoRoot } from "./root";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_ROLE = "munshi_agent";

// Kept on globalThis so next dev's module reloads reuse one pool.
const held = globalThis as typeof globalThis & { munshiAgentPool?: Promise<pg.Pool> | undefined };

/**
 * The gate: before the pool is first handed out it checks who it is. It serves only as munshi_agent, not a superuser,
 * without BYPASSRLS, and holding no INSERT, UPDATE, DELETE or TRUNCATE on any table or view outside the system
 * catalogues. munshi_app (which can write the books), a superuser, or a role someone granted a write is refused.
 */
async function open(): Promise<pg.Pool> {
  const url = config().agentDatabaseUrl;
  if (!url) throw new Error("agent: AGENT_DATABASE_URL is not set; start the app with pnpm dev");
  const pool = new pg.Pool({ connectionString: url, max: 4, application_name: AGENT_ROLE });
  try {
    const { rows } = await pool.query<{ role: string; superuser: boolean; bypass: boolean; writable: number }>(
      `select r.rolname as role, r.rolsuper as superuser, r.rolbypassrls as bypass,
              (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where c.relkind in ('r', 'p', 'v', 'm', 'f')
                  and n.nspname <> 'information_schema' and n.nspname not like 'pg\\_%'
                  and (has_table_privilege(c.oid, 'INSERT') or has_table_privilege(c.oid, 'UPDATE')
                       or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE'))) as writable
         from pg_roles r where r.rolname = current_user`,
    );
    const me = rows[0];
    if (me?.role !== AGENT_ROLE || me.superuser || me.bypass || me.writable !== 0) {
      throw new Error("agent: the agent's pool must connect as munshi_agent (no superuser, no BYPASSRLS, no write grant); refusing to serve");
    }
  } catch (err) {
    await pool.end();
    throw err;
  }
  return pool;
}

export function agentPool(): Promise<pg.Pool> {
  held.munshiAgentPool ??= open().catch((err) => {
    held.munshiAgentPool = undefined;
    throw err;
  });
  return held.munshiAgentPool;
}

/** One transaction as the agent's role with only the tenant set (read only as well: the role has no write grant). */
export async function asAgent<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await (await agentPool()).connect();
  try {
    await c.query("begin read only");
    await c.query("select set_config('munshi.tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (err) {
    await c.query("rollback").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

export type Flow = "ask" | "shelf" | "bill";

/** Where the recorded model responses for one of the app's flows live (written by the hero tests, see test/hero-script.ts). */
export const fixturesDir = (flow: Flow) => path.join(/*turbopackIgnore: true*/ repoRoot(), "apps", "web", "fixtures", flow);

/** How the agent reaches its models for a flow: the edition's roles; recorded mode replays that flow's fixtures. */
export function agentDeps(flow: Flow): Deps {
  return { fixturesDir: fixturesDir(flow), edition: readEdition() };
}

/** True when model answers are replayed from recorded fixtures (the screens say "Recorded response"). */
export const recordedMode = () => parseMode(process.env.MUNSHI_MODEL_MODE || undefined) === "recorded";

export type AgentRun = { runId: string; tenantId: string; port: EvidencePort; events: TraceEvent[] };

const LABELS = new Set([...TRACE_LABELS, ...FLOW_LABELS]);
const cleanLabel = (label: string) => (label.split(",").every((l) => LABELS.has(l)) ? label : "unlisted");

/** Starts an ops.run for the signed-in member's shop and builds the port bound to it. */
export async function startRun(session: Session, trigger: "question" | "photo"): Promise<AgentRun> {
  const tenantId = session.tenantId;
  const app = await appPool();
  const system = { kind: "system", tenantId } as const;
  const runId = await withTx(app, system, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ops.run (tenant_id, trigger, started_by) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2) returning id`,
      [trigger, session.memberId],
    );
    return (rows[0] as { id: string }).id;
  });
  const by = { tenantId, runId };
  const events: TraceEvent[] = [];
  const port: EvidencePort = {
    async read(name, params) {
      const snap = await mintSnapshot(app, system, name, params, runId);
      return { snapshotId: snap.id, rows: snap.rows };
    },
    resolve: (ref) => asAgent(tenantId, (c) => resolveRef(c, ref)),
    finding: (findingId) =>
      asAgent(tenantId, async (c) => {
        const { rows } = await c.query<{ kind: string; snapshot_id: string; snapshot_row: number }>(
          "select kind, snapshot_id::text as snapshot_id, snapshot_row from agent_view.finding where id = $1",
          [findingId],
        );
        const f = rows[0];
        const state = f && (await findingState(app, tenantId, findingId));
        if (!f || !state) return null;
        const at = state.seen ?? { snapshotId: f.snapshot_id, row: f.snapshot_row };
        const { rows: stored } = await c.query<CellRow & { col: string }>(
          `select col, ${CELL_COLUMNS} from snap.snapshot_cell where snapshot_id = $1 and row_no = $2 order by col`,
          [at.snapshotId, at.row],
        );
        const cells: Record<string, Cell> = Object.fromEntries(stored.map((s) => [s.col, cellFromRow(s)]));
        return { id: findingId, kind: f.kind, snapshotId: at.snapshotId, row: at.row, cells, status: state.status, current: state.seen !== null, openDraft: state.openDraft };
      }),
    propose: ({ command, payload, basedOn, payloadRefs, findingId }) =>
      proposeDraft(app, by, { command, payload, basedOn, payloadRefs, ...(findingId ? { findingId } : {}) }),
    recordCount: (count) => recordShelfCount(app, by, count),
    recordBill: (bill) => recordBillRead(app, by, bill),
    async trace(event) {
      const kept: TraceEvent = { kind: event.kind, label: cleanLabel(event.label), ids: event.ids.filter((id) => UUID.test(id)), ms: event.ms };
      events.push(kept);
      await withTx(app, system, (c) =>
        c.query(
          `insert into ops.run_trace (tenant_id, run_id, seq, kind, label, refs)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)`,
          [runId, events.length, kept.kind, kept.label, JSON.stringify(kept.ids)],
        ),
      );
    },
  };
  return { runId, tenantId, port, events };
}

/** Marks the run ended (its traces and snapshots stay). */
export async function endRun(run: AgentRun): Promise<void> {
  await withTx(await appPool(), { kind: "system", tenantId: run.tenantId }, (c) => c.query("update ops.run set ended_at = now() where id = $1", [run.runId]));
}
