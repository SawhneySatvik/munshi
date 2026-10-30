"use server";

// The inbox's one move (BLUEPRINT §8.6): a member marks a message handled or ignored, through core's handleInbound as
// the signed-in member under the form's key (an ops row: who handled it and when are the database's). A STOP is never
// handled here: it is handled only by consent.record beside the withdrawal, and the database refuses it otherwise.
import { handleInbound } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, idOf, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";

export async function handleMessageAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/inbox", async (session) => {
    const messageId = idOf(form, "message");
    const status = field(form, "status");
    if (!messageId || (status !== "handled" && status !== "ignored")) return invalid();
    await handleInbound(await appPool(), session, messageId, status);
    return undefined;
  });
}
