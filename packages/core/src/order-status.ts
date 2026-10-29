// The order status page's read (GET /sites/{slug}/orders/{code}, contracts' OrderStatus): step labels and times only,
// no person, no amount. The code is the capability: the public role reads a request, an order or its steps only under
// the code this transaction sets (munshi.order_code; order_code_public in 21), so it can never list codes. A code that
// names nothing in the tenant answers null, as a malformed one does (the route then answers 404 either way).
import type pg from 'pg';
import { withTx } from './session.ts';

export type OrderStatusView = {
  code: string;
  request: 'received' | 'confirmed' | 'declined' | 'expired';
  current: string | null;
  steps: { step: string; at: string }[];
};

const CODE = /^ORD-[A-Z0-9]{4,6}$/;
const REQUEST: Record<string, OrderStatusView['request']> = { new: 'received', drafted: 'received', confirmed: 'confirmed', declined: 'declined', expired: 'expired' };

export async function orderStatus(pub: pg.Pool, tenantId: string, code: string): Promise<OrderStatusView | null> {
  if (!CODE.test(code)) return null;
  return withTx(pub, { kind: 'system', tenantId }, async (c) => {
    await c.query(`select set_config('munshi.order_code', $1, true)`, [code]);
    const { rows: requests } = await c.query<{ state: string }>('select state from ops.order_request where code = $1', [code]);
    const { rows: steps } = await c.query<{ step: string; at: Date }>(
      `select st.step, st.at from books.order o join books.order_step st on st.tenant_id = o.tenant_id and st.order_id = o.id
        where o.code = $1 and o.reverses_id is null order by st.step_no`,
      [code],
    );
    const request = requests[0];
    if (!request && steps.length === 0) return null;
    return {
      code,
      // A phone order has no request: it entered the books confirmed.
      request: request ? (REQUEST[request.state] ?? 'received') : 'confirmed',
      // A reschedule moves dates, not the order: the current step is the latest other one.
      current: steps.findLast((s) => s.step !== 'rescheduled')?.step ?? null,
      steps: steps.map((s) => ({ step: s.step, at: s.at.toISOString() })),
    };
  });
}
