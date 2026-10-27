// Drafts and decisions: nothing auto-applies. A draft names a command, its payload, the snapshot cells it relied on
// (based_on) and, for every number in its payload, the cell that number came from (payload_refs). decide() runs on the
// approver's own request — the approver is the session's member, there is no other parameter for it — and in ONE
// transaction: lock the draft, re-check every cited cell (changed → `stale`, and only that is committed), insert the
// decision, execute the command under it (the guard admits and audits each book row as the approver), mark the draft
// executed, and audit the decision itself.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { type CommandResult, command, execute, parseInput } from './commands.ts';
import { CoreError } from './errors.ts';
import { type Cell, type CellRef, formatRef, resolveRef } from './read.ts';
import { type Session, withTx } from './session.ts';
import { recheck } from './snapshots.ts';

export type Proposer = { session: Session } | { tenantId: string; runId: string }; // a member, or an agent/watcher run

// payloadRefs maps the path of every number in the payload (`qtyMilli`, `lines[0].qtyMilli`) to the cell holding it.
// Optional in the type only while the agent's port and the app wire it through (deprecated, MS-1 fix cycle 2): absent
// is `{}`, so a payload with any number is refused.
export type DraftInput = { command: string; payload: unknown; basedOn: CellRef[]; payloadRefs?: Record<string, CellRef>; findingId?: string };

const refSchema = z.strictObject({ snapshotId: z.guid(), row: z.number().int().nonnegative(), col: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/) });
const path = z.string().regex(/^[A-Za-z]\w{0,62}(?:\[\d{1,3}\]|\.[A-Za-z]\w{0,62}){0,8}$/);
const draftSchema = z.strictObject({
  command: z.string(),
  payload: z.unknown(),
  basedOn: z.array(refSchema).min(1).max(50),
  payloadRefs: z.record(path, refSchema).default({}),
  findingId: z.guid().optional(),
});

export type Decision =
  | { status: 'executed'; decisionId: string; result: CommandResult }
  | { status: 'rejected'; decisionId: string }
  | { status: 'stale'; changed: string[] };

// Every number in a parsed payload, by its path.
function numbersIn(v: unknown, at = ''): [string, number][] {
  if (typeof v === 'number') return [[at, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => numbersIn(x, `${at}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => numbersIn(x, at ? `${at}.${k}` : k));
  return [];
}

// A payload number's cell must hold that number, in the kind its name says (…Minor: money, …Milli: a quantity).
function holds(cell: Cell | null, at: string, n: number): boolean {
  const kind = at.endsWith('Minor') ? 'money' : at.endsWith('Milli') ? 'quantity' : 'integer';
  return cell !== null && cell.kind === kind && 'num' in cell && cell.num === String(n);
}

// The items and customers a payload names (an `itemId` or `customerId` at any depth).
function named(v: unknown, key = ''): [string, string][] {
  if (typeof v === 'string') return key === 'itemId' || key === 'customerId' ? [[key, v]] : [];
  if (Array.isArray(v)) return v.flatMap((x) => named(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => named(x, k));
  return [];
}

// The undated reads of an entity's current state, and the cell a draft must cite for it. The watch.* reads stop at their
// as_of, so a write-off recorded after it would never stale a draft that cites only them (the MS-5 review: on-hand went
// 32 → 12 → −8). No undated per-customer read exists yet, so a stock or money draft naming a customer is refused, and so
// is one naming neither an item nor a customer (a settlement, a supplier payment).
const CURRENT: Record<string, { query: string; param: string; col: string }> = {
  itemId: { query: 'stock.on_hand', param: 'item_id', col: 'on_hand' },
};

async function citesCurrent(c: pg.PoolClient, cited: CellRef[], key: string, id: string): Promise<boolean> {
  const cur = CURRENT[key];
  if (!cur) return false;
  for (const ref of cited.filter((r) => r.col === cur.col)) {
    const { rows } = await c.query<{ query_name: string; params: Record<string, unknown> }>('select query_name, params from snap.snapshot where id = $1', [
      ref.snapshotId,
    ]);
    const snap = rows[0];
    if (snap?.query_name === cur.query && Object.keys(snap.params).join() === cur.param && snap.params[cur.param] === id) return true;
  }
  return false;
}

export async function proposeDraft(pool: pg.Pool, by: Proposer, input: DraftInput): Promise<string> {
  const r = draftSchema.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(draft)') });
  const d = r.data;
  const payload = parseInput(command(d.command), d.payload); // stored normalised; re-parsed at decision time
  const numbers = numbersIn(payload);
  const unmapped = [
    ...numbers.map(([at]) => at).filter((at) => !Object.hasOwn(d.payloadRefs, at)),
    ...Object.keys(d.payloadRefs).filter((at) => !numbers.some(([n]) => n === at)),
  ];
  if (unmapped.length) throw new CoreError('invalid', { fields: unmapped.map((at) => `payloadRefs.${at}`) });
  const scope = 'session' in by ? ({ kind: 'member', session: by.session } as const) : ({ kind: 'system', tenantId: by.tenantId } as const);
  const draftId = randomUUID();
  await withTx(pool, scope, async (c) => {
    for (const ref of d.basedOn) {
      if (!(await resolveRef(c, ref))) throw new CoreError('invalid', { fields: ['basedOn'] }); // a ref must name a stored cell
    }
    for (const [at, n] of numbers) {
      if (!holds(await resolveRef(c, d.payloadRefs[at] as CellRef), at, n)) throw new CoreError('invalid', { fields: [`payloadRefs.${at}`] });
    }
    // A command that moves stock or money (it writes a stock move or a journal line) must see today's books at approval.
    const { rows: moves } = await c.query(
      `select 1 from ops.command_table where command = $1 and rel in ('books.stock_move', 'books.journal_line')`,
      [d.command],
    );
    if (moves.length) {
      const cited = [...d.basedOn, ...Object.values(d.payloadRefs)];
      const touched = named(payload);
      let current = touched.length > 0;
      for (const [key, id] of touched) current = current && (await citesCurrent(c, cited, key, id));
      if (!current) throw new CoreError('invalid', { fields: ['basedOn'] });
    }
    await c.query(
      `insert into approval.draft (tenant_id, id, command_type, payload, based_on, payload_refs, run_id, proposed_by, finding_id)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        draftId,
        d.command,
        payload,
        JSON.stringify(d.basedOn),
        d.payloadRefs,
        'runId' in by ? by.runId : null,
        'session' in by ? by.session.memberId : null,
        d.findingId ?? null,
      ],
    );
  });
  return draftId;
}

async function auditDecision(c: pg.PoolClient, session: Session, draftId: string, command: string, action: string, decisionId: string | null, payload: object) {
  await c.query(
    `insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, payload)
     values ($1, $2, $3, $4, $5, 'approval.draft', $6, $7)`,
    [session.tenantId, session.memberId, decisionId, command, action, draftId, payload],
  );
}

export function decide(
  pool: pg.Pool,
  session: Session,
  draftId: string,
  verdict: 'approved' | 'rejected',
  reason?: string,
): Promise<Decision> {
  return withTx(pool, { kind: 'member', session }, async (c): Promise<Decision> => {
    const { rows } = await c.query<{ command_type: string; payload: unknown; based_on: CellRef[]; payload_refs: Record<string, CellRef>; status: string }>(
      'select command_type, payload, based_on, payload_refs, status from approval.draft where id = $1 for update',
      [draftId],
    );
    const draft = rows[0];
    if (!draft) throw new CoreError('not_found');
    if (draft.status !== 'proposed') throw new CoreError('not_proposed');
    const set = (status: string) => c.query('update approval.draft set status = $1, updated_at = now() where id = $2', [status, draftId]);
    const decisionId = randomUUID();
    const insertDecision = () =>
      c.query(
        `insert into approval.decision (tenant_id, id, draft_id, verdict, decided_by, reason)
         values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5)`,
        [decisionId, draftId, verdict, session.memberId, reason ?? null],
      );

    if (verdict === 'rejected') {
      await insertDecision();
      await set('rejected');
      await auditDecision(c, session, draftId, draft.command_type, 'draft.rejected', decisionId, { reason: reason ?? null });
      return { status: 'rejected', decisionId };
    }

    const changed = await recheck(c, [...draft.based_on, ...Object.values(draft.payload_refs)]);
    if (changed.length) {
      await set('stale');
      await auditDecision(c, session, draftId, draft.command_type, 'draft.stale', null, { changed });
      return { status: 'stale', changed };
    }

    const d = command(draft.command_type);
    const input = parseInput(d, draft.payload);
    await insertDecision();
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [decisionId]);
    const result = await execute(c, d, input);
    await set('executed');
    const payloadRefs = Object.fromEntries(Object.entries(draft.payload_refs).map(([at, ref]) => [at, formatRef(ref)]));
    await auditDecision(c, session, draftId, draft.command_type, 'draft.executed', decisionId, { refs: draft.based_on.map(formatRef), payloadRefs });
    return { status: 'executed', decisionId, result };
  });
}
