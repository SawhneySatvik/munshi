// The daily brief (BLUEPRINT §7.6, R4 N4, N8): one ai.brief a day per branch, written by the jobs role with no actor. Its
// order is the pinned brief.ranked snapshot's `rank` cells, never a list of its own. If AI is on and under its cap, the
// injected narrator (the agent's narrateBrief, through a port whose allow is core's) writes the brief's lines, one
// call for every finding the ranking holds, whatever its severity (the founder's ruling, 2 Nov); core checks every line
// again with the shared number detector and its refs against those findings' rows, and keeps the words only in erasable ops.message_text (ai.answer holds refs and the verdict, review B2). Every
// finding without a checked line shows its template, written here by code. The brief is never sent anywhere.
import type pg from 'pg';
import { featureOn } from './ai-features.ts';
import { CoreError } from './errors.ts';
import { answerRules, type Cell, type CellRef, readRow, resolveRef } from './read.ts';
import { withTx } from './session.ts';
import { mintIn } from './snapshots.ts';
import { businessDate } from './time.ts';

export type AnswerSegment = { text: string; refs: CellRef[] };
export type BriefNarration = { outcome: 'answered'; segments: AnswerSegment[]; modelCalls: number } | { outcome: 'abstained' | 'off' | 'budget' | 'failed'; modelCalls: number };
/** Narrates the brief's findings in one call, given its run, their ids in rank order, and the run's tenant and day. */
export type BriefNarrator = (runId: string, findingIds: string[], at: { tenantId: string; asOf: string }) => Promise<BriefNarration>;

// A finding's template line: fixed words per kind; ⟦1⟧ is the finding's impact cell (a kind with none has no handle).
export const BRIEF_TEMPLATES: Readonly<Record<string, string>> = {
  shrinkage: 'A shelf count came up short of the books: ⟦1⟧ at stake.',
  price_creep: "A supplier's price rose above what you usually pay.",
  expiry: 'Stock expires this week before it will sell: ⟦1⟧ at risk.',
  overdue_credit: 'Udhaar is past its due date: ⟦1⟧ overdue.',
  short_settlement: "A payout came in short of the day's receipts: ⟦1⟧ short.",
  missing_settlement: 'No payout yet for ⟦1⟧ of UPI sales on ⟦2⟧.',
  dead_stock: 'Stock has not sold in weeks: ⟦1⟧ held on the shelf.',
  unrecovered_advance: 'A staff advance is still outstanding: ⟦1⟧.',
  hold_expiring: "A held piece's hold ends within a day: ⟦1⟧.",
  regulars_lapsing: 'A regular customer has stopped coming: ⟦1⟧ a month.',
  package_expiry: 'A package lapses soon with value left: ⟦1⟧.',
  idle_stylist: 'A stylist has open hours in the next three days: ⟦1⟧ of time unbooked.',
  stylist_absent_booked: 'A stylist who is away has confirmed bookings: ⟦1⟧.',
  unbilled_booking: 'A booking went by with no sale recorded: ⟦1⟧.',
  hold_pressure: "Online holds on one stylist's day keep lapsing: ⟦1⟧ held.",
  order_unanswered: 'An order request is waiting for an answer.',
  order_late: 'An order is past its due date: ⟦1⟧.',
  advance_unapplied: 'An advance on a closed order is neither refunded nor applied: ⟦1⟧.',
  paypal_unrecorded: 'PayPal reports a payment the books do not show yet: ⟦1⟧.',
};

// A template's handles after ⟦1⟧: the finding row's other cells, in order.
const TEMPLATE_CELLS: Readonly<Record<string, string[]>> = { missing_settlement: ['business_date'] };

const sameCell = (a: CellRef, b: { snapshotId: string; row: number }) => a.snapshotId === b.snapshotId && a.row === b.row;

/**
 * An answer's words and refs (BLUEPRINT §7.8, review B2): the words go to ops.message_text, erasable, as the run's; the
 * ai.answer row keeps only the refs per segment (which it pins) and the verdict. In the caller's transaction, as the jobs
 * role with no actor or as the app with the member whose run it is.
 */
export async function recordAnswer(c: pg.ClientBase, runId: string, kind: 'ask' | 'explain' | 'brief_line' | 'copy' | 'gloss', segments: AnswerSegment[]): Promise<string> {
  const { rows: text } = await c.query<{ id: string }>(
    `insert into ops.message_text (tenant_id, body, body_sha256, author, run_id)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, '\\x00', 'run', $2) returning id`,
    [JSON.stringify(segments.map((s) => s.text)), runId],
  );
  const { rows } = await c.query<{ id: string }>(
    `insert into ai.answer (tenant_id, run_id, kind, text_id, refs, verdict)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, 'answered') returning id`,
    [runId, kind, (text[0] as { id: string }).id, JSON.stringify(segments.map((s) => s.refs))],
  );
  return (rows[0] as { id: string }).id;
}

/**
 * The member's own kept Ask answer for a run they started (what Read aloud reads back): its words, one per segment, and
 * each segment's refs; null when there is none, it was not answered, or its words are erased. In the member's page
 * transaction.
 */
export async function ownAskAnswer(c: pg.ClientBase, memberId: string, runId: string): Promise<{ words: string[]; refs: CellRef[][] } | null> {
  const { rows } = await c.query<{ refs: CellRef[][]; body: string }>(
    `select a.refs, t.body
       from ai.answer a
       join ai.run r on r.tenant_id = a.tenant_id and r.id = a.run_id
       join ops.message_text t on t.tenant_id = a.tenant_id and t.id = a.text_id
      where a.run_id = $1 and a.kind = 'ask' and a.verdict = 'answered' and r.started_by = $2 and t.erased_at is null
      order by a.created_at desc limit 1`,
    [runId, memberId],
  );
  const found = rows[0];
  return found ? { words: JSON.parse(found.body) as string[], refs: found.refs } : null;
}

type Line = { findingId: string; snapshotId: string; row: number };

// Core's own check of a narrated brief: one segment per narrated finding at most, no segment breaking a number rule, and
// every ref a cell of one of those findings' rows that resolves.
async function checked(c: pg.ClientBase, lines: Line[], segments: AnswerSegment[]): Promise<boolean> {
  if (segments.length === 0 || segments.length > lines.length) return false;
  for (const s of segments) {
    if (answerRules(s.text).length) return false;
    for (const ref of s.refs) if (!lines.some((l) => sameCell(ref, l)) || !(await resolveRef(c, ref))) return false;
  }
  return true;
}

/**
 * Writes one branch's brief for its business date (default: today in the shop's zone), as the jobs pool's system scope.
 * Returns null when that day's brief exists already. The narrator runs between the two transactions, so no model call
 * holds one open.
 */
export async function writeBrief(
  pool: pg.Pool,
  tenantId: string,
  shopId: string,
  opts: { asOf?: string; narrate?: BriefNarrator } = {},
): Promise<{ briefId: string; runId: string; rankedSnapshotId: string; answerId: string | null } | null> {
  const scope = { kind: 'system', tenantId } as const;
  const made = await withTx(pool, scope, async (c) => {
    const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');
    if (!t[0]) throw new CoreError('not_found');
    const day = opts.asOf ?? businessDate(new Date(), t[0].time_zone);
    const { rows: done } = await c.query('select 1 from ai.brief where shop_id = $1 and business_date = $2', [shopId, day]);
    if (done.length) return null;
    const { rows: run } = await c.query<{ id: string }>(
      `insert into ai.run (tenant_id, trigger, desk) values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, 'brief', 'brief') returning id`,
    );
    const runId = (run[0] as { id: string }).id;
    const ranked = await mintIn(c, 'brief.ranked', { as_of: day, shop_id: shopId }, runId);
    const narrated = ranked.rows;
    const lines: Line[] = [];
    for (const r of narrated) {
      const id = r.finding_id?.kind === 'text' ? r.finding_id.txt : '';
      const { rows: f } = await c.query<{ snapshot_id: string; snapshot_row: number }>('select snapshot_id::text, snapshot_row from ai.finding where id = $1', [id]);
      if (f[0]) lines.push({ findingId: id, snapshotId: f[0].snapshot_id, row: f[0].snapshot_row });
    }
    // Narration switched off for the shop by the operator (D-079 §8): the template lines, with no model call at all.
    return { day, runId, rankedId: ranked.id, lines, narration: await featureOn(c, 'narration') };
  });
  if (!made) return null;

  let narration: BriefNarration = { outcome: 'off', modelCalls: 0 };
  if (opts.narrate && made.narration && made.lines.length) {
    narration = await opts.narrate(
      made.runId,
      made.lines.map((l) => l.findingId),
      { tenantId, asOf: made.day },
      // A narrator that throws leaves the templates, and its run says it failed.
    ).catch((): BriefNarration => ({ outcome: 'failed', modelCalls: 0 }));
  }
  return withTx(pool, scope, async (c) => {
    // Switched off while the narrator ran: its lines are dropped, never written (the database would refuse them, MS021,
    // and the whole brief with them, so the next tick would narrate again).
    const kept =
      narration.outcome === 'answered' && (await featureOn(c, 'narration')) && (await checked(c, made.lines, narration.segments)) ? narration.segments : null;
    const answerId = kept ? await recordAnswer(c, made.runId, 'brief_line', kept) : null;
    const { rows } = await c.query<{ id: string }>(
      `insert into ai.brief (tenant_id, shop_id, business_date, run_id, ranked_snapshot_id, answer_id)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5) returning id`,
      [shopId, made.day, made.runId, made.rankedId, answerId],
    );
    const outcome = kept ? 'answered' : narration.outcome === 'answered' ? 'abstained' : narration.outcome;
    await c.query('update ai.run set ended_at = now(), outcome = $2, model_calls = $3 where id = $1', [made.runId, outcome, narration.modelCalls]);
    return { briefId: (rows[0] as { id: string }).id, runId: made.runId, rankedSnapshotId: made.rankedId, answerId };
  });
}

export type BriefLine = {
  rank: CellRef; // the order is this cell
  findingId: string;
  kind: string;
  severity: string;
  // the narrated line's words, while not erased; else the template's
  text: string;
  narrated: boolean;
  // ⟦n⟧ → these refs: a narrated line's own, a template's the finding's impact cell
  refs: CellRef[];
};

/**
 * A brief's lines in rank order, read from its pinned ranked snapshot: each finding with its narrated line (paired by
 * the finding's row its refs cite, never by position) or its template. In the caller's transaction (the app's or jobs').
 */
export async function briefLines(c: pg.ClientBase, briefId: string): Promise<BriefLine[]> {
  const { rows: b } = await c.query<{ ranked: string; refs: CellRef[][] | null; body: string | null }>(
    `select b.ranked_snapshot_id::text as ranked, a.refs, t.body
       from ai.brief b left join ai.answer a on a.tenant_id = b.tenant_id and a.id = b.answer_id
       left join ops.message_text t on t.tenant_id = a.tenant_id and t.id = a.text_id
      where b.id = $1`,
    [briefId],
  );
  const brief = b[0];
  if (!brief) throw new CoreError('not_found');
  const words = brief.body ? (JSON.parse(brief.body) as string[]) : [];
  const { rows: count } = await c.query<{ n: number }>('select row_count as n from snap.snapshot where id = $1', [brief.ranked]);
  const lines: (BriefLine & { order: number })[] = [];
  for (let i = 0; i < (count[0]?.n ?? 0); i++) {
    const row = (await readRow(c, { snapshotId: brief.ranked, row: i })) as Record<string, Cell>;
    const text = (cell: Cell | undefined) => (cell?.kind === 'text' ? cell.txt : '');
    const { rows: f } = await c.query<{ snapshot_id: string; snapshot_row: number; impact_col: string | null }>(
      'select snapshot_id::text, snapshot_row, impact_col from ai.finding where id = $1',
      [text(row.finding_id)],
    );
    const at = f[0] ? { snapshotId: f[0].snapshot_id, row: f[0].snapshot_row } : null;
    const segment = at ? (brief.refs ?? []).findIndex((refs) => refs.length > 0 && refs.every((r) => sameCell(r, at))) : -1;
    const narrated = segment >= 0 && words[segment] !== undefined;
    const kind = text(row.kind);
    lines.push({
      order: Number(row.rank?.kind === 'integer' ? row.rank.num : 0),
      rank: { snapshotId: brief.ranked, row: i, col: 'rank' },
      findingId: text(row.finding_id),
      kind,
      severity: text(row.severity),
      text: narrated ? (words[segment] as string) : (BRIEF_TEMPLATES[kind] ?? ''),
      narrated,
      refs: narrated
        ? (brief.refs?.[segment] ?? [])
        : at && f[0]?.impact_col
          ? [f[0].impact_col, ...(TEMPLATE_CELLS[kind] ?? [])].map((col) => ({ ...at, col }))
          : [],
    });
  }
  return lines.sort((x, y) => x.order - y.order).map(({ order: _, ...line }) => line);
}

