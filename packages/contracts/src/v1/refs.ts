// GET /sites/{slug}/refs/{snapshot}/{row}/{col}: "tap for source". A published cell with the book row it came from, or
// "Cannot verify" when the ref names no cell of a published release: every number shown traces to a ledger row.
import { z } from 'zod';
import { DateCell, Id, IntFigure, MoneyFigure, Slug, TextCell, Timestamp, TimestampCell } from './common.ts';

export const RefParams = z.strictObject({
  slug: Slug,
  snapshot: Id,
  row: z.coerce.number().int().min(0).max(999_999),
  col: z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/),
});
export const PublishedCell = z.union([MoneyFigure, IntFigure, TextCell, DateCell, TimestampCell]);
export const RefSource = z.strictObject({ table: z.string().regex(/^(books|ops)\.[a-z_]{1,60}$/), id: Id });
export const RefAnswer = z.discriminatedUnion('verified', [
  z.strictObject({ verified: z.literal(true), cell: PublishedCell, source: RefSource, publishedAt: Timestamp }),
  z.strictObject({ verified: z.literal(false), label: z.literal('Cannot verify') }),
]);
