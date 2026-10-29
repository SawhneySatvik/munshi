// GET /sites/{slug}/services (BLUEPRINT §5.1): services with their duration and price, and the branches that offer each.
import { z } from 'zod';
import { Id, IntFigure, MoneyFigure } from './common.ts';
import { Category, ItemName, page } from './lib.ts';

export const Service = z.strictObject({
  id: Id,
  name: ItemName,
  category: Category.nullable(),
  // minutes
  duration: IntFigure,
  price: MoneyFigure,
  shopIds: z.array(Id).min(1).max(20),
});
export const ServicesPage = page(Service);
