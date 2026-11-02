// The credit book (server only): who owes what at the end of today (credit.balances), each balance, overdue amount and
// due date a cell, minted by core's viewCredit in the page's one transaction. A customer is marked overdue when their
// overdue cell holds more than nothing: the cell is compared, never computed with. Names come from the customers the
// view reads by id (a person's name is not a cell).
import { type Session, viewBalanceAfter, viewCredit } from "@munshi/core";
import { DICT } from "../i18n";
import type { CreditPage } from "../ops-types";
import type { Localized } from "../types";
import { frame, minted, page, refTo, rowOf, textOf } from "./ops";
import { paypalPanel } from "./paypal-panel";

export const creditBook = (): Localized => ({ en: DICT.en.labelCreditBook, hi: DICT.hi.labelCreditBook });

export async function loadCredit(session: Session): Promise<CreditPage> {
  const { v, paypal } = await page(session, async (c) => {
    const v = await viewCredit(c, session);
    return { v, paypal: await paypalPanel(c, session, {}) };
  });
  const floor = frame(v.viewer);
  const balances = minted(v.balances);
  const names = new Map(v.customers.map((k) => [k.id, k.name]));
  const label = creditBook();
  return {
    member: floor.member,
    shop: floor.shop,
    owing: balances.cells.map((r, i) => {
      const overdue = r.overdue;
      const id = textOf(r.customer_id);
      return {
        customer: { id, name: names.get(id) ?? "" },
        balance: refTo(balances, i, "balance", label),
        overdue: refTo(balances, i, "overdue", label),
        due: refTo(balances, i, "oldest_due_on", label),
        late: overdue?.kind === "money" && BigInt(overdue.num) > 0n,
      };
    }),
    customers: v.customers,
    snapshots: [balances.snapshot],
    canPayment: floor.may.has("payment.record"),
    canCredit: floor.may.has("credit.record"),
    paypal,
  };
}

/** A customer's balance read after a write: a fresh credit.balances, and the customer's row in it (none: owes nothing). */
export async function balanceAfter(session: Session, customerId: string) {
  const balances = minted(await page(session, (c) => viewBalanceAfter(c, session)));
  const row = rowOf(balances, "customer_id", customerId);
  return { owes: row >= 0 ? refTo(balances, row, "balance", creditBook()) : null, snapshots: [balances.snapshot] };
}
