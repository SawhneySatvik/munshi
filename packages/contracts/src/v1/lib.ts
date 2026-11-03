// Helpers for the v1 schema modules. Not a schema module itself: schemas.ts spreads only the resource modules.
import { z } from 'zod';
import { Cursor } from './common.ts';

// A cursor page: at most 100 items, and `next` is null on the last page.
export const page = <T extends z.ZodType>(item: T) => z.strictObject({ data: z.array(item).max(100), next: Cursor.nullable() });

export const ItemName = z.string().min(1).max(120);
export const Category = z.string().min(1).max(60);
// Milli-units of the item's unit (one piece is 1000), as ops.order_request's lines and ops.reservation.qty_milli.
export const QtyMilli = z.int().min(1).max(1_000_000_000);
