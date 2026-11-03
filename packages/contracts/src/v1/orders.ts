// POST /sites/{slug}/orders and GET /sites/{slug}/orders/{code}. The request is ops and holds no personal data
// (ops.order_request); its lines are priced from the latest release's cells with the counter's line function and no
// offer discount: an offer code travels as text, "to be checked at the shop". The order itself enters the books only
// when a person confirms it.
import { z } from 'zod';
import { DerivedMoney, Id, MoneyFigure, OfferCode, OrderCode, Slug, Timestamp } from './common.ts';
import { QtyMilli } from './lib.ts';

export const OrderLineInput = z.strictObject({ itemId: Id, qtyMilli: QtyMilli });
export const OrderBody = z.strictObject({
  // ops.order_request.shop_id is not null, and its channel is site or widget for a release-priced cart.
  shopId: Id,
  channel: z.enum(['site', 'widget']),
  lines: z.array(OrderLineInput).min(1).max(20),
  offerCode: OfferCode.optional(),
});
// The caller's own quantity, echoed and labelled as theirs: the one number in a response that is no cell.
export const RequestedQty = z.strictObject({ qtyMilli: QtyMilli, source: z.literal('request') });
export const OrderLine = z.strictObject({ itemId: Id, qty: RequestedQty, price: MoneyFigure, amount: DerivedMoney });
export const OrderCreated = z.strictObject({
  code: OrderCode,
  lines: z.array(OrderLine).min(1).max(20),
  total: DerivedMoney,
  offerCode: OfferCode.nullable(),
  // Composed by code from the figures above ("… at today's prices · the shop confirms"), never by a model.
  message: z.string().min(1).max(4000),
  // null when the shop has no public WhatsApp number
  waLink: z.string().regex(/^https:\/\/wa\.me\/[0-9]{8,15}\?text=[^\s]{1,8000}$/).nullable(),
});

// The code is the capability: a bad or malformed one answers 404, compared timing-safe, never logged, so a code cannot
// be guessed by its answers.
export const OrderStatusParams = z.strictObject({ slug: Slug, code: OrderCode });
export const OrderStep = z.enum([
  'confirmed',
  'packed',
  'cutting',
  'stitching',
  'trial',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'rescheduled',
]);
// Step labels and times only: no personal data, no amount.
export const OrderStatus = z.strictObject({
  code: OrderCode,
  // ops.order_request.state, with new and drafted both shown as received
  request: z.enum(['received', 'confirmed', 'declined', 'expired']),
  current: OrderStep.nullable(),
  steps: z.array(z.strictObject({ step: OrderStep, at: Timestamp })).max(100),
});
