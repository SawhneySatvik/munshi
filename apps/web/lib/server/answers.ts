// An Ask answer, kept (server only): the checked segments of a question's answer are stored as the asking member's
// ai.answer (kind `ask`) for the run that wrote them: the words in erasable ops.message_text, the refs in the answer row,
// which pins their snapshots. It is what Read aloud reads back (speak.ts): the screen's turn is the client's, never trusted.
// The words are erased 30 days after the answer by core's jobs (the `ask_words` purge, jobs-core.ts).
import type { Reply } from "@munshi/agent";
import { log, recordAnswer, type Session, withTx } from "@munshi/core";
import { appPool } from "./db";

/**
 * Keeps an answered reply for its run; an abstention keeps nothing. A failure leaves the answer unreadable aloud and
 * is logged (its code only: no message, no words), never thrown at the person asking.
 */
export async function keepAnswer(session: Session, runId: string, reply: Reply): Promise<void> {
  if (reply.kind !== "answer" || reply.segments.length === 0) return;
  const segments = reply.segments.map((s) => ({ text: s.text, refs: s.refs }));
  try {
    await withTx(await appPool(), { kind: "member", session }, (c) => recordAnswer(c, runId, "ask", segments));
  } catch (err) {
    // Core's logger: the error's SQLSTATE (or CoreError code) only, never its message, which could hold a value.
    const code = (err as { code?: unknown }).code;
    log("ask.answer_not_kept", typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { sqlstate: code } : { code: typeof code === "string" ? code : "error" }, "warn");
  }
}
