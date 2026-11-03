"use server";

// Listing a recipient (W2-B): the person comes from sessionFrom(), never the form; core's addRecipient refuses anyone the
// role map does not give surplus to (an owner's or a manager's) before anything is written. A recipient is an ops row,
// simulated whatever the form says (the schema admits no other); no book changes.
import { addRecipient, CoreError, RECIPIENT_KINDS, type RecipientKind } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { appPool } from "../../../lib/server/db";
import { sessionFrom } from "../../../lib/server/session";

export type RecipientNote = "added" | "invalid" | "taken" | "refused" | "signedOut" | "other";
export type RecipientState = { note: RecipientNote; ok: boolean } | null;

export async function addRecipientAction(_prev: RecipientState, form: FormData): Promise<RecipientState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { note: "signedOut", ok: false };
  const kind = String(form.get("kind"));
  if (!(RECIPIENT_KINDS as readonly string[]).includes(kind)) return { note: "invalid", ok: false };
  try {
    await addRecipient(await appPool(), session, { name: String(form.get("name") ?? ""), kind: kind as RecipientKind, area: String(form.get("area") ?? "") });
  } catch (err) {
    const code = err instanceof CoreError ? err.code : "internal";
    return { note: code === "invalid" ? "invalid" : code === "conflict" ? "taken" : code === "refused" || code === "not_for_role" ? "refused" : "other", ok: false };
  } finally {
    revalidatePath("/app/surplus");
    revalidatePath("/app");
  }
  return { note: "added", ok: true };
}
