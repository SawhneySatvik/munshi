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
import { type FileProblem, type PreviewView, previewView, statementOf } from "../../../lib/server/settlements";

export type SettleState =
  | null
  | { error: "signed_out" | "refused" | "other" | FileProblem }
  | { error: "invalid"; lines: string[] }
  | { preview: PreviewView; recorded: boolean };

export async function settleAction(_prev: SettleState, form: FormData): Promise<SettleState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const statement = await statementOf(form.get("statement"));
  if ("problem" in statement) return { error: statement.problem };
  let recorded = false;
  try {
    if (form.get("intent") === "record") {
      await runCommand(await appPool(), session, "settlement.import", statement);
      recorded = true;
      revalidatePath("/app/settlements");
    }
    // The preview after a record reads the books as they now stand: every line it wrote reads as already recorded.
    return { preview: previewView(await page(session, (c) => previewStatement(c, statement))), recorded };
  } catch (err) {
    if (err instanceof CoreError && err.code === "invalid") return { error: "invalid", lines: err.fields ?? [] };
    if (err instanceof CoreError && err.code === "refused") return { error: "refused" };
    return { error: "other" };
  }
}
