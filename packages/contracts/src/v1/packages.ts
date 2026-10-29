// GET /sites/{slug}/packages (BLUEPRINT §5.1): plans with their lines, sessions, validity and price (books.package_plan).
import { z } from 'zod';
import { Id, IntFigure, MoneyFigure } from './common.ts';
import { ItemName, page } from './lib.ts';

export const PackageLine = z.strictObject({ serviceId: Id, name: ItemName, sessions: IntFigure });
export const PackagePlan = z.strictObject({
  id: Id,
  itemId: Id,
  name: ItemName,
  kind: z.enum(['sessions', 'value']),
  price: MoneyFigure,
  // the stored value of a value plan
  value: MoneyFigure.nullable(),
  validityDays: IntFigure,
  lines: z.array(PackageLine).max(100),
});
export const PackagesPage = page(PackagePlan);
