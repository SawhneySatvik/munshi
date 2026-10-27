"use server";

// Counting a shelf from a photo. Any signed-in member may photograph a shelf: the count is evidence the run stores, and
// a gap becomes a stock.count draft that only a member allowed to count stock can approve. The photo's raw bytes go
// to the agent as sent (never re-encoded), and only its sha256 is stored.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { MAX_PHOTO, type ShelfState } from "../../lib/hero-types";
import { recordedMode } from "../../lib/server/agent-port";
import { countShelfPhoto } from "../../lib/server/hero";
import { sessionFrom } from "../../lib/server/session";

export async function countShelfAction(_prev: ShelfState, form: FormData): Promise<ShelfState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const photo = form.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0) return { error: "empty" };
  if (photo.size > MAX_PHOTO) return { error: "too_long" };
  try {
    const { result, snapshots } = await countShelfPhoto(session, new Uint8Array(await photo.arrayBuffer()));
    return { result, snapshots, recorded: recordedMode() };
  } catch {
    return { error: "other" };
  } finally {
    revalidatePath("/stock");
  }
}
