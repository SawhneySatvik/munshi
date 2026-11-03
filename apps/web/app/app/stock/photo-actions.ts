"use server";

// Counting a shelf from a photo. Any member whose role reads a shelf count (core's map: counter staff work stock) may
// photograph a shelf: the count is evidence the run stores, and a gap becomes a stock.count draft that only a member
// allowed to count stock can approve. The photo's raw bytes go to the agent as sent (never re-encoded), and only its
// sha256 is stored.
import { memberMayRead } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { MAX_PHOTO, type ShelfState } from "../../../lib/hero-types";
import { isFeatureOff, recordedMode } from "../../../lib/server/agent-port";
import { appPool } from "../../../lib/server/db";
import { countShelfPhoto } from "../../../lib/server/hero";
import { sessionFrom } from "../../../lib/server/session";

export async function countShelfAction(_prev: ShelfState, form: FormData): Promise<ShelfState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const photo = form.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) return { error: "empty" };
  if (photo.size > MAX_PHOTO) return { error: "too_long" };
  try {
    // Refused before any run or model call for a role the map does not give the shelf count.
    if (!(await memberMayRead(await appPool(), session, "count.shelf"))) return { error: "refused" };
    const { result, snapshots } = await countShelfPhoto(session, new Uint8Array(await photo.arrayBuffer()));
    return { result, snapshots, recorded: recordedMode() };
  } catch (err) {
    return { error: isFeatureOff(err) ? "off" : "other" };
  } finally {
    revalidatePath("/app/stock");
  }
}
