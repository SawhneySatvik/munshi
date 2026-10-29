// The commands that write the books. Each has an input schema and a body that writes its rows; the body runs either as
// a person's direct command (runCommand: munshi.command set, the guard checks the member's authority in
// ref.command_authority) or inside decide() under an approved decision. Amounts are re-derived here from the books
// (prices, costs, on-hand): a caller's total is never taken. Each command's tables are its rows in ref.command_table; the
// guard refuses any other. Each area's commands live in their own file, so a lane edits only its own; the helpers they
// share live here and are used only inside a run, so those files may import them while this module is being evaluated.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { z } from 'zod';
import { refuseSwitchedOff } from './capabilities.ts';
import { BOOKING_COMMANDS } from './commands-booking.ts';
import { CATALOGUE_COMMANDS } from './commands-catalogue.ts';
import { GRID_COMMANDS } from './commands-grid.ts';
import { MESSAGING_COMMANDS } from './commands-messaging.ts';
import { OFFER_COMMANDS } from './commands-offers.ts';
import { ORDER_COMMANDS } from './commands-orders.ts';
import { PACKAGE_COMMANDS } from './commands-packages.ts';
import { PEOPLE_COMMANDS } from './commands-people.ts';
import type { SaleInput } from './commands-sale.ts';
import { SALE_COMMANDS } from './commands-sale.ts';
import { STAFF_COMMANDS } from './commands-staff.ts';
import type { CountInput, CreditInput, PaymentInput, PurchaseInput, ReorderInput, SettlementInput, WasteInput } from './commands-trade.ts';
import { TRADE_COMMANDS } from './commands-trade.ts';
import { CoreError } from './errors.ts';
import { claimKey, IDEMPOTENCY_KEY } from './idempotency.ts';
import type { CellRef } from './read.ts';
import { type Session, withTx } from './session.ts';

export type { SaleInput } from './commands-sale.ts';
export { type PaymentInput, type PhotoRun, type PurchaseInput, recordBillRead, recordShelfCount } from './commands-trade.ts';

// Chart of accounts (ref.account). Debits positive, credits negative.
export const ACCOUNTS = {
  cash: 'cash',
  upi: 'upi_clearing',
  card: 'card_clearing',
  bank: 'bank',
  receivable: 'receivable',
  payable: 'payable',
  inventory: 'inventory',
  sales: 'sales',
  openingEquity: 'opening_equity',
} as const;

export const CREDIT_DAYS = 30; // udhaar is due this many days after it is given

type Tenant = { tenantId: string; currency: string; timeZone: string; name: string };
export type Ctx = { c: pg.PoolClient; t: Tenant };
// What a command returns: the ids of the rows it wrote (null for a row it had no need to write), never a number. A
// number to show is minted as a snapshot cell from the books; a total in a result would be a number with no cell behind
// it. The type refuses a number at compile time and execute() refuses one at run time.
export type CommandResult = Readonly<Record<string, string | null>>;
// checks: a draft's own rules, beyond the generic ones in approvals.ts. It returns the payload paths that are bad; at
// proposal any bad path refuses the draft, and at approval any makes it stale. draftOnly: the command runs only as an
// approved draft's execution; runCommand refuses it, so a direct call cannot skip its checks (ref.command marks it too).
// recheckedByChecks: its checks re-verify every cell the draft cites, so proposeDraft skips the generic current-state
// rule for stock and money (salary.run, whose payload names no item or customer).
export type Checks = (c: pg.PoolClient, payload: unknown, refs: Record<string, CellRef>, basedOn: CellRef[]) => Promise<string[]>;
export type Def = {
  input: z.ZodType;
  run: (ctx: Ctx, input: never) => Promise<CommandResult>;
  checks?: Checks;
  draftOnly?: true;
  recheckedByChecks?: true;
};

export const at = (s: string | undefined) => (s ? new Date(s) : new Date());
export const methodAccount = (m: 'cash' | 'upi' | 'card' | 'bank') =>
  m === 'cash' ? ACCOUNTS.cash : m === 'upi' ? ACCOUNTS.upi : m === 'card' ? ACCOUNTS.card : ACCOUNTS.bank;

// One spelling rule for the catalogue and a bill's text: NFKC, trimmed, inner whitespace collapsed, lower case.
export const normalName = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export async function one<T>(c: pg.PoolClient, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await c.query(sql, values);
  if (!rows[0]) throw new CoreError('not_found');
  return rows[0] as T;
}

// A balanced entry: lines with a zero amount are dropped (journal_line refuses them), equal accounts merged. memoCode is
// a code (journal_entry refuses words); source names the book row that caused it.
export async function journal(ctx: Ctx, entryDate: string, memoCode: string, source: [string, string], lines: [string, number][]) {
  const merged = new Map<string, number>();
  for (const [account, amount] of lines) merged.set(account, (merged.get(account) ?? 0) + amount);
  const kept = [...merged].filter(([, a]) => a !== 0);
  if (kept.length === 0) return undefined;
  const entryId = randomUUID();
  await ctx.c.query(
    `insert into books.journal_entry (tenant_id, id, entry_date, memo_code, source_rel, source_id) values ($1, $2, $3, $4, $5, $6)`,
    [ctx.t.tenantId, entryId, entryDate, memoCode, source[0], source[1]],
  );
  await ctx.c.query(
    `insert into books.journal_line (tenant_id, entry_id, account, amount_minor, currency)
     select $1, $2, l.account, l.amount, $3 from unnest($4::text[], $5::bigint[]) as l(account, amount)`,
    [ctx.t.tenantId, entryId, ctx.t.currency, kept.map((l) => l[0]), kept.map((l) => l[1])],
  );
  return entryId;
}

// A stock-reducing command may not take the books below zero: checked at execution, after the move, over every move of
// the item. The per-item lock is taken before the books are read, so two write-offs of the same item cannot both pass
// on the same on-hand. Counter sales do not take it: a shop may sell what it has not yet entered.
export async function lockStock(ctx: Ctx, itemId: string) {
  await ctx.c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.stock:' || $1 || ':' || $2, 0))`, [ctx.t.tenantId, itemId]);
}

export async function keepsStock(ctx: Ctx, itemId: string, field: string) {
  const { held } = await one<{ held: string }>(ctx.c, 'select coalesce(sum(qty_milli), 0) as held from books.stock_move where item_id = $1', [itemId]);
  if (Number(held) < 0) throw new CoreError('invalid', { fields: [field] });
}

export const COMMANDS: ReadonlyMap<string, Def> = new Map<string, Def>([
  ...CATALOGUE_COMMANDS,
  ...PEOPLE_COMMANDS,
  ...SALE_COMMANDS,
  ...TRADE_COMMANDS,
  ...ORDER_COMMANDS,
  ...PACKAGE_COMMANDS,
  ...MESSAGING_COMMANDS,
  ...GRID_COMMANDS,
  ...OFFER_COMMANDS,
  ...STAFF_COMMANDS,
  ...BOOKING_COMMANDS,
]);

export function parsed<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

export function command(name: string): Def {
  const d = COMMANDS.get(name);
  if (!d) throw new CoreError('invalid', { fields: ['command'] });
  return d;
}

export function parseInput(d: Def, input: unknown): unknown {
  return parsed(d.input, input);
}

// Runs a parsed input in the current transaction (whose context already admits the command's rows).
export async function execute(c: pg.PoolClient, d: Def, input: unknown): Promise<CommandResult> {
  const { rows } = await c.query<{ tenant_id: string; currency: string; time_zone: string; name: string }>(
    'select tenant_id::text as tenant_id, currency, time_zone, name from ops.tenant',
  );
  const t = rows[0];
  if (!t || rows.length !== 1) throw new CoreError('not_found');
  const result = await d.run({ c, t: { tenantId: t.tenant_id, currency: t.currency, timeZone: t.time_zone, name: t.name } }, input as never);
  if (Object.values(result).some((v) => v !== null && typeof v !== 'string')) throw new CoreError('internal'); // ids only
  return result;
}

// A person's own direct command: the guard admits the rows only if the member's role holds the command, and core keeps
// them only while the shop has the capability it starts on (refuseSwitchedOff, after the body). With an idempotency key
// (every form render and API write carries one), a replay returns the first run's ids and writes nothing.
export function runCommand(pool: pg.Pool, session: Session, name: string, input: unknown, key?: string): Promise<CommandResult> {
  const d = command(name);
  if (d.draftOnly) return Promise.reject(new CoreError('refused', { fields: ['command'] }));
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) return Promise.reject(new CoreError('invalid', { fields: ['key'] }));
  const p = parseInput(d, input);
  return withTx(pool, { kind: 'member', session, command: name }, async (c) => {
    const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, name, p);
    if (claim && 'replay' in claim) return claim.replay;
    const result = await execute(c, d, p);
    await refuseSwitchedOff(c, name);
    await claim?.fill(result);
    return result;
  });
}

export const recordSale = (pool: pg.Pool, session: Session, input: SaleInput) => runCommand(pool, session, 'sale.record', input);
export const recordPurchase = (pool: pg.Pool, session: Session, input: PurchaseInput) => runCommand(pool, session, 'purchase.record', input);
export const countStock = (pool: pg.Pool, session: Session, input: CountInput) => runCommand(pool, session, 'stock.count', input);
export const recordWaste = (pool: pg.Pool, session: Session, input: WasteInput) => runCommand(pool, session, 'stock.waste', input);
export const recordCredit = (pool: pg.Pool, session: Session, input: CreditInput) => runCommand(pool, session, 'credit.record', input);
export const recordPayment = (pool: pg.Pool, session: Session, input: PaymentInput) => runCommand(pool, session, 'payment.record', input);
export const recordSettlement = (pool: pg.Pool, session: Session, input: SettlementInput) => runCommand(pool, session, 'settlement.record', input);
export const placeReorder = (pool: pg.Pool, session: Session, input: ReorderInput) => runCommand(pool, session, 'reorder.place', input);
