// The growth page (apps/web/lib/server/growth.ts shows it): the five growth reads over the four weeks ending yesterday,
// minted as the signed-in member in the page's one transaction, one after another. Nothing is added up here.
import { addDays } from './time.ts';
import { SLOW_DAYS } from './queries-growth.ts';
import type { Session } from './session.ts';
import { type Client, mint } from './views-common.ts';
import { viewFloor } from './views-counter.ts';

export async function viewGrowth(c: Client, session: Session) {
  const floor = await viewFloor(c, session);
  const as_of = addDays(floor.today, -1);
  const peak = await mint(c, 'growth.peak_hours', { as_of });
  const customers = await mint(c, 'growth.customers', { as_of });
  const basket = await mint(c, 'growth.basket', { as_of });
  const slow = await mint(c, 'growth.slow_movers', { as_of, days: SLOW_DAYS });
  const mix = await mint(c, 'growth.payment_mix', { as_of });
  return { ...floor, asOf: as_of, peak, customers, basket, slow, mix };
}
