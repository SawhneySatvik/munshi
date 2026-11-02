// The agent's port as the app builds it (server only). A question or a photo starts an ai.run for the signed-in
// member; the agent then gets a port bound to that ONE tenant and that ONE run, and nothing else. Every write of the run
// is that member's, as munshi_app: the database admits a run, its evidence snapshots, a stored count or bill, a draft
// and a trace from nothing else.
// - read: core mints an `evidence` snapshot of a named read in the member's scope, stamped with the run;
// - resolve: runs on the agent's own pool, connected as the read-only munshi_agent role, in a read-only transaction
//   that sets only the run's tenant (forced RLS keeps every other shop's rows out); the pool refuses to serve as any
//   other role (checkAgentRole);
// - finding: its kind, row and state (status, whether the latest watcher run still sees it, an open draft) come from
//   core's findingState on the app pool in a `system` scope, because munshi_agent holds no grant on ai.finding or
//   approval.draft (and agent_view has no views yet); its cells are read the same way as resolve; it writes nothing;
// - propose: core's proposeDraft for the run: a draft waits for a person, nothing applies;
// - recordCount / recordBill: core's evidence writers for this run (a photo's count, a read bill);
// - trace: ai.trace keeps the event's kind, a fixed label, its ids and its timing. A label outside the agent's fixed
//   lists is stored as "unlisted" and anything that is not a uuid is dropped from its ids, so no model text, question,
//   name or bill text can reach a trace through this port.
// - models: core's modelFor for the run's tenant: the shop's choice for the agent, the edition's default, then the other
//   aliases the platform's allow-list has enabled for the role (each one this build serves). Empty: the run abstains and
//   the surface shows its template.
// - an inbox run (a reply, an order, a voice note heard, a campaign's copy) adds core's inbox writers bound to the run
//   and its member: the message's words read as the member, a transcript stored once, spans read by core, copy and a
//   reply's words held to K3. Each still only proposes: a draft waits for a person.
// The models run as those aliases, replayed from apps/web/fixtures in recorded mode (MUNSHI_MODEL_MODE, default
// recorded): the agent never reaches a model the app did not name. The morning brief's narrator (briefNarrator) runs on
// the jobs role inside the tick, with no member: it reads a finding's cells and proposes nothing.
import path from "node:path";
import {
  type AgentPort,
  type Deps,
  type EvidencePort,
  FLOW_LABELS,
  INBOX_LABELS,
  type InboxPort,
  modelCatalogue,
  narrateBrief,
  parseMode,
  TRACE_LABELS,
  type TraceEvent,
} from "@munshi/agent";
import {
  allow,
  type BriefNarration,
  type BriefNarrator,
  findingState,
  inboundWords,
  mintSnapshot,
  modelFor,
  proposeDraft,
  readRow,
  recordBillRead,
  recordExtracts,
  recordShelfCount,
  resolveRef,
  type Session,
  saveTranscript,
  withTx,
  writeCopy,
  writeReply,
} from "@munshi/core";
import pg from "pg";
import { readEdition } from "../edition.ts";
import { config } from "./config.ts";
import { appPool } from "./db.ts";
import { repoRoot } from "./root.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AGENT_ROLE = "munshi_agent";

// Kept on globalThis so next dev's module reloads reuse one pool.
const held = globalThis as typeof globalThis & { munshiAgentPool?: Promise<pg.Pool> | undefined };

/**
 * The gate: before the pool is first handed out it checks who it is. It serves only as `role` (munshi_agent), not a
 * superuser, without BYPASSRLS, and holding no INSERT, UPDATE, DELETE or TRUNCATE on any table or view outside the
 * system catalogues, nor INSERT or UPDATE on any single column (the schema grants by column).
 * munshi_app (which can write the books), a superuser, or a role someone granted a write is refused.
 */
export async function checkAgentRole(pool: pg.Pool, role: string = AGENT_ROLE): Promise<void> {
  const { rows } = await pool.query<{ role: string; superuser: boolean; bypass: boolean; writable: number }>(
    `select r.rolname as role, r.rolsuper as superuser, r.rolbypassrls as bypass,
            (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where c.relkind in ('r', 'p', 'v', 'm', 'f')
                and n.nspname <> 'information_schema' and n.nspname not like 'pg\\_%'
                and (has_any_column_privilege(c.oid, 'INSERT') or has_any_column_privilege(c.oid, 'UPDATE')
                     or has_table_privilege(c.oid, 'DELETE') or has_table_privilege(c.oid, 'TRUNCATE'))) as writable
       from pg_roles r where r.rolname = current_user`,
  );
  const me = rows[0];
  if (me?.role !== role || me.superuser || me.bypass || me.writable !== 0) {
    throw new Error("agent: the agent's pool must connect as munshi_agent (no superuser, no BYPASSRLS, no write grant); refusing to serve");
  }
}

async function open(): Promise<pg.Pool> {
  const url = config().agentDatabaseUrl;
  if (!url) throw new Error("agent: AGENT_DATABASE_URL is not set; start the app with pnpm dev");
  const pool = new pg.Pool({ connectionString: url, max: 4, application_name: AGENT_ROLE });
  try {
    await checkAgentRole(pool);
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

export type Flow = "ask" | "shelf" | "bill" | "finding" | "brief" | "inbox" | "campaign";

/** Where the recorded model responses for one of the app's flows live (written by the hero tests, see test/hero-script.ts). */
export const fixturesDir = (flow: Flow) => path.join(/*turbopackIgnore: true*/ repoRoot(), "apps", "web", "fixtures", flow);

/** How the agent reaches its models for a flow: the edition's roles; recorded mode replays that flow's fixtures. */
export function agentDeps(flow: Flow): Deps {
  return { fixturesDir: fixturesDir(flow), edition: readEdition(), mode: appMode() };
}

// An empty MUNSHI_MODEL_MODE is the default (recorded) for the app and, because the app passes it down, for the agent.
const appMode = () => parseMode(process.env.MUNSHI_MODEL_MODE || undefined);

/** True when model answers are replayed from recorded fixtures (the screens say "Recorded response"). */
export const recordedMode = () => appMode() === "recorded";

export type Trigger = "question" | "photo" | "recipe" | "inbox" | "campaign" | "voice";
export type AgentRun = { runId: string; tenantId: string; session: Session; port: EvidencePort; events: TraceEvent[] };

// A run's desk is fixed when it starts, and names its cast member (lib/cast.ts): a question's is picked by the router
// inside the run, so it is filed under `ask`; a finding's "Why?" under its watcher's desk; a shelf photo under `shelf`
// and a bill under `bills` (the callers name them); a finding's fix under `recipe`; a tap on an inbox message under the
// desk it asks for (replies, chat_to_order, voice); campaign copy under `campaigns`. A run's draft takes its desk.
const DESK: Record<Trigger, string> = { question: "ask", photo: "stock", recipe: "recipe", inbox: "inbox", campaign: "campaigns", voice: "voice" };
const LABELS = new Set([...TRACE_LABELS, ...FLOW_LABELS, ...INBOX_LABELS]);
const cleanLabel = (label: string) => (label.split(",").every((l) => LABELS.has(l)) ? label : "unlisted");
// ai.trace.label holds [a-z0-9_.:-] only, at most 64: a list of fixed words is stored joined by ':', a longer one as
// unlisted.
const storedLabel = (label: string) => (/^[a-z0-9_.:-]{1,64}$/.test(label.replaceAll(",", ":")) ? label.replaceAll(",", ":") : "unlisted");

/** Starts an ai.run for the signed-in member and builds the port bound to it. */
export async function startRun(session: Session, trigger: Trigger, desk: string = DESK[trigger]): Promise<AgentRun> {
  const tenantId = session.tenantId;
  const app = await appPool();
  const member = { kind: "member", session } as const;
  const runId = await withTx(app, member, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into ai.run (tenant_id, trigger, desk) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2) returning id`,
      [trigger, desk],
    );
    return (rows[0] as { id: string }).id;
  });
  const run = { session, runId };
  const events: TraceEvent[] = [];
  const port: EvidencePort = {
    async read(name, params) {
      const snap = await mintSnapshot(app, member, name, params, runId);
      return { snapshotId: snap.id, rows: snap.rows };
    },
    resolve: (ref) => asAgent(tenantId, (c) => resolveRef(c, ref)),
    async finding(findingId) {
      const state = await findingState(app, tenantId, findingId);
      const row = state && (await asAgent(tenantId, (c) => readRow(c, state)));
      if (!state || !row) return null;
      // By column name, the order the agent has always been shown a finding's row in (its handles are numbered in it).
      const cells = Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      return { id: findingId, kind: state.kind, snapshotId: state.snapshotId, row: state.row, cells, status: state.status, current: state.current, openDraft: state.openDraft };
    },
    propose: ({ command, payload, basedOn, payloadRefs, findingId }) =>
      proposeDraft(app, run, { command, payload, basedOn, payloadRefs, ...(findingId ? { findingId } : {}) }),
    recordCount: (count) => recordShelfCount(app, run, count),
    recordBill: (bill) => recordBillRead(app, run, bill),
    // Core's allowance for each model call (BLUEPRINT §4.6): counted in ai.usage against the shop's caps, refused when the
    // deployment, the shop's platform config or the demo default has AI off; the run then abstains, never errors.
    allow: async (role) => (await allow(app, tenantId, role, config().ai ?? "on")).ok,
    models: (agent, role) => withTx(app, { kind: "system", tenantId }, (c) => modelFor(c, agent, modelCatalogue(readEdition()), role)),
    // The run read untrusted text (a bill's lines): marked tainted for good, as the member who started it (§7.8).
    async taint() {
      await withTx(app, member, (c) => c.query("update ai.run set tainted = true where id = $1", [runId]));
    },
    async trace(event) {
      const kept: TraceEvent = { kind: event.kind, label: cleanLabel(event.label), ids: event.ids.filter((id) => UUID.test(id)).slice(0, 16), ms: Math.max(0, Math.round(event.ms)) };
      const seq = events.push(kept); // taken before any await: two concurrent traces never share a seq
      await withTx(app, member, (c) =>
        c.query(
          `insert into ai.trace (tenant_id, run_id, seq, kind, label, ids, ms)
           values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
          [runId, seq, kept.kind, storedLabel(kept.label), JSON.stringify(kept.ids), kept.ms],
        ),
      );
    },
  };
  return { runId, tenantId, session, port, events };
}

export type InboxRun = Omit<AgentRun, "port"> & { port: InboxPort };

/** Starts an inbox run (a reply, an order, a voice note, a campaign's copy) for the signed-in member: the agent port plus
 * core's inbox writers bound to this run and member. */
export async function startInboxRun(session: Session, trigger: "inbox" | "campaign" | "voice", desk?: string): Promise<InboxRun> {
  const run = await startRun(session, trigger, desk);
  const app = await appPool();
  const by = { session, runId: run.runId };
  const port: InboxPort = {
    ...run.port,
    runId: run.runId,
    message: (messageId) => inboundWords(app, session, messageId),
    saveTranscript: (messageId, transcript) => saveTranscript(app, session, messageId, transcript),
    recordExtracts: (messageId, spans) => recordExtracts(app, by, messageId, spans),
    writeCopy: (campaignId, body) => writeCopy(app, by, campaignId, body),
    writeReply: (body) => writeReply(app, by, body),
  };
  return { ...run, port };
}

/**
 * Ends the run (its traces and snapshots stay) as the member who started it, with its outcome and model calls from its
 * own trace: a draft proposed, else an abstention, else an answer.
 */
export async function endRun(run: Pick<AgentRun, "runId" | "session" | "events">, failed = false): Promise<void> {
  const has = (kind: TraceEvent["kind"]) => run.events.some((e) => e.kind === kind);
  const outcome = failed ? "failed" : has("propose") ? "proposed" : has("abstain") ? "abstained" : "answered";
  const calls = run.events.filter((e) => e.kind === "model").length;
  await withTx(await appPool(), { kind: "member", session: run.session }, (c) =>
    c.query("update ai.run set ended_at = now(), outcome = $2, model_calls = $3 where id = $1", [run.runId, outcome, calls]),
  );
}

/** Runs a flow on its run and ends the run: with its outcome, or `failed` when the flow throws (the error goes on). */
export async function inRun<T>(run: Pick<AgentRun, "runId" | "session" | "events">, work: () => Promise<T>): Promise<T> {
  let out: T;
  try {
    out = await work();
  } catch (err) {
    await endRun(run, true).catch(() => {});
    throw err;
  }
  await endRun(run);
  return out;
}

/**
 * The morning brief's narrator for the tick (core's writeBrief calls it between its two transactions): the agent's
 * narrateBrief on a port bound to the brief's run and tenant, with no member. A finding's state and cells, every ref and
 * the run's models are read as the app's port reads them (findingState and modelFor in a `system` scope, cells as the
 * read-only agent role); core's allow counts each call on the jobs pool; each trace is the jobs role's row of the run.
 * It reads and proposes nothing else. An answer goes back as segments, which core checks again before it keeps them;
 * anything else leaves the template lines, and the run's outcome says why (abstained, or budget when AI is off).
 */
export function briefNarrator(jobs: pg.Pool, deps: Deps = agentDeps("brief")): BriefNarrator {
  return async (runId, findingIds, { tenantId, asOf }): Promise<BriefNarration> => {
    const app = await appPool();
    const system = { kind: "system", tenantId } as const;
    const events: TraceEvent[] = [];
    const refuse = () => {
      throw new Error("agent: the brief reads and proposes nothing");
    };
    const port: AgentPort = {
      read: refuse,
      propose: refuse,
      resolve: (ref) => asAgent(tenantId, (c) => resolveRef(c, ref)),
      async finding(findingId) {
        const state = await findingState(app, tenantId, findingId);
        const row = state && (await asAgent(tenantId, (c) => readRow(c, state)));
        if (!state || !row) return null;
        const cells = Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        return { id: findingId, kind: state.kind, snapshotId: state.snapshotId, row: state.row, cells, status: state.status, current: state.current, openDraft: state.openDraft };
      },
      allow: async (role) => (await allow(jobs, tenantId, role, config().ai ?? "on")).ok,
      models: (agent, role) => withTx(app, system, (c) => modelFor(c, agent, modelCatalogue(readEdition()), role)),
      async trace(event) {
        const kept: TraceEvent = { kind: event.kind, label: cleanLabel(event.label), ids: event.ids.filter((id) => UUID.test(id)).slice(0, 16), ms: Math.max(0, Math.round(event.ms)) };
        const seq = events.push(kept); // taken before any await
        await withTx(jobs, system, (c) =>
          c.query(
            `insert into ai.trace (tenant_id, run_id, seq, kind, label, ids, ms)
             values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6)`,
            [runId, seq, kept.kind, storedLabel(kept.label), JSON.stringify(kept.ids), kept.ms],
          ),
        );
      },
    };
    const calls = () => events.filter((e) => e.kind === "model").length;
    let reply: Awaited<ReturnType<typeof narrateBrief>>;
    try {
      reply = await narrateBrief(findingIds, { port, asOf, deps });
    } catch {
      // A narrator that throws: the run failed, with the model calls allow() already counted.
      return { outcome: "failed", modelCalls: calls() };
    }
    const modelCalls = calls();
    if (reply.kind === "answer") return { outcome: "answered", segments: reply.segments.map((x) => ({ text: x.text, refs: x.refs })), modelCalls };
    return { outcome: events.some((e) => e.label === "ai_off") ? "budget" : "abstained", modelCalls };
  };
}
