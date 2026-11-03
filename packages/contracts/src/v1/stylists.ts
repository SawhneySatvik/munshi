// GET /sites/{slug}/stylists: the opted-in public profiles (ops.staff_public), the only personal data a
// public page shows.
import { z } from 'zod';
import { Id, ListQuery, MediaPath } from './common.ts';
import { page } from './lib.ts';

export const Stylist = z.strictObject({
  // the books.staff id a hold names
  id: Id,
  shopId: Id,
  displayName: z.string().min(1).max(40),
  blurb: z.string().max(200).nullable(),
  artUrl: MediaPath.nullable(),
});
export const StylistsQuery = ListQuery.extend({ shop: Id.optional() });
export const StylistsPage = page(Stylist);
