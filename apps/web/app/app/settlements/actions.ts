"use server";

// Settlements (P-4): preview a statement against the books, or record it (settlement.import, the person's own command,
// under the signed-in owner or manager; the database refuses anyone else). Only the uploaded file is read from the form:
// a total, an amount or any other field a browser adds is never looked at. Payments are recorded, never processed.
import { CoreError, previewStatement, runCommand } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { appPool } from "../../../lib/server/db";
import { page } from "../../../lib/server/ops";
import { sessionFrom } from "../../../lib/server/session";
import { feedStatement, type FileProblem, type PreviewView, previewView, statementOf } from "../../../lib/server/settlements";

export type SettleState =
  | null
  | { error: "signed_out" | "refused" | "other" | "feed_empty" | FileProblem }
  | { error: "invalid"; lines: string[] }
  | { preview: PreviewView; recorded: boolean };

export async function settleAction(_prev: SettleState, form: FormData): Promise<SettleState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  // The feed's statement is made here, on the server, from the books each time: nothing of it comes from the form, so a
  // record from the feed records what the feed announces now, never rows a browser sends.
  const intent = form.get("intent");
  const fromFeed = intent === "feed" || intent === "record-feed";
  let statement: Awaited<ReturnType<typeof statementOf>>;
  try {
    statement = fromFeed ? await feedStatement(session) : await statementOf(form.get("statement"));
  } catch (err) {
    // The feed is read against the books' receipts, a read of the office's (D-082): refused for anyone else.
    return { error: err instanceof CoreError && err.code === "not_for_role" ? "refused" : "other" };
  }
  if ("problem" in statement) return { error: statement.problem };
  if (fromFeed && statement.rows.length < 2) return { error: "feed_empty" };
  let recorded = false;
  try {
    if (intent === "record" || intent === "record-feed") {
      await runCommand(await appPool(), session, "settlement.import", statement);
      recorded = true;
      revalidatePath("/app/settlements");
    }
    // The preview after a record reads the books as they now stand: every line it wrote reads as already recorded.
    return { preview: previewView(await page(session, (c) => previewStatement(c, statement)), fromFeed ? "feed" : "file"), recorded };
  } catch (err) {
    if (err instanceof CoreError && err.code === "invalid") return { error: "invalid", lines: err.fields ?? [] };
    // Not for the member's role: the command's refusal, or the read gate's before it (D-082).
    if (err instanceof CoreError && (err.code === "refused" || err.code === "not_for_role")) return { error: "refused" };
    return { error: "other" };
  }
}
