// Red-proofs of core's commands on v2 (test/v2/core/{commands,current}): each breaks one protection of
// packages/core/src/commands*.ts, idempotency or session.ts, and its named test must fail. The v1 cases they succeed keep
// their mutation and their name, with a v2- prefix.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const c1 = 'test/v2/core/commands/c1-commands.test.ts';
const c2 = 'test/v2/core/commands/c2-errors.test.ts';
const c7 = 'test/v2/core/current/c7-current-state.test.ts';
const idem = 'test/v2/core/commands/idempotency.test.ts';
const COMMANDS = 'packages/core/src/commands.ts';
const SALE = 'packages/core/src/commands-sale.ts';
const TRADE = 'packages/core/src/commands-trade.ts';
const SESSION = 'packages/core/src/session.ts';

const C1_RESULT = 'C1 a command result carrying a number is refused: a number to show comes from a snapshot cell';
const C7_WASTE = 'C7 a write-off cannot take on-hand below zero';
const C7_COUNT = 'C7 a count in the past cannot take on-hand below zero once the moves after it are added';
const C7_RACE = 'C7 a count waits for a write-off in flight, so it never states books that have just changed';
const IDEM1 = 'IDEM1 a replayed key returns the stored ids and writes nothing; a different request under the same key is a conflict';
const EXPECTED_CHECK =
  "if (i.expectedQtyMilli !== undefined && i.expectedQtyMilli !== Number(expected)) throw new CoreError('conflict', { fields: ['expectedQtyMilli'] });";
const COUNT_LOCK = 'const countedAt = at(i.countedAt);\n      await lockStock(ctx, i.itemId);';

const ts = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});

export const CORE_COMMANDS_CASES: Case[] = [
  // the sale's stored total drifts from its lines (z_sale_total refuses it at commit too)
  ts(
    'v2-c1-stored-total',
    c1,
    'C1 a counter sale is priced from the books, takes the rest as credit, balances and is audited under the seller',
    SALE,
    '[t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total, t.currency]',
    '[t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total + 1, t.currency]',
  ),
  ts(
    'v2-c1-overpayment',
    c1,
    'C1 a sale paying more than the books price is refused, and an unpaid rest needs a customer',
    SALE,
    "if (credit < 0) throw new CoreError('invalid', { fields: ['payments'] });",
    '',
  ),
  ts(
    'v2-c1-count-not-rederived',
    c1,
    'C1 a stock count writes the difference from the books as one adjustment, and nothing when it agrees',
    TRADE,
    'const delta = i.countedQtyMilli - Number(expected);',
    'const delta = i.countedQtyMilli;',
  ),
  ts('v2-c1-result-number', c1, C1_RESULT, COMMANDS, "if (Object.values(result).some((v) => v !== null && typeof v !== 'string')) throw new CoreError('internal');", ''),
  ts('v2-c2-raw-error', c2, 'C2 a database error reaches the caller as a code, never with row values', SESSION, 'throw toCoreError(err);', 'throw err;'),
  // h1's case on the same mutation is SPINE-R's (h1-shelf-count); the two entries carry the one mutation
  ts('v2-c7-expected-unchecked', c7, C7_RACE, TRADE, EXPECTED_CHECK, ''),
  ts('v2-c7-waste-below-zero', c7, C7_WASTE, TRADE, "await keepsStock(ctx, i.itemId, 'qtyMilli');", ''),
  ts('v2-c7-count-below-zero', c7, C7_COUNT, TRADE, "if (delta < 0) await keepsStock(ctx, i.itemId, 'countedQtyMilli');", ''),
  ts('v2-c7-count-unlocked', c7, C7_RACE, TRADE, COUNT_LOCK, 'const countedAt = at(i.countedAt);'),
  // IDEM1 (new): the key is never claimed, so a replay records a second sale
  ts('v2-idem-skip-claim', idem, IDEM1, COMMANDS, 'const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, name, p);', 'const claim = undefined;'),
];
