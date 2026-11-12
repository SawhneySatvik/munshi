// The PayPal link sweep: how a link an approval queued reaches PayPal, and how an approved cancel closes one.
// The approval's transaction never calls PayPal; it changes ops.paypal_link (commands-paypal.ts). Here the jobs role,
// under one shop's context with no actor, claims the due links (FOR UPDATE SKIP LOCKED, so two sweeps never take the
// same link) and, each in its own savepoint, asks the wired PayPal adapter:
//   queued        → create the invoice with the draft's id as the request id (PayPal-Request-Id, and the invoice number
//                   derived from it, so a retried sweep finds the invoice PayPal already holds), then record PayPal's id,
//                   the payer page and sent, and route PayPal's id to this shop (ops.paypal_route, for the webhook);
//   cancel_queued → cancel the invoice at PayPal, then cancelled.
// A failure (PayPal's, or the database refusing what came back) rolls back that link's savepoint only, counts an
// attempt with the error's code, and never blocks the next link; after MAX_ATTEMPTS a link is failed (a cancel goes
// back to sent: PayPal still holds the invoice). Writes no book row. Like outbox.ts it imports only types from outside
// core (db/test/v2/core/jobs/role.test.ts scans for it).
import type { PayPal } from '@munshi/adapters/payments';
import type pg from 'pg';
import { type Job, type Removed, registerJob } from './jobs-core.ts';

// Held on globalThis, not in a module variable: a Next server loads core once per bundle (the request hook that boots
// and wires, each route, each server action), and the sweep must see the adapter boot wired in whichever copy runs it.
const slot = globalThis as typeof globalThis & { munshiWiredPaypal?: PayPal | null };

/** The deploy's PayPal adapter (recorded unless the sandbox keys are set); null unwires it and the sweep sends nothing. */
export function wirePayPal(paypal: PayPal | null): void {
  slot.munshiWiredPaypal = paypal;
}
export const wiredPayPal = (): PayPal | null => slot.munshiWiredPaypal ?? null;

export const MAX_ATTEMPTS = 5;
const BATCH = 20;

type Due = { id: string; draft_id: string; cancel_draft_id: string | null; status: 'queued' | 'cancel_queued'; paypal_id: string | null; amount_minor: string; currency: string };

const codeOf = (err: unknown) => {
  // An adapter error carries a code only (PayPalError); a database refusal its SQLSTATE; anything else `error`.
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code.toLowerCase() : 'error';
};

/** The sweep, in its caller's transaction under one shop's context, as munshi_jobs with no actor. */
export async function sweepPaypalLinks(c: pg.PoolClient): Promise<Removed> {
  const paypal = wiredPayPal();
  if (!paypal) return {};
  // Until the migrator's PayPal tables land (db/schema), there is nothing to sweep.
  const { rows: ready } = await c.query<{ ok: boolean }>(`select to_regclass('ops.paypal_link') is not null as ok`);
  if (!ready[0]?.ok) return {};
  const { rows } = await c.query<Due>(
    `select id::text, draft_id::text, cancel_draft_id::text, status, paypal_id, amount_minor::text, currency from ops.paypal_link
      where status in ('queued', 'cancel_queued') order by created_at, id limit ${BATCH} for update skip locked`,
  );
  let sent = 0;
  let cancelled = 0;
  for (const l of rows) {
    await c.query('savepoint paypal_link');
    try {
      if (l.status === 'queued') {
        const link = await paypal.createLink({ requestId: l.draft_id, amountMinor: Number(l.amount_minor), currency: l.currency, reference: l.id });
        const r = await c.query(
          `update ops.paypal_link set status = 'sent', mode = $2, paypal_id = $3, payer_url = $4, sent_at = now(), attempts = attempts + 1, error_code = null
            where id = $1 and status = 'queued'`,
          [l.id, link.mode, link.paypalId, link.payerUrl],
        );
        if (r.rowCount === 1) {
          await c.query(`insert into ops.paypal_route (paypal_id, tenant_id, link_id) values ($1, nullif(current_setting('munshi.tenant_id', true), '')::uuid, $2)`, [
            link.paypalId,
            l.id,
          ]);
          sent++;
        }
      } else {
        await paypal.cancel(l.paypal_id as string, l.cancel_draft_id as string);
        const r = await c.query(`update ops.paypal_link set status = 'cancelled', cancelled_at = now(), attempts = attempts + 1 where id = $1 and status = 'cancel_queued'`, [l.id]);
        cancelled += r.rowCount ?? 0;
      }
      await c.query('release savepoint paypal_link');
    } catch (err) {
      await c.query('rollback to savepoint paypal_link');
      await c.query(
        `update ops.paypal_link set attempts = attempts + 1, error_code = $2,
                status = case when attempts + 1 < $3 then status when status = 'queued' then 'failed' else 'sent' end
          where id = $1 and status = $4`,
        [l.id, codeOf(err), MAX_ATTEMPTS, l.status],
      );
      await c.query('release savepoint paypal_link');
    }
  }
  return { ...(sent ? { paypal_sent: sent } : {}), ...(cancelled ? { paypal_cancelled: cancelled } : {}) };
}

export const PAYPAL_JOBS: Job[] = [registerJob('paypal_links', { every: 'minute', perTenant: true, run: sweepPaypalLinks })];
