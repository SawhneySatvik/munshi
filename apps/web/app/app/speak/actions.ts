"use server";

// Read aloud: the form names what to read (an Ask answer by its run's id, or a morning brief by its id) and the page's
// language, and nothing else is read from it: no words ever come from the client. The person comes from sessionFrom();
// lib/server/speak.ts loads the checked text they can see and voices it.
import { cookies } from "next/headers";
import { type SpeakOutcome, speakChecked } from "../../../lib/server/speak";
import { sessionFrom } from "../../../lib/server/session";
import { UUID } from "../../../lib/parse";

export type SpeakState = SpeakOutcome | { error: "signed_out" | "other" } | null;

export async function readAloudAction(_prev: SpeakState, form: FormData): Promise<SpeakState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const kind = form.get("kind");
  const id = String(form.get("id") ?? "");
  const lang = form.get("lang") === "hi" ? "hi" : "en";
  if ((kind !== "answer" && kind !== "brief") || !UUID.test(id)) return { error: "not_found" };
  try {
    return await speakChecked(session, { kind, id }, lang);
  } catch {
    return { error: "other" };
  }
}
