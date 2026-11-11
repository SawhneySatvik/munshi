"use server";

// Chat link: the signed-in member asks for a one-time code, or ends a link. The person comes from sessionFrom() alone,
// never the form, so a member only ever links or unlinks themselves.
import { issueChatCode, revokeChatLink } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { UUID } from "../../../lib/parse";
import { appPool } from "../../../lib/server/db";
import { sessionFrom } from "../../../lib/server/session";

export type CodeState = { code: string; expiresAt: string } | { error: true } | null;

export async function issueCodeAction(_prev: CodeState): Promise<CodeState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: true };
  try {
    const { code, expiresAt } = await issueChatCode(await appPool(), session);
    return { code, expiresAt: expiresAt.toISOString() };
  } catch {
    return { error: true };
  }
}

export async function revokeLinkAction(form: FormData): Promise<void> {
  const session = await sessionFrom(await cookies());
  const id = form.get("id");
  if (!session || typeof id !== "string" || !UUID.test(id)) return;
  await revokeChatLink(await appPool(), session, id);
  revalidatePath("/app/chat-link");
}
