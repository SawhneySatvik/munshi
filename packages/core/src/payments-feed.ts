// The payments-provider port, and the simulated feed behind it. A payments feed hands the shop its payout batches; those
// batches become a settlement statement in the shop's own format (settlements.ts STATEMENT_HEADER) and go down the same
// road a file does: previewed against the books, then recorded by an owner or manager as one command, settlement.import.
// The feed itself never writes anything and "payments are recorded, never processed" holds: nothing here moves money.
// The types are our own, not any provider's. Swapping in a real staging adapter is this file's `paymentsFeed` binding
// and one new object implementing PaymentsFeed; nothing else changes. The only feed today is simulated and says so.
import { createHash } from 'node:crypto';
import type { Cell } from './read.ts';
import type { Session } from './session.ts';
import { STATEMENT_HEADER, type StatementInput } from './settlements.ts';
import { addDays } from './time.ts';
import { type Client, mint } from './views-common.ts';
import { viewFloor } from './views-counter.ts';

/** A day's receipts as the books hold them: what a simulator pays out (a real adapter ignores them). */
export type ReceiptDay = { businessDate: string; channel: 'upi' | 'card'; receiptsMinor: number };
/** One payout the feed announces: money for one business day on one channel, gross less fees, paid on `payoutOn` or held. */
export type FeedBatch = {
  payoutOn: string;
  businessDate: string;
  channel: 'upi' | 'card';
  grossMinor: number;
  feesMinor: number;
  reference: string;
  held: boolean;
};
export interface PaymentsFeed {
  readonly label: string;
  readonly simulated: boolean;
  batches(req: { from: string; to: string; receipts: ReceiptDay[] }): Promise<FeedBatch[]>;
}

export const SIMULATED_FEED_LABEL = 'Simulated payments feed (sample)';
const CARD_FEE_BP = 150; // the simulator's card fee: 1.5% of the day's takings; UPI settles with no fee

/**
 * The simulator: a deterministic payout for every day with receipts and no payout yet, paid the next day (the latest day
 * is held), card days less their fee. The same books give the same batches, byte for byte, so a repeated fetch is the
 * same statement and records nothing twice.
 */
export const simulatedFeed: PaymentsFeed = {
  label: SIMULATED_FEED_LABEL,
  simulated: true,
  async batches({ from, to, receipts }) {
    return receipts
      .filter((r) => r.businessDate >= from && r.businessDate <= to && r.receiptsMinor > 0)
      .sort((a, b) => (a.businessDate + a.channel).localeCompare(b.businessDate + b.channel))
      .map((r) => ({
        payoutOn: addDays(r.businessDate, 1),
        businessDate: r.businessDate,
        channel: r.channel,
        grossMinor: r.receiptsMinor,
        feesMinor: r.channel === 'card' ? Math.floor((r.receiptsMinor * CARD_FEE_BP + 5000) / 10_000) : 0,
        reference: `SIMFEED-${r.channel.toUpperCase()}-${r.businessDate.replaceAll('-', '')}`,
        held: r.businessDate >= to,
      }));
  },
};

/** The feed the app uses. */
export const paymentsFeed: PaymentsFeed = simulatedFeed;

const rupees = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

/** Batches as a statement (the file's own strings), keyed by the sha256 of its rows. */
export function statementOfBatches(batches: FeedBatch[]): StatementInput {
  const rows = [
    [...STATEMENT_HEADER] as string[],
    ...batches.map((b) => [
      b.payoutOn,
      b.businessDate,
      b.channel.toUpperCase(),
      rupees(b.grossMinor),
      rupees(b.feesMinor),
      rupees(b.grossMinor - b.feesMinor),
      b.reference,
      b.held ? 'ON_HOLD' : 'SETTLED',
    ]),
  ];
  return { sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), rows };
}

const text = (c: Cell | undefined) => (c?.kind === 'text' ? c.txt : c?.kind === 'date' ? c.day : '');

/**
 * Fetch from the payments feed: the last 30 business days' receipts without a recorded payout, announced as batches and
 * returned as a statement. Read-only (it mints the reconcile snapshot); the caller previews it and a person records it.
 */
export async function fetchFeedStatement(c: Client, session: Session): Promise<{ label: string; simulated: boolean; statement: StatementInput }> {
  const floor = await viewFloor(c, session);
  const [from, to] = [addDays(floor.today, -30), addDays(floor.today, -1)];
  const reconcile = await mint(c, 'settlements.reconcile', { from, to });
  const receipts = reconcile.rows.flatMap((r): ReceiptDay[] => {
    const channel = text(r.channel);
    const got = r.receipts?.kind === 'money' ? Number(r.receipts.num) : 0;
    return text(r.verdict) === 'missing' && (channel === 'upi' || channel === 'card') ? [{ businessDate: text(r.business_date), channel, receiptsMinor: got }] : [];
  });
  const batches = await paymentsFeed.batches({ from, to, receipts });
  return { label: paymentsFeed.label, simulated: paymentsFeed.simulated, statement: statementOfBatches(batches) };
}
