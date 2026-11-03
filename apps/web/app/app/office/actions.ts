"use server";

// Keeper's desk: the owner forgets a note. The person comes from sessionFrom(), never the form; core's forgetNote
// refuses anyone but the owner before the write (the schema refuses too), and the end is audited. Gated first by the
// office's read of memory, before any write.
import { CoreError, forgetNote, memberMayRead } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { appPool } from "../../../lib/server/db";
import { UUID } from "../../../lib/parse";
import { sessionFrom } from "../../../lib/server/session";

// gone: the note was already forgotten (its end is written once, ever).
export type ForgetState = { error: "gone" | "refused" | "other" } | { done: true } | null;

export async function forgetAction(_prev: ForgetState, form: FormData): Promise<ForgetState> {
  const memoryId = form.get("memory");
  if (typeof memoryId !== "string" || !UUID.test(memoryId)) return { error: "other" };
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "refused" };
  const pool = await appPool();
  if (!(await memberMayRead(pool, session, "memory.in_force"))) return { error: "refused" };
  try {
    await forgetNote(pool, session, memoryId);
  } catch (err) {
    const code = err instanceof CoreError ? err.code : "internal";
    return { error: code === "conflict" ? "gone" : code === "refused" ? "refused" : "other" };
  }
  revalidatePath("/app/office");
  return { done: true };
}
