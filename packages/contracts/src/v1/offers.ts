// GET /sites/{slug}/offers: published offers still in effect (books.offer).
import { z } from 'zod';
import { Id, IntFigure, MoneyFigure, OfferCode, Timestamp } from './common.ts';
import { Category, page } from './lib.ts';

const fields = {
  id: Id,
  name: z.string().min(1).max(80),
  scope: z.enum(['all', 'category', 'items']),
  category: Category.nullable(),
  itemIds: z.array(Id).max(100),
  minSpend: MoneyFigure.nullable(),
  // only when the owner chose to publish it
  code: OfferCode.nullable(),
  startsAt: Timestamp,
  endsAt: Timestamp,
};
export const Offer = z.discriminatedUnion('kind', [
  // basis points: 1000 is 10%
  z.strictObject({ ...fields, kind: z.literal('percent_off'), percentBp: IntFigure }),
  z.strictObject({ ...fields, kind: z.literal('amount_off'), amountOff: MoneyFigure }),
]);
export const OffersPage = page(Offer);
