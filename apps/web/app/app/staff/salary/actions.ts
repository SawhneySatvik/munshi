"use server";

// A salary run (BLUEPRINT §8.10) is draft-only: the owner taps "Make the draft", which mints the month's
// salary.preview as the owner and proposes salary.run citing it (its row count; its checks re-read every cell at
// approval, so the draft goes stale if attendance, leave, terms or advances moved). The owner approves it with
// decide(), so the run executes under the approver's identity with its audit entry. Both forms carry their key.
import { decide, mintSnapshot, previewCount, proposeDraft } from "@munshi/core";
import type { ActState } from "../../../../lib/app-types";
import { act, field, idOf, invalid } from "../../../../lib/server/act";
import { appPool } from "../../../../lib/server/db";

const PATH = "/app/staff/salary";
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export async function makeSalaryDraftAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const periodStart = field(form, "start");
    const periodEnd = field(form, "end");
    if (!DAY.test(periodStart) || !DAY.test(periodEnd)) return invalid();
    const pool = await appPool();
    const preview = await mintSnapshot(pool, { kind: "member", session }, "salary.preview", { period_start: periodStart, period_end: periodEnd });
    await proposeDraft(pool, { session }, { command: "salary.run", payload: { periodStart, periodEnd }, basedOn: [previewCount(preview.id)] });
    return undefined;
  });
}

export async function decideSalaryAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, PATH, async (session) => {
    const draftId = idOf(form, "draft");
    const verdict = field(form, "verdict");
    if (!draftId || (verdict !== "approved" && verdict !== "rejected")) return invalid();
    const d = await decide(await appPool(), session, draftId, verdict, verdict === "rejected" ? "not_now" : undefined);
    return d.status === "stale" ? { error: "stale" } : undefined;
  });
}
