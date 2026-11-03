"use server";

// Staff records, each the signed-in member's own direct command under the form's key: a day's mark
// (attendance.mark: owner, manager, or a staff member for their own day, never over a manager's mark), leave
// (leave.record: owner or manager) and an advance (advance.give: the owner's; recorded, never processed).
import type { ActState } from "../../../lib/app-types";
import { rupeesToMinor } from "../../../lib/parse";
import { act, command, dayOf, field, idOf, invalid } from "../../../lib/server/act";

const PATH = "/app/staff";

export async function markAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const staffId = idOf(form, "staff");
    const shopId = idOf(form, "shop");
    const day = dayOf(form, "day");
    const status = field(form, "status");
    if (!staffId || !shopId || !day || !["present", "absent", "half_day", "leave", "off"].includes(status)) return invalid();
    await command(session, "attendance.mark", { staffId, shopId, day, status }, key);
    return undefined;
  });
}

export async function leaveAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const staffId = idOf(form, "staff");
    const kind = field(form, "kind");
    const firstDay = dayOf(form, "from");
    const lastDay = dayOf(form, "to") ?? firstDay;
    if (!staffId || !firstDay || !lastDay || !["paid", "unpaid", "sick"].includes(kind)) return invalid();
    await command(session, "leave.record", { staffId, kind, firstDay, lastDay }, key);
    return undefined;
  });
}

export async function advanceAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session, key) => {
    const staffId = idOf(form, "staff");
    const method = field(form, "method");
    const amountMinor = rupeesToMinor(field(form, "amount"));
    if (!staffId || !["cash", "upi", "bank"].includes(method)) return invalid();
    if (amountMinor === null) return { error: "amount" };
    await command(session, "advance.give", { staffId, amountMinor, method }, key);
    return undefined;
  });
}
