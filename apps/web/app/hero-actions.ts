"use server";

// Approve or reject a draft a photo left (a stock.count from a shelf photo, a purchase.record from a bill photo). The
// person comes from sessionFrom(), never the form; core's decide() runs as that member, re-checks every cell the draft
// cites (a count too old, or books that moved since, make it stale) and executes under their identity in one
// transaction with its audit entry. The card is then read back from the books, with the item's on-hand read after a
// count and the bill a purchase wrote.
import { CoreError, decide } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { DecidePhotoState } from "../lib/hero-types";
import { appPool } from "../lib/server/db";
import { photoDrafts } from "../lib/server/hero";
import { sessionFrom } from "../lib/server/session";
import { onHandAfter } from "../lib/server/stock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function decidePhotoDraft(_prev: DecidePhotoState, form: FormData): Promise<DecidePhotoState> {
  const draftId = form.get("draft");
  const verdict = form.get("verdict");
  if (typeof draftId !== "string" || !UUID.test(draftId) || (verdict !== "approved" && verdict !== "rejected")) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  let billId: string | null = null;
  try {
    const d = await decide(await appPool(), session, draftId, verdict);
    if (d.status === "executed") billId = d.result.purchaseId ?? null;
  } catch (err) {
    const code = err instanceof CoreError ? err.code : "internal";
    return { error: code === "refused" || code === "not_proposed" ? code : "other" };
  } finally {
    revalidatePath("/stock");
    revalidatePath("/bills");
  }
  const { drafts, snapshots } = await photoDrafts(session, { ids: [draftId] });
  const draft = drafts[0];
  if (!draft) return { error: "other" };
  if (draft.command === "stock.count" && draft.status === "executed") {
    const after = await onHandAfter(session, draft.itemId);
    return { draft, snapshots: [...snapshots, ...after.snapshots], after: after.onHand, billId: null };
  }
  return { draft, snapshots, after: null, billId };
}
