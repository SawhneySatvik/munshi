// Drafts and decisions: nothing auto-applies. A draft names a command, its payload, the snapshot cells it relied on
// (based_on) and, for every number in its payload, the cell that number came from (payload_refs). decide() runs on the
// approver's own request — the approver is the session's member, there is no other parameter for it — and in ONE
// transaction: lock the draft, re-check every cited cell (changed → `stale`, and only that is committed), insert the
// decision, execute the command under it (the guard admits and audits each book row as the approver), mark the draft
// executed, and audit the decision itself.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { refuseSwitchedOff } from './capabilities.ts';
import { type CommandResult, command, execute, parseInput } from './commands.ts';
import { CoreError } from './errors.ts';
import { type Cell, type CellRef, formatRef, parseRef, resolveRef } from './read.ts';
import { type Session, withTx } from './session.ts';
import { recheck } from './snapshots.ts';

// A member's own draft, or one for their agent run (runId): either way proposed as that member, the only shape
// approval.stamp_draft admits; a watcher's run has no member and proposes nothing.
export type Proposer = { session: Session; runId?: string };

// payloadRefs maps the path of every number in the payload (`qtyMilli`, `lines[0].qtyMilli`) to the cell holding it.
// Optional in the type only while the agent's port and the app wire it through (deprecated): absent
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

// The codes ref.reason_use allows for a decision; approval.decision's key refuses any other, and a rejection needs one.
export const REASONS = ['wrong_figure', 'duplicate', 'not_now', 'not_relevant', 'other'] as const;
export type ReasonCode = (typeof REASONS)[number];

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

// The items, customers and package holdings a payload names (an `itemId`, `customerId` or `holdingId` at any depth).
function named(v: unknown, key = ''): [string, string][] {
  if (typeof v === 'string') return key === 'itemId' || key === 'customerId' || key === 'holdingId' ? [[key, v]] : [];
  if (Array.isArray(v)) return v.flatMap((x) => named(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => named(x, k));
  return [];
}

// The undated reads of an entity's current state, and the cell a draft must cite for it. The watch.* reads stop at their
// as_of, so a write-off recorded after it would never stale a draft that cites only them (found in review: on-hand went
// 32 → 12 → −8). A stock or money draft naming neither an item nor a customer (a settlement, a supplier payment) is
// refused.
const CURRENT: Record<string, { query: string; param: string; col: string }> = {
  itemId: { query: 'stock.on_hand', param: 'item_id', col: 'on_hand' },
  customerId: { query: 'credit.balance', param: 'customer_id', col: 'balance' },
  // A package.expire draft writes a journal line and names no item or customer; a redemption after it stales it.
  holdingId: { query: 'package.balance', param: 'holding_id', col: 'value_left' },
};

// Numbers read off a photo must come from that photo's evidence: a drafted count is the counted cell of a shelf
// count, and the books' figure beside it the on-hand; a drafted bill line's figures are cells of a read bill's line. The
// cited row's item_id must be the item the number is about (the payload's itemId beside it), so a bill line that matched
// no item backs no book line. Every rule's number must be in the payload. Paths are matched with each [n] as [n]. A rule
// with `freshBy` also needs that cell of the cited row (when the count was taken) within the shop's count_max_age (6
// hours by default), at proposal and again at approval: the shelf has moved on since an older photo.
const EVIDENCE: Record<string, { at: string; query: string; col: string; freshBy?: string }[]> = {
  'stock.count': [
    { at: 'countedQtyMilli', query: 'count.shelf', col: 'counted', freshBy: 'counted_at' },
    { at: 'expectedQtyMilli', query: 'stock.on_hand', col: 'on_hand' },
  ],
  'purchase.record': [
    { at: 'lines[n].qtyMilli', query: 'bill.lines', col: 'qty' },
    { at: 'lines[n].unitCostMinor', query: 'bill.lines', col: 'unit_cost' },
  ],
};

const general = (at: string) => at.replace(/\[\d+\]/g, '[n]');

// A drafted purchase is one bill as read: its supplier, number and date are that bill's cells, its
// lines all come from one bill read, a line's quantity and cost from the same bill line, and no bill line backs two.
const BILL_HEADER: Record<string, string> = { supplierId: 'supplier_id', billNo: 'bill_no', billDate: 'bill_date' };

// The itemId of the object a number sits in (`lines[0].qtyMilli` → lines[0].itemId).
function itemBeside(payload: unknown, at: string): unknown {
  let v = payload;
  for (const k of (at.match(/[A-Za-z]\w*|\d+/g) ?? []).slice(0, -1)) v = (v as Record<string, unknown> | undefined)?.[k];
  return (v as { itemId?: unknown } | undefined)?.itemId;
}

async function offEvidence(c: pg.PoolClient, command: string, payload: unknown, numbers: [string, number][], refs: Record<string, CellRef>) {
  const rules = EVIDENCE[command] ?? [];
  const bad = rules.filter((r) => !numbers.some(([at]) => general(at) === r.at)).map((r) => r.at);
  for (const [at] of numbers) {
    const rule = rules.find((r) => r.at === general(at));
    if (!rule) continue;
    const ref = refs[at] as CellRef;
    const { rows } = await c.query<{ query_name: string }>('select query_name from snap.snapshot where id = $1', [ref.snapshotId]);
    const item = await resolveRef(c, { ...ref, col: 'item_id' });
    if (rows[0]?.query_name !== rule.query || ref.col !== rule.col || item?.kind !== 'text' || item.txt !== itemBeside(payload, at)) bad.push(at);
  }
  return [...new Set([...bad, ...(await tooOld(c, command, refs))])];
}

// The payload paths whose evidence is older than the shop allows (EVIDENCE's freshBy).
async function tooOld(c: pg.PoolClient, command: string, refs: Record<string, CellRef>): Promise<string[]> {
  const old: string[] = [];
  for (const rule of EVIDENCE[command] ?? []) {
    const ref = refs[rule.at];
    if (!rule.freshBy || !ref) continue;
    const { rows: snap } = await c.query<{ query_name: string }>('select query_name from snap.snapshot where id = $1', [ref.snapshotId]);
    if (snap[0]?.query_name !== rule.query) continue; // not this rule's evidence at all: offEvidence refuses it
    const taken = await resolveRef(c, { ...ref, col: rule.freshBy });
    const { rows } = await c.query<{ fresh: boolean }>('select $1::timestamptz >= now() - count_max_age as fresh from ops.tenant', [
      taken?.kind === 'timestamp' ? taken.at : null,
    ]);
    if (rows[0]?.fresh !== true) old.push(rule.at);
  }
  return old;
}

async function notOneBill(c: pg.PoolClient, payload: unknown, refs: Record<string, CellRef>): Promise<string[]> {
  const bad = new Set<string>();
  const lineOf = new Map<string, string>(); // payload line → bill read · bill line
  const bills = new Set<unknown>();
  for (const [at, ref] of Object.entries(refs)) {
    const n = /^lines\[(\d+)\]\./.exec(at)?.[1];
    if (n === undefined) continue;
    const { rows } = await c.query<{ params: { bill_id?: unknown } }>('select params from snap.snapshot where id = $1', [ref.snapshotId]);
    const billId = rows[0]?.params.bill_id;
    const line = await resolveRef(c, { ...ref, col: 'line_no' });
    const source = `${billId}·${line?.kind === 'integer' ? line.num : ''}`;
    bills.add(billId);
    if ((lineOf.get(n) ?? source) !== source) bad.add(`payloadRefs.${at}`);
    lineOf.set(n, source);
    for (const [field, col] of Object.entries(BILL_HEADER)) {
      const cell = await resolveRef(c, { ...ref, col });
      const value = cell?.kind === 'text' ? cell.txt : cell?.kind === 'date' ? cell.day : undefined;
      if (value !== (payload as Record<string, unknown>)[field]) bad.add(field);
    }
  }
  if (bills.size > 1 || new Set(lineOf.values()).size < lineOf.size) bad.add('lines');
  return [...bad];
}

// A bill backs one purchase: a drafted purchase.record whose bill (its supplier and number, which notOneBill
// pins to the bill as read) the books already hold live is refused at proposal and goes stale at approval, never a
// second purchase. books.purchase's b_one_live still stops two approvals racing past this check.
async function billRecorded(c: pg.PoolClient, payload: unknown): Promise<boolean> {
  const { supplierId, billNo } = payload as { supplierId: string; billNo: string };
  const { rows } = await c.query(
    `select 1 from books.purchase p where p.supplier_id = $1 and p.bill_no = $2 and p.reverses_id is null
        and not exists (select 1 from books.purchase x where x.tenant_id = p.tenant_id and x.reverses_id = p.id)`,
    [supplierId, billNo],
  );
  return rows.length > 0;
}

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
  const def = command(d.command);
  const payload = parseInput(def, d.payload); // stored normalised; re-parsed at decision time
  const numbers = numbersIn(payload);
  const unmapped = [
    ...numbers.map(([at]) => at).filter((at) => !Object.hasOwn(d.payloadRefs, at)),
    ...Object.keys(d.payloadRefs).filter((at) => !numbers.some(([n]) => n === at)),
  ];
  if (unmapped.length) throw new CoreError('invalid', { fields: unmapped.map((at) => `payloadRefs.${at}`) });
  const draftId = randomUUID();
  await withTx(pool, { kind: 'member', session: by.session }, async (c) => {
    for (const ref of d.basedOn) {
      if (!(await resolveRef(c, ref))) throw new CoreError('invalid', { fields: ['basedOn'] }); // a ref must name a stored cell
    }
    for (const [at, n] of numbers) {
      if (!holds(await resolveRef(c, d.payloadRefs[at] as CellRef), at, n)) throw new CoreError('invalid', { fields: [`payloadRefs.${at}`] });
    }
    const unbacked = await offEvidence(c, d.command, payload, numbers, d.payloadRefs);
    if (unbacked.length) throw new CoreError('invalid', { fields: unbacked.map((at) => `payloadRefs.${at}`) });
    const offBill = d.command === 'purchase.record' ? await notOneBill(c, payload, d.payloadRefs) : [];
    if (offBill.length) throw new CoreError('invalid', { fields: offBill });
    if (d.command === 'purchase.record' && (await billRecorded(c, payload))) throw new CoreError('conflict', { fields: ['billNo'] });
    // A command that moves stock or money (it writes a stock move or a journal line) must see today's books at approval,
    // unless its own checks re-verify every cell it cites (recheckedByChecks), which they do again at approval.
    const { rows: moves } = await c.query(
      `select 1 from ref.command_table where command = $1 and rel in ('books.stock_move', 'books.journal_line')`,
      [d.command],
    );
    if (moves.length && !def.recheckedByChecks) {
      const cited = [...d.basedOn, ...Object.values(d.payloadRefs)];
      const touched = named(payload);
      let current = touched.length > 0;
      for (const [key, id] of touched) current = current && (await citesCurrent(c, cited, key, id));
      if (!current) throw new CoreError('invalid', { fields: ['basedOn'] });
    }
    const badByCommand = (await def.checks?.(c, payload, d.payloadRefs, d.basedOn)) ?? [];
    if (badByCommand.length) throw new CoreError('invalid', { fields: badByCommand });
    // One reply at a time to a message: a second message.reply while one still waits for a decision is refused.
    if (d.command === 'message.reply') {
      const { rows: waiting } = await c.query(
        `select 1 from approval.draft where command = 'message.reply' and status = 'proposed' and payload->>'messageId' = $1`,
        [String((payload as { messageId?: unknown }).messageId)],
      );
      if (waiting.length) throw new CoreError('conflict', { fields: ['messageId'] });
    }
    // A run's draft is filed under the run's desk (the cast member who proposed it); a person's own has none.
    await c.query(
      `insert into approval.draft (tenant_id, id, command, payload, based_on, payload_refs, source, run_id, finding_id, desk)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8,
               (select r.desk from ai.run r where r.id = $7::uuid))`,
      [draftId, d.command, payload, JSON.stringify(d.basedOn), d.payloadRefs, by.runId ? 'run' : 'member', by.runId ?? null, d.findingId ?? null],
    );
  });
  return draftId;
}

// An ops entry carries ids and codes only (audit.audit_log refuses a number, a null or words), so a cited cell is
// written as `<snapshot>.<row>.<col>`: the chain still names the exact cells a decision relied on.
const refCode = (r: CellRef) => `${r.snapshotId}.${r.row}.${r.col}`;

async function auditDecision(c: pg.PoolClient, session: Session, draftId: string, command: string, action: string, decisionId: string | null, payload: object) {
  await c.query(
    `insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, payload)
     values ($1, $2, $3, $4, $5, 'approval.draft', $6, $7)`,
    [session.tenantId, session.memberId, decisionId, command, action, draftId, payload],
  );
}

export async function decide(
  pool: pg.Pool,
  session: Session,
  draftId: string,
  verdict: 'approved' | 'rejected',
  reason?: ReasonCode,
): Promise<Decision> {
  // A person's typed words never reach the permanent chain; the codes are ref.reason_use's for a decision, which the
  // database enforces too. Checked before any transaction opens.
  if (reason !== undefined && !REASONS.includes(reason)) throw new CoreError('invalid', { fields: ['reason'] });
  return withTx(pool, { kind: 'member', session }, async (c): Promise<Decision> => {
    const { rows } = await c.query<{ command: string; payload: unknown; based_on: CellRef[]; payload_refs: Record<string, CellRef>; status: string }>(
      'select command, payload, based_on, payload_refs, status from approval.draft where id = $1 for update',
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
      await auditDecision(c, session, draftId, draft.command, 'draft.rejected', decisionId, reason ? { reason } : {});
      return { status: 'rejected', decisionId };
    }

    const changed = await recheck(c, [...draft.based_on, ...Object.values(draft.payload_refs)]);
    for (const at of await tooOld(c, draft.command, draft.payload_refs)) changed.push(formatRef(draft.payload_refs[at] as CellRef));
    if (draft.command === 'purchase.record' && (await billRecorded(c, draft.payload))) changed.push(...Object.values(draft.payload_refs).map(formatRef));
    const d = command(draft.command);
    // The command's own rules, again: whatever held at proposal may not hold now.
    const bad = (await d.checks?.(c, draft.payload, draft.payload_refs, draft.based_on)) ?? [];
    changed.push(...bad.map((at) => (draft.payload_refs[at] ? formatRef(draft.payload_refs[at] as CellRef) : at)));
    if (changed.length) {
      await set('stale');
      const refs = changed.map(parseRef).filter((ref): ref is CellRef => ref !== null);
      await auditDecision(c, session, draftId, draft.command, 'draft.stale', null, { changed: refs.map(refCode) });
      return { status: 'stale', changed };
    }

    const input = parseInput(d, draft.payload);
    await insertDecision();
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [decisionId]);
    const result = await execute(c, d, input);
    // An approved draft keeps its rows only while the shop has the capability it starts on, as a direct command does.
    await refuseSwitchedOff(c, draft.command);
    await set('executed');
    const payloadRefs = Object.fromEntries(Object.entries(draft.payload_refs).map(([at, ref]) => [at, refCode(ref)]));
    await auditDecision(c, session, draftId, draft.command, 'draft.executed', decisionId, { refs: draft.based_on.map(refCode), payloadRefs });
    return { status: 'executed', decisionId, result };
  });
}
