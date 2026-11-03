"use server";

// The loyalty rule: loyalty.rule.set, the owner's own direct command under the form's key. The latest
// rule in effect sets how a named customer earns and redeems; the typed numbers are the owner's.
import type { ActState } from "../../../lib/app-types";
import { rupeesToMinor } from "../../../lib/parse";
import { act, command, field, invalid, wholeOf } from "../../../lib/server/act";

export async function setRuleAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/loyalty", async (session, key) => {
    const earnPer100 = wholeOf(form, "earn", 0, 10_000);
    const minRedeem = wholeOf(form, "min", 1, 1_000_000);
    const pointValueMinor = rupeesToMinor(field(form, "value"));
    if (earnPer100 === null || minRedeem === null) return invalid();
    if (pointValueMinor === null) return { error: "amount" };
    await command(session, "loyalty.rule.set", { earnPer100, pointValueMinor, minRedeem }, key);
    return undefined;
  });
}
