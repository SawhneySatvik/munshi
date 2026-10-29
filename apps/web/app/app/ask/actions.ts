"use server";

// Asking the books: a typed question, or a recording (16-bit mono WAV, from the mic or a file). The person always comes
// from sessionFrom(); the question is theirs, so it goes to the agent and back to their screen, and never into a trace
// (the agent's port keeps fixed labels and ids only). The answer's figures are cells the run minted.
import { cookies } from "next/headers";
import { type AskState, MAX_AUDIO, MAX_QUESTION } from "../../../lib/hero-types";
import { askBooks } from "../../../lib/server/hero";
import { sessionFrom } from "../../../lib/server/session";

const tag = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

export async function askAction(_prev: AskState, form: FormData): Promise<AskState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const audio = form.get("audio");
  try {
    if (audio instanceof Blob && audio.size > 0) {
      if (audio.size > MAX_AUDIO) return { error: "too_long" };
      const wav = new Uint8Array(await audio.arrayBuffer());
      if (wav.length < 44 || tag(wav, 0) !== "RIFF" || tag(wav, 8) !== "WAVE") return { error: "not_audio" };
      return { turn: await askBooks(session, { via: "voice", wav }) };
    }
    const question = String(form.get("question") ?? "").trim();
    if (!question) return { error: "empty" };
    if (question.length > MAX_QUESTION) return { error: "too_long" };
    return { turn: await askBooks(session, { via: "text", question }) };
  } catch {
    return { error: "other" };
  }
}
