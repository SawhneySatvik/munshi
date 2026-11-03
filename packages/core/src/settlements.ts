// Settlement reconciliation: a payment provider's settlement statement — our own synthetic, gateway-style CSV
// or XLSX, never a real provider's format — read on the server, previewed against the books, and recorded by an owner
// or manager as one direct command, settlement.import. The statement's rows arrive as the file's own strings (the web
// action reads the uploaded bytes and hashes them); every amount is parsed here, exactly, to paise, and the net is
// re-derived as gross less fees: a total the browser or the file claims is never taken. Each new SETTLED line becomes
// one books.settlement (settlement.record's rows, with its UTR) in the import's one transaction, each with its own
// audit row and journal entry; the file is kept by its sha256 (ops.import_file), so the same file records nothing a
// second time, and a line whose UTR or day is already recorded is skipped. ON_HOLD lines are shown, never recorded.
import { z } from 'zod';
import { type CommandResult, type Ctx, type Def, parsed } from './commands.ts';
import { writeSettlement } from './commands-trade.ts';
import { CoreError } from './errors.ts';
import type { Cell } from './read.ts';
import { mayReadIn } from './read-roles.ts';
import type { Session } from './session.ts';
import { addDays } from './time.ts';
import { type Client, mint, read, type StoredSnapshot } from './views-common.ts';
import { viewFloor } from './views-counter.ts';

export const STATEMENT_HEADER = ['settlement_date', 'txn_date', 'channel', 'gross_amount', 'fees', 'net_amount', 'utr', 'status'] as const;
export const STATEMENT_MAX_LINES = 5000;

export type StatementLine = {
  line: number; // the file's line (the header is line 1)
  settlementDate: string;
  txnDate: string;
  channel: 'upi' | 'card';
  grossMinor: number;
  feesMinor: number;
  netMinor: number;
  utr: string;
  status: 'SETTLED' | 'ON_HOLD';
};
export type StatementError = { line: number; field: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RUPEES = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const UTR = /^[A-Za-z0-9-]{1,64}$/;
const isDay = (s: string) => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
// Rupees with at most two decimals to paise, by digits alone (no float ever holds the amount).
function paise(s: string): number | null {
  const m = RUPEES.exec(s);
  return m ? Number(m[1]) * 100 + Number(`${m[2] ?? ''}00`.slice(0, 2)) : null;
}

/** A statement's rows (the file's strings, row 0 the header) as lines and the refused lines, each with its field. */
export function parseStatement(rows: string[][]): { lines: StatementLine[]; errors: StatementError[] } {
  const errors: StatementError[] = [];
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  if (header.length !== STATEMENT_HEADER.length || STATEMENT_HEADER.some((h, i) => header[i] !== h)) return { lines: [], errors: [{ line: 1, field: 'header' }] };
  const lines: StatementLine[] = [];
  const seenUtr = new Map<string, number>();
  const seenDay = new Map<string, number>();
  for (const [i, raw] of rows.entries()) {
    if (i === 0 || raw.every((v) => v.trim() === '')) continue;
    const line = i + 1;
    const [settlementDate, txnDate, channel, gross, fees, net, utr, status] = raw.map((v) => v.trim());
    const bad = (field: string) => errors.push({ line, field });
    if (raw.length !== STATEMENT_HEADER.length) {
      bad('columns');
      continue;
    }
    const g = paise(gross ?? '');
    const f = paise(fees ?? '');
    const n = paise(net ?? '');
    if (!isDay(settlementDate ?? '')) bad('settlement_date');
    else if (!isDay(txnDate ?? '')) bad('txn_date');
    else if ((settlementDate as string) < (txnDate as string)) bad('settlement_date');
    else if (channel !== 'UPI' && channel !== 'CARD') bad('channel');
    else if (g === null) bad('gross_amount');
    else if (f === null || f > g) bad('fees');
    else if (n === null || n !== g - f || n === 0) bad('net_amount');
    else if (!UTR.test(utr ?? '')) bad('utr');
    else if (status !== 'SETTLED' && status !== 'ON_HOLD') bad('status');
    else if (seenUtr.has(utr as string)) bad('utr');
    else {
      const l: StatementLine = {
        line,
        settlementDate: settlementDate as string,
        txnDate: txnDate as string,
        channel: channel === 'UPI' ? 'upi' : 'card',
        grossMinor: g,
        feesMinor: f,
        netMinor: n,
        utr: utr as string,
        status,
      };
      // The books hold one live payout per channel and day (books.settlement's b_one_live), so a statement may settle a
      // day once.
      const dayKey = `${l.channel} ${l.txnDate}`;
      if (l.status === 'SETTLED' && seenDay.has(dayKey)) {
        bad('txn_date');
        continue;
      }
      seenUtr.set(l.utr, line);
      if (l.status === 'SETTLED') seenDay.set(dayKey, line);
      lines.push(l);
    }
  }
  if (lines.length === 0 && errors.length === 0) errors.push({ line: 1, field: 'empty' });
  if (lines.length > STATEMENT_MAX_LINES) errors.push({ line: STATEMENT_MAX_LINES + 2, field: 'too_many' });
  return { lines, errors };
}

export const statementInput = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.array(z.array(z.string().max(100)).max(20)).min(1).max(STATEMENT_MAX_LINES + 1),
});
export type StatementInput = z.input<typeof statementInput>;

// The payouts the books already hold for these lines: a live one for the line's channel and day, or the line's UTR.
async function recorded(c: Client, lines: StatementLine[], readOnly = false): Promise<Set<number>> {
  const run = (sql: string, values: unknown[]) => (readOnly ? read<{ line: number }>(c, sql, values) : c.query<{ line: number }>(sql, values).then((r) => r.rows));
  const rows = await run(
    `select l.line from unnest($1::int[], $2::text[], $3::date[], $4::text[]) as l(line, channel, day, utr)
      where exists (select 1 from books.settlement s where s.utr = l.utr)
         or exists (select 1 from books.settlement s
                     where s.channel = l.channel and s.business_date = l.day and s.reverses_id is null
                       and not exists (select 1 from books.settlement x where x.tenant_id = s.tenant_id and x.reverses_id = s.id))`,
    [lines.map((l) => l.line), lines.map((l) => l.channel), lines.map((l) => l.txnDate), lines.map((l) => l.utr)],
  );
  return new Set(rows.map((r) => r.line));
}

export const SETTLEMENT_COMMANDS: [string, Def][] = [
  [
    'settlement.import',
    {
      input: statementInput,
      run: (async (ctx: Ctx, i: z.output<typeof statementInput>): Promise<CommandResult> => {
        const { lines, errors } = parseStatement(i.rows);
        if (errors.length) throw new CoreError('invalid', { fields: errors.map((e) => `line ${e.line}: ${e.field}`) });
        const { rows: seen } = await ctx.c.query<{ id: string }>('select id::text from ops.import_file where sha256 = $1', [i.sha256]);
        if (seen[0]) return { importId: seen[0].id };
        const { rows: made } = await ctx.c.query<{ id: string }>('insert into ops.import_file (tenant_id, sha256, rows) values ($1, $2, $3) returning id::text', [
          ctx.t.tenantId,
          i.sha256,
          lines.length,
        ]);
        const done = await recorded(ctx.c, lines);
        for (const l of lines) {
          if (l.status !== 'SETTLED' || done.has(l.line)) continue;
          await writeSettlement(ctx, { channel: l.channel, businessDate: l.txnDate, amountMinor: l.netMinor, reference: l.utr, receivedOn: l.settlementDate }, l.utr);
        }
        return { importId: (made[0] as { id: string }).id };
      }) as Def['run'],
    },
  ],
];

export type PreviewVerdict = 'matched' | 'short' | 'over' | 'already_recorded';
export type PreviewLine = StatementLine & {
  verdict: PreviewVerdict;
  // the books' side: the reconcile snapshot's row for the line's channel and day (null: no receipts, no payout)
  row: number | null;
};
export type StatementPreview = {
  alreadyImported: boolean;
  errors: StatementError[];
  lines: PreviewLine[];
  // the reconcile snapshot's rows for days in the statement's range with receipts, no line and no payout
  missing: number[];
  reconcile: StoredSnapshot | null;
};

const num = (cell: Cell | undefined) => (cell?.kind === 'money' ? Number(cell.num) : null);
const txt = (cell: Cell | undefined) => (cell?.kind === 'text' ? cell.txt : cell?.kind === 'date' ? cell.day : null);

/**
 * A statement against the books, in the page's transaction as the signed-in member, writing nothing but the reconcile
 * snapshot it mints: each well-formed line with its verdict and its row of that snapshot (the books' cells for its day),
 * the refused lines with their line numbers, and the days the statement leaves out. A malformed line never stops the
 * rest from previewing.
 */
export async function previewStatement(c: Client, input: StatementInput): Promise<StatementPreview> {
  const i = parsed(statementInput, input);
  const { lines, errors } = parseStatement(i.rows);
  const seen = await read(c, 'select 1 from ops.import_file where sha256 = $1', [i.sha256]);
  if (!lines.length) return { alreadyImported: seen.length > 0, errors, lines: [], missing: [], reconcile: null };
  const days = lines.map((l) => l.txnDate).sort();
  const from = days[0] as string;
  const span = 61 * 86_400_000; // the read's widest range; a longer statement previews its first 62 days' books
  const last = days[days.length - 1] as string;
  const to = Date.parse(last) - Date.parse(from) > span ? new Date(Date.parse(from) + span).toISOString().slice(0, 10) : last;
  const reconcile = await mint(c, 'settlements.reconcile', { from, to });
  const done = await recorded(c, lines, true);
  const rowOf = new Map(reconcile.rows.map((r, n) => [`${txt(r.channel)} ${txt(r.business_date)}`, n]));
  const previewed = lines.map((l): PreviewLine => {
    const n = rowOf.get(`${l.channel} ${l.txnDate}`);
    const got = n === undefined ? 0 : (num(reconcile.rows[n]?.receipts) ?? 0);
    const verdict = done.has(l.line) ? 'already_recorded' : l.netMinor === got ? 'matched' : l.netMinor < got ? 'short' : 'over';
    return { ...l, verdict, row: n ?? null };
  });
  const listed = new Set(lines.map((l) => `${l.channel} ${l.txnDate}`));
  const missing = reconcile.rows.flatMap((r, n) =>
    !listed.has(`${txt(r.channel)} ${txt(r.business_date)}`) && txt(r.verdict) === 'missing' && (num(r.receipts) ?? 0) > 0 ? [n] : [],
  );
  return { alreadyImported: seen.length > 0, errors, lines: previewed, missing, reconcile };
}

/** The settlements page: the floor, and the last 30 business days' receipts and payouts (settlements.reconcile). Null
 * for a role the page is not for (read-roles.ts, D-082). */
export async function viewSettlements(c: Client, session: Session) {
  if (!(await mayReadIn(c, 'settlements.reconcile'))) return null;
  const floor = await viewFloor(c, session);
  const reconcile = await mint(c, 'settlements.reconcile', { from: addDays(floor.today, -30), to: addDays(floor.today, -1) });
  return { ...floor, reconcile };
}
