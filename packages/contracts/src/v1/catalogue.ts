// GET /sites/{slug}/catalogue (BLUEPRINT §5.1): goods from the latest release, parents with their variants.
import { z } from 'zod';
import { Id, ListQuery, MoneyFigure } from './common.ts';
import { Category, ItemName, page } from './lib.ts';

// An item with no variants is listed as its own single variant, so every orderable id is a variant's.
export const Variant = z.strictObject({
  id: Id,
  name: ItemName,
  attrs: z.record(z.string().min(1).max(60), z.string().min(1).max(30)),
  unit: z.enum(['piece', 'pack', 'kg', 'g', 'l', 'ml', 'm']),
  price: MoneyFigure,
  // A live hold on the piece; no stock count is ever shown.
  held: z.boolean(),
});
export const CatalogueItem = z.strictObject({ id: Id, name: ItemName, category: Category.nullable(), variants: z.array(Variant).min(1).max(100) });
export const CatalogueQuery = ListQuery.extend({ category: Category.optional() });
export const CataloguePage = page(CatalogueItem);
