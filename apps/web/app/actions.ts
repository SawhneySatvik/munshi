"use server";

// The app's server actions. Each takes ids only from the client; the person always comes from sessionFrom(), never
// from the form. decide() then runs as that member, so an approval executes under the approver's own identity in one
// transaction with its audit entries; the database refuses a member whose role lacks the draft's command.
import { CoreError, decide, openSession } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "../lib/server/config";
import { appPool } from "../lib/server/db";
import { SESSION_COOKIE, SESSION_SECONDS, sessionFrom, signSession } from "../lib/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DecideError = "refused" | "not_proposed" | "signed_out" | "other";
export type DecideState = { error: DecideError } | null;

export async function decideDraft(_prev: DecideState, form: FormData): Promise<DecideState> {
  const draftId = form.get("draft");
  const verdict = form.get("verdict");
  if (typeof draftId !== "string" || !UUID.test(draftId) || (verdict !== "approved" && verdict !== "rejected")) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  try {
    await decide(await appPool(), session, draftId, verdict);
  } catch (err) {
    // CoreError carries a code and a fixed message only; the screen shows its own words for the code.
    const code = err instanceof CoreError ? err.code : "internal";
    return { error: code === "refused" || code === "not_proposed" ? code : "other" };
  } finally {
    revalidatePath("/");
  }
  return null;
}

// Demo sign-in: the form names a member; only an active member of the demo shop is signed, so a posted id from any
// other tenant (or none) signs nobody in.
export async function signIn(form: FormData): Promise<void> {
  const memberId = form.get("member");
  if (typeof memberId !== "string" || !UUID.test(memberId)) redirect("/sign-in");
  const { demoTenantId, sessionSecret } = config();
  const session = await openSession(await appPool(), demoTenantId, memberId);
  if (!session) redirect("/sign-in");
  (await cookies()).set(SESSION_COOKIE, signSession(session, sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  redirect("/");
}
