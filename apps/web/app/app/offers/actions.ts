"use server";

// Offers: offer.create and offer.end, each the owner's own direct command under the form's key (the
// database refuses anyone else). An offer is a price, so no AI draft ever creates one. Typed numbers are the owner's.
import { dayStart } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { rupeesToMinor } from "../../../lib/parse";
import { act, command, dayOf, field, idOf, invalid, wholeOf } from "../../../lib/server/act";

const PATH = "/app/offers";
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** "10" or "12.5" percent as basis points (whole), or null. */
function percentBp(text: string): number | null {
  if (!/^[0-9]{1,2}(\.[0-9]{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return bp >= 1 && bp <= 9000 ? bp : null;
}

export async function createOfferAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const name = field(form, "name");
    const kind = field(form, "kind");
    const scope = field(form, "scope");
    const ends = dayOf(form, "ends");
    const code = field(form, "code").toUpperCase();
    const category = field(form, "category");
    const value = field(form, "value");
    if (!name || !ends || (kind !== "percent_off" && kind !== "amount_off") || (scope !== "all" && scope !== "category")) return invalid();
    if (scope === "category" && !category) return invalid();
    const off = kind === "percent_off" ? percentBp(value) : rupeesToMinor(value);
    if (off === null) return { error: "amount" };
    const minSpend = field(form, "min") ? rupeesToMinor(field(form, "min")) : undefined;
    const cap = field(form, "cap") ? wholeOf(form, "cap", 1, 1_000_000) : undefined;
    const per = field(form, "per") ? wholeOf(form, "per", 1, 1000) : undefined;
    if (minSpend === null || cap === null || per === null) return { error: "amount" };
    await command(
      session,
      "offer.create",
      {
        name,
        kind,
        ...(kind === "percent_off" ? { percentBp: off } : { amountOffMinor: off }),
        scope,
        ...(scope === "category" ? { category } : {}),
        ...(code ? { code } : {}),
        ...(minSpend !== undefined ? { minSpendMinor: minSpend } : {}),
        ...(cap !== undefined ? { maxRedemptions: cap } : {}),
        ...(per !== undefined ? { perCustomerLimit: per } : {}),
        // The offer runs to the end of its last day in the shop's zone.
        endsAt: dayStart(nextDay(ends)).toISOString(),
        published: form.get("published") === "on",
      },
      key,
    );
    return undefined;
  });
}

export async function endOfferAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const offerId = idOf(form, "offer");
    if (!offerId) return invalid();
    await command(session, "offer.end", { offerId, reason: "not_now" }, key);
    return undefined;
  });
}
