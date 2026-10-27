// The credit book (server only): who owes what at the end of today (credit.balances), each balance, overdue amount and
// due date a cell. A customer is marked overdue when their overdue cell holds more than nothing: the cell is compared,
// never computed with.
import type { Session } from "@munshi/core";
import { DICT } from "../i18n";
import type { CreditPage, Named } from "../ops-types";
import type { Localized } from "../types";
import { floorOf, mint, readOnly, refTo, rowOf, textOf } from "./ops";

export const creditBook = (): Localized => ({ en: DICT.en.labelCreditBook, hi: DICT.hi.labelCreditBook });

export async function loadCredit(session: Session): Promise<CreditPage> {
  const floor = await floorOf(session);
  const balances = await mint(session, "credit.balances", { as_of: floor.today });
  const customers = await readOnly(
    session,
    async (c) => (await c.query<Named>("select id::text as id, name from books.customer order by name, id")).rows,
  );
  const label = creditBook();
  return {
    member: floor.member,
    shop: floor.shop,
    owing: balances.cells.map((r, i) => {
      const overdue = r.overdue;
      return {
        customer: { id: textOf(r.customer_id), name: textOf(r.customer) },
        balance: refTo(balances, i, "balance", label),
        overdue: refTo(balances, i, "overdue", label),
        due: refTo(balances, i, "oldest_due_on", label),
        late: overdue?.kind === "money" && BigInt(overdue.num) > 0n,
      };
    }),
    customers,
    snapshots: [balances.snapshot],
    canPayment: floor.may.has("payment.record"),
    canCredit: floor.may.has("credit.record"),
  };
}

/** A customer's balance read after a write: a fresh credit.balances, and the customer's row in it (none: owes nothing). */
export async function balanceAfter(session: Session, customerId: string) {
  const floor = await floorOf(session);
  const balances = await mint(session, "credit.balances", { as_of: floor.today });
  const row = rowOf(balances, "customer_id", customerId);
  return { owes: row >= 0 ? refTo(balances, row, "balance", creditBook()) : null, snapshots: [balances.snapshot] };
}
