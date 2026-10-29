// The credit book (apps/web/lib/server/credit.ts shows it): who owes what at the end of today (credit.balances), minted
// as the signed-in member, and the customers by name.
import type { Session } from './session.ts';
import { type Client, customerList, mint } from './views-common.ts';
import { viewFloor } from './views-counter.ts';

export async function viewCredit(c: Client, session: Session) {
  const floor = await viewFloor(c, session);
  const balances = await mint(c, 'credit.balances', { as_of: floor.today });
  return { ...floor, balances, customers: await customerList(c) };
}

/** The balances read after a write: a fresh credit.balances. */
export async function viewBalanceAfter(c: Client, session: Session) {
  const { today } = await viewFloor(c, session);
  return mint(c, 'credit.balances', { as_of: today });
}
