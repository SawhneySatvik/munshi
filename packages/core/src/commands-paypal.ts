// PayPal's two draft-only commands (D-079, sandbox). Neither calls PayPal nor writes a book row: each changes the ops
// outbox row (ops.paypal_link) in its decision's transaction, under the approver, and the jobs role's sweep
// (jobs-paypal.ts) talks to PayPal afterwards.
//   paypal.request: a link for what a customer owes, its amount the cited cell (the customer's current credit.balance,
//     or an invoice's sale's open credit, invoice.open_credit), never a typed number. At most one live link per customer:
//     refused at proposal and stale at approval while one is queued, sent and unpaid, or being cancelled.
//   paypal.cancel: closes a link whose debt was settled another way (queued: cancelled at once; sent: PayPal cancels it).
// The rest of PayPal (proposals, the webhook's store, the page's read) is payments-paypal.ts. `one` from commands.ts is
// used only inside a run, so this value import is safe while commands.ts spreads PAYPAL_COMMANDS.
import type pg from 'pg';
import { z } from 'zod';
import { type CommandResult, type Ctx, type Def, one } from './commands.ts';
import { CoreError } from './errors.ts';
import { type CellRef, formatRef, parseRef, resolveRef } from './read.ts';

const id = z.guid();
const ref = z.string().refine((s) => parseRef(s) !== null);
// The figure is a ref to the cell the amount is: a string, so the payload holds no number (and no typed amount).
const paypalRequest = z.discriminatedUnion('purpose', [
  z.strictObject({ purpose: z.literal('credit'), customerId: id, figure: ref }),
  z.strictObject({ purpose: z.literal('invoice'), invoiceId: id, customerId: id, figure: ref }),
]);
type PaypalRequest = z.output<typeof paypalRequest>;
const paypalCancel = z.strictObject({ linkId: id });

// The cell a purpose's figure must be: the customer's current balance, or the invoice's sale's open credit.
const FIGURE = {
  credit: { query: 'credit.balance', param: 'customer_id', col: 'balance' },
  invoice: { query: 'invoice.open_credit', param: 'invoice_id', col: 'open' },
};

/** A link still live for the customer: queued, sent with no payment PayPal reported, or being cancelled. */
export const LIVE_LINK = `(l.status in ('queued', 'cancel_queued')
   or (l.status = 'sent' and not exists (select 1 from ops.payment_event e where e.tenant_id = l.tenant_id and e.link_id = l.id)))`;

/** One customer's PayPal debts, one at a time: the lock every proposal, approval and cancel of their links takes. */
export async function lockDebt(c: pg.PoolClient, customerId: string): Promise<void> {
  await c.query(`select pg_advisory_xact_lock(hashtextextended('munshi.paypal:' || current_setting('munshi.tenant_id', true) || ':' || $1, 0))`, [customerId]);
}

/** Whether the customer has a live link, or a paypal.request draft waiting other than the one citing `basedOn`. */
export async function debtBusy(c: pg.PoolClient, customerId: string, basedOn?: CellRef[]): Promise<boolean> {
  const { rows } = await c.query(
    `select 1 from ops.paypal_link l where l.customer_id = $1 and ${LIVE_LINK}
     union all
     select 1 from approval.draft d
      where d.command = 'paypal.request' and d.status = 'proposed' and d.payload ->> 'customerId' = $1::text
        and ($2::jsonb is null or d.based_on <> $2::jsonb)`,
    [customerId, basedOn ? JSON.stringify(basedOn) : null],
  );
  return rows.length > 0;
}

const text = (cell: Awaited<ReturnType<typeof resolveRef>>) => (cell?.kind === 'text' ? cell.txt : null);

// The draft's own rules, at proposal and again at approval (each under the customer's lock): the figure is the
// purpose's cell for this customer or invoice, cited in basedOn, and holds a positive amount; an invoice's figure is its
// own sale's open credit, for that sale's customer, on a sale not reversed and an invoice that is no credit note; and
// the customer has no other live link or waiting link draft.
async function checkRequest(c: pg.PoolClient, payload: unknown, _refs: Record<string, CellRef>, basedOn: CellRef[]): Promise<string[]> {
  const p = payload as PaypalRequest;
  const want = FIGURE[p.purpose];
  const figure = parseRef(p.figure) as CellRef;
  const { rows } = await c.query<{ query_name: string; params: Record<string, unknown> }>('select query_name, params from snap.snapshot where id = $1', [
    figure.snapshotId,
  ]);
  const target = p.purpose === 'credit' ? p.customerId : p.invoiceId;
  const cell = await resolveRef(c, figure);
  const bad: string[] = [];
  if (
    !basedOn.some((r) => formatRef(r) === p.figure) ||
    rows[0]?.query_name !== want.query ||
    rows[0].params[want.param] !== target ||
    figure.col !== want.col ||
    figure.row !== 0 ||
    cell?.kind !== 'money' ||
    BigInt(cell.num) <= 0n
  )
    bad.push('figure');
  if (p.purpose === 'invoice') {
    const at = (col: string) => resolveRef(c, { ...figure, col });
    if (text(await at('customer_id')) !== p.customerId) bad.push('customerId');
    if (text(await at('sale_reversed')) !== 'no' || text(await at('kind')) === 'credit_note') bad.push('invoiceId');
  }
  await lockDebt(c, p.customerId);
  if (await debtBusy(c, p.customerId, basedOn)) bad.push('customerId');
  return [...new Set(bad)];
}

// A cancel names a link of this shop that is queued, or sent with no payment PayPal reported.
async function checkCancel(c: pg.PoolClient, payload: unknown): Promise<string[]> {
  const p = payload as z.output<typeof paypalCancel>;
  const { rows } = await c.query<{ customer_id: string }>(
    `select l.customer_id::text from ops.paypal_link l where l.id = $1 and l.status in ('queued', 'sent') and ${LIVE_LINK}`,
    [p.linkId],
  );
  if (!rows[0]) return ['linkId'];
  await lockDebt(c, rows[0].customer_id);
  return [];
}

// The decision being executed (decide() set it for this transaction).
const decision = (c: pg.PoolClient) =>
  one<{ id: string; draft_id: string; decided_by: string }>(
    c,
    `select id::text, draft_id::text, decided_by::text from approval.decision where id = nullif(current_setting('munshi.decision_id', true), '')::uuid`,
    [],
  );

export const PAYPAL_COMMANDS: [string, Def][] = [
  [
    'paypal.request',
    {
      input: paypalRequest,
      draftOnly: true,
      checks: checkRequest,
      run: (async (ctx: Ctx, i: PaypalRequest): Promise<CommandResult> => {
        const cell = await resolveRef(ctx.c, i.figure);
        if (cell?.kind !== 'money') throw new CoreError('invalid', { fields: ['figure'] });
        // The link is the draft's, made by its approver; the draft's id is PayPal's request id. The guard checks it all.
        const d = await decision(ctx.c);
        const made = await one<{ id: string }>(
          ctx.c,
          `insert into ops.paypal_link (tenant_id, draft_id, decision_id, purpose, customer_id, invoice_id, amount_minor, currency, figure, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id::text`,
          [ctx.t.tenantId, d.draft_id, d.id, i.purpose, i.customerId, i.purpose === 'invoice' ? i.invoiceId : null, cell.num, cell.currency, i.figure, d.decided_by],
        );
        return { linkId: made.id };
      }) as Def['run'],
    },
  ],
  [
    'paypal.cancel',
    {
      input: paypalCancel,
      draftOnly: true,
      checks: checkCancel,
      run: (async (ctx: Ctx, i: z.output<typeof paypalCancel>): Promise<CommandResult> => {
        // A queued link never reached PayPal: cancelled now. A sent one is cancelled at PayPal by the sweep.
        const r = await ctx.c.query(
          `update ops.paypal_link set status = case when status = 'queued' then 'cancelled' else 'cancel_queued' end
            where id = $1 and status in ('queued', 'sent')`,
          [i.linkId],
        );
        if (r.rowCount !== 1) throw new CoreError('conflict', { fields: ['linkId'] });
        return { linkId: i.linkId };
      }) as Def['run'],
    },
  ],
];
