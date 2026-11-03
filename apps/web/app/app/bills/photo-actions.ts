"use server";

// Reading a supplier's bill from a photo, for the supplier the person names (core checks the draft names exactly the
// bill's supplier, number and date). The owner or a manager may read one (core's map); the purchase.record draft waits for a member
// allowed to record purchases. The photo's raw bytes go to the agent as sent, and only its sha256 is stored.
import { memberMayRead } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { type BillState, MAX_PHOTO } from "../../../lib/hero-types";
import { isFeatureOff, recordedMode } from "../../../lib/server/agent-port";
import { appPool } from "../../../lib/server/db";
import { billSuppliers, readBillPhoto } from "../../../lib/server/hero";
import { sessionFrom } from "../../../lib/server/session";

export async function readBillAction(_prev: BillState, form: FormData): Promise<BillState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const supplierId = String(form.get("supplier") ?? "");
  const photo = form.get("photo");
  try {
    // A bill's lines are the office's (core's map): another role is refused before any run, model call, stored
    // read or replay of a photo already read.
    if (!(await memberMayRead(await appPool(), session, "bill.lines"))) return { error: "refused" };
    if (!(await billSuppliers(session)).some((s) => s.id === supplierId)) return { error: "supplier" };
    if (!(photo instanceof Blob) || photo.size === 0) return { error: "empty" };
    if (photo.size > MAX_PHOTO) return { error: "too_long" };
    const { result, snapshots } = await readBillPhoto(session, new Uint8Array(await photo.arrayBuffer()), supplierId);
    return { result, snapshots, recorded: recordedMode() };
  } catch (err) {
    return { error: isFeatureOff(err) ? "off" : "other" };
  } finally {
    revalidatePath("/app/bills");
  }
}
