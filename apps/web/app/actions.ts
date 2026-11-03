"use server";

// The app's server actions. Each takes ids only from the client; the person always comes from sessionFrom(), never
// from the form. decide() then runs as that member, so an approval executes under the approver's own identity in one
// transaction with its audit entries; the database refuses a member whose role lacks the draft's command.
import { CoreError, decide, deploymentKind, listDemoShops, type Opened, openDemoSession } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { type NoteError, noteErrorOf } from "../lib/note-errors";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { landing } from "../lib/nav";
import { appPool } from "../lib/server/db";
import { memberOf } from "../lib/server/ops";
import { sessionFrom, setSessionCookie } from "../lib/server/session";
import { flushOutbox } from "../lib/server/outbox.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// note_*: the words for Keeper were refused, by reason (lib/note-errors.ts).
export type DecideError = "refused" | "not_proposed" | "signed_out" | "other" | NoteError;
export type DecideState = { error: DecideError } | null;

export async function decideDraft(_prev: DecideState, form: FormData): Promise<DecideState> {
  const draftId = form.get("draft");
  const verdict = form.get("verdict");
  if (typeof draftId !== "string" || !UUID.test(draftId) || (verdict !== "approved" && verdict !== "rejected")) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  // The person's own words for Keeper (W2-A), if any: core keeps them as a note citing this decision, or refuses them.
  const note = form.get("note");
  const words = typeof note === "string" && note.trim() ? note : undefined;
  try {
    // A rejection carries a reason code (v2's approval.decision refuses one without); the card's Reject asks for none,
    // so it is recorded as "not now".
    const d = await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined, words);
    // An executed draft's messages go out now (recorded on the demo), not at the next tick.
    if (d.status === "executed") await flushOutbox();
  } catch (err) {
    // CoreError carries a code and a fixed message only; the screen shows its own words for the code.
    const code = err instanceof CoreError ? err.code : "internal";
    const noted = err instanceof CoreError ? noteErrorOf(err) : null;
    if (noted) return { error: noted };
    return { error: code === "refused" || code === "not_proposed" ? code : "other" };
  } finally {
    revalidatePath("/app");
  }
  return null;
}

// Demo sign-in (BLUEPRINT §6.6): the form names a person of a sample shop the picker lists; core opens a 12-hour demo
// session for them (the database refuses one for anyone else) and the cookie names it, so a posted id from any other
// tenant, a sandbox or none signs nobody in. On a live deployment this action answers 404 (F2). The person lands on
// their role's first section (counter staff: the counter).
export async function signIn(form: FormData): Promise<void> {
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "demo") notFound();
  const memberId = form.get("member");
  if (typeof memberId !== "string" || !UUID.test(memberId)) redirect("/sign-in");
  let opened: Opened | null = null;
  for (const shop of await listDemoShops(pool)) opened ??= await openDemoSession(pool, shop.tenantId, memberId);
  if (!opened) redirect("/sign-in");
  await setSessionCookie(await cookies(), opened);
  const me = await memberOf(opened.session);
  redirect(me ? landing(me.role) : "/app");
}
