"use server";

// The PayPal desk's moves are the credit book's and the brief's own actions, unchanged: "Draft PayPal link", "Record
// this payment" and "Draft the WhatsApp message" propose drafts, Approve / Reject decide a PayPal draft as the
// signed-in member (decide(), one transaction), and "Draft reminder" runs the overdue finding's recipe into a draft
// that waits in the tray. None writes a book row. Each also refreshes the desk.
import { revalidatePath } from "next/cache";
import type { AgentState } from "../../../lib/agent-types";
import { decidePaypalAction, messagePaypalLinkAction, type PaypalActState, recordPaypalAction, sendPaypalLinkAction } from "../credit/paypal-actions";
import { fixAction } from "../findings/actions";

const desk = <T>(state: T): T => {
  revalidatePath("/app/paypal");
  return state;
};

export async function deskLinkAction(prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  return desk(await sendPaypalLinkAction(prev, form));
}

export async function deskDecideAction(prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  return desk(await decidePaypalAction(prev, form));
}

export async function deskRecordAction(prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  return desk(await recordPaypalAction(prev, form));
}

export async function deskMessageAction(prev: PaypalActState, form: FormData): Promise<PaypalActState> {
  return desk(await messagePaypalLinkAction(prev, form));
}

export async function deskRemindAction(prev: AgentState, form: FormData): Promise<AgentState> {
  return desk(await fixAction(prev, form));
}
