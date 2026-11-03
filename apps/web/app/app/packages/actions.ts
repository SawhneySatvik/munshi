"use server";

// Packages: a session redeemed (package.redeem: owner, manager or staff, at either branch) and a new plan
// (package.plan.create: the owner's), each the signed-in member's own direct command under the form's key. The balance
// is the database's, under a per-holding lock; it never goes below zero.
import type { ActState } from "../../../lib/app-types";
import { rupeesToMinor } from "../../../lib/parse";
import { act, command, field, idOf, invalid, wholeOf } from "../../../lib/server/act";

const PATH = "/app/packages";

export async function redeemAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const holdingId = idOf(form, "holding");
    const shopId = idOf(form, "shop");
    const itemId = idOf(form, "item");
    if (!holdingId || !shopId || !itemId) return invalid();
    await command(session, "package.redeem", { holdingId, shopId, itemId }, key);
    return undefined;
  });
}

export async function createPlanAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const name = field(form, "name");
    const itemId = idOf(form, "service");
    const validityDays = wholeOf(form, "days", 1, 1095);
    const sessions = wholeOf(form, "sessions", 1, 100);
    const priceMinor = rupeesToMinor(field(form, "price"));
    if (!name || !itemId || validityDays === null || sessions === null) return invalid();
    if (priceMinor === null) return { error: "amount" };
    await command(session, "package.plan.create", { name, priceMinor, validityDays, lines: [{ itemId, sessions }] }, key);
    return undefined;
  });
}
