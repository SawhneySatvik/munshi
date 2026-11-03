"use server";

// A person's moves on a finding, from Home's brief and the office's brief lines. The person always
// comes from sessionFrom(), never the form; the form names finding ids, or a card (`card`: Home's overdue card, which
// stands for every open finding of its kind, read on the server so there is no cap on how many). "Why?" asks the
// finding's desk (or explains the card's own figure); "Draft the fix" runs the kind's recipe for each finding into a draft
// that waits in the tray for someone allowed to approve it; Snooze and Dismiss are core's ops moves, an owner's or a
// manager's, all of a card's findings in one transaction. None of them writes a book.
import { CoreError, DISMISS_REASONS, type DismissReason, dismissFinding, openFindingIds, type Session, snoozeFinding } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { AgentNote, AgentState } from "../../../lib/agent-types";
import { appPool } from "../../../lib/server/db";
import { isFeatureOff } from "../../../lib/server/agent-port";
import { fixFindings, whyCard, whyFinding } from "../../../lib/server/hero";
import { sessionFrom } from "../../../lib/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Explicit ids are one row's (a finding, or a few); a card's are read on the server.
const MAX_IDS = 50;
// The kinds a card may stand for.
const CARDS = new Set(["overdue_credit"]);

type Target = { ids: string[]; card: string | null };

async function targetOf(form: FormData, session: Session): Promise<Target | null> {
  const card = form.get("card");
  if (typeof card === "string" && card !== "") {
    if (!CARDS.has(card)) return null;
    const ids = await openFindingIds(await appPool(), session, card);
    return ids.length ? { ids, card } : null;
  }
  const ids = form.getAll("finding").filter((v): v is string => typeof v === "string");
  return ids.length > 0 && ids.length <= MAX_IDS && ids.every((id) => UUID.test(id)) ? { ids: [...new Set(ids)], card: null } : null;
}

const note = (n: AgentNote, ok: boolean): AgentState => ({ note: n, ok });
const refusal = (err: unknown): AgentState => note(err instanceof CoreError && err.code === "refused" ? "errStaff" : "errOther", false);

const settled = () => {
  revalidatePath("/app");
  revalidatePath("/app/office");
};

async function signedIn(form: FormData): Promise<{ session: Session; target: Target } | AgentState> {
  const session = await sessionFrom(await cookies());
  if (!session) return note("errSignedOut", false);
  const target = await targetOf(form, session);
  return target ? { session, target } : note("errOther", false);
}

export async function whyAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const who = await signedIn(form);
  if (!who || !("session" in who)) return who;
  try {
    const { session, target } = who;
    return { turn: target.card ? await whyCard(session, target.card, target.ids) : await whyFinding(session, target.ids[0] as string) };
  } catch (err) {
    return note(isFeatureOff(err) ? "errSwitchedOff" : "errOther", false);
  }
}

export async function fixAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const who = await signedIn(form);
  if (!who || !("session" in who)) return who;
  try {
    // "Offer it" names the recipient the person picked (an id the recipe looks up among the shop's own); overdue udhaar's
    // second fix names PayPal (a PayPal link, sandbox, instead of the reminder); none otherwise.
    const recipient = form.get("recipient");
    const choice =
      typeof recipient === "string" && UUID.test(recipient) ? { recipientId: recipient } : form.get("fix") === "paypal" ? { fix: "paypal" as const } : undefined;
    const out = await fixFindings(who.session, who.target.ids, choice);
    const made = out.filter((o) => o.kind === "proposed").length;
    // Each finding is its own draft: say honestly when some were drafted and some were not.
    if (made > 0) return note(made === out.length ? "fixDrafted" : out.some((o) => o.kind === "none" && o.reason === "paypal_busy") ? "fixPaypalSome" : "fixSome", true);
    const first = out[0];
    return note(first?.kind === "none" ? `fix_${first.reason}` : "errOther", false);
  } catch {
    return note("errOther", false);
  } finally {
    settled();
  }
}

const SNOOZE: Record<string, 1 | 3 | 7> = { "1": 1, "3": 3, "7": 7 };

export async function snoozeAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const days = SNOOZE[String(form.get("days"))];
  if (!days) return note("errOther", false);
  const who = await signedIn(form);
  if (!who || !("session" in who)) return who;
  try {
    await snoozeFinding(await appPool(), who.session, who.target.ids, days);
  } catch (err) {
    return refusal(err);
  } finally {
    settled();
  }
  return note("snoozed", true);
}

export async function dismissAction(_prev: AgentState, form: FormData): Promise<AgentState> {
  const reason = String(form.get("reason")) as DismissReason;
  if (!DISMISS_REASONS.includes(reason)) return note("errOther", false);
  const who = await signedIn(form);
  if (!who || !("session" in who)) return who;
  try {
    await dismissFinding(await appPool(), who.session, who.target.ids, reason);
  } catch (err) {
    return refusal(err);
  } finally {
    settled();
  }
  return note("dismissed", true);
}
