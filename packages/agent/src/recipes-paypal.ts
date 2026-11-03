// PayPal's recipes (D-079, sandbox) live in recipes.ts beside every other recipe (gate R3 reads each recipe's reads from
// that one source): overdue_credit's second fix, a PayPal link (the person's pick beside "Draft the fix"), and
// paypal_unrecorded's "record this payment". Kept here under their names for the PayPal gates.
import { creditFix, PAYPAL_FIX_KINDS, type Recipe, recordPaypal } from "./recipes.ts";

/** overdue_credit → paypal.request: "Send a PayPal link" for the customer's current balance (the PayPal choice). */
export const paypalLink: Recipe = (f, read) => creditFix(f, read, { fix: "paypal" });
/** The second fix for an overdue_credit finding: a PayPal link instead of a reminder. */
export const PAYPAL_LINK_RECIPE: Recipe = paypalLink;
export { PAYPAL_FIX_KINDS, recordPaypal };
