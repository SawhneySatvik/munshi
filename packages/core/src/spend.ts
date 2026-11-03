// The AI spend ledger's writer and its screen (22_ai_controls.sql's ai.spend). One row per model call, written
// from the run's port right after the call and before the run ends, in the context its trace is written in: the app as
// the member who started the run, or the jobs role with no actor (the brief's narrator). The cost is computed by the
// caller from its price table (core never imports the model layer); a call with no price keeps a NULL cost, which every
// screen shows as "Cannot verify", never as zero. The figures AI staff shows are cells of ai.spend_month and
// ai.spend_by_desk, minted in the page's one transaction.
import type pg from 'pg';
import { mayReadIn } from './read-roles.ts';
import { type Scope, withTx } from './session.ts';
import { type Client, mint, type StoredSnapshot } from './views-common.ts';

export type SpendCall = {
  runId: string;
  role: string;
  alias: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached?: number;
  /** null: the alias has no price, or the adapter reported no usage */
  cost: { costMinorE6: number; currency: string } | null;
};

const count = (n: number | undefined) => (Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : 0);

/** One call's spend row, in the caller's transaction (under the run's tenant). Returns its id. */
export async function recordSpendIn(c: pg.ClientBase, s: SpendCall): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into ai.spend (tenant_id, run_id, role, alias, tokens_in, tokens_out, tokens_cached, cost_minor_e6, currency)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8) returning id::text as id`,
    [s.runId, s.role, s.alias, count(s.tokensIn), count(s.tokensOut), count(s.tokensCached), s.cost?.costMinorE6 ?? null, s.cost?.currency ?? null],
  );
  return (rows[0] as { id: string }).id;
}

/** One call's spend row in its own transaction: the member's scope for a member's run, a system scope for a jobs run. */
export function recordSpend(pool: pg.Pool, scope: Scope, s: SpendCall): Promise<string> {
  return withTx(pool, scope, (c) => recordSpendIn(c, s));
}

export type SpendView = { month: StoredSnapshot; desks: StoredSnapshot };

/**
 * Home's budget banner: the state cell of a minted ai.spend_month ('soft' or 'hard'), for a member whose role may
 * read it; null otherwise, or while under. In the page's transaction.
 */
export async function spendBanner(c: Client): Promise<'soft' | 'hard' | null> {
  if (!(await mayReadIn(c, 'ai.spend_month'))) return null;
  const cell = (await mint(c, 'ai.spend_month', {})).rows[0]?.state;
  const state = cell?.kind === 'text' ? cell.txt : null;
  return state === 'soft' || state === 'hard' ? state : null;
}

/** AI staff's spend: this month against the budget, and by desk and alias, both minted in the page's transaction. */
export async function viewAiSpend(c: Client): Promise<SpendView> {
  return { month: await mint(c, 'ai.spend_month', {}), desks: await mint(c, 'ai.spend_by_desk', {}) };
}
