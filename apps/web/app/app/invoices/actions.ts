"use server";

// GST: the registration (tax.registration.set, the owner's: the scheme, a GSTIN, the state and the
// branch's invoice series) and a credit note (sale.reverse of the invoice's sale, owner or manager: the reversal writes
// the credit note in its own series in the same transaction). Each is the signed-in member's own direct command under
// the form's key. A cancellation is a credit note, never an edit.
import type { ActState } from "../../../lib/app-types";
import { act, command, field, idOf, invalid } from "../../../lib/server/act";

export async function registerAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/invoices", async (session, key) => {
    const scheme = field(form, "scheme");
    const gstin = field(form, "gstin").toUpperCase();
    const stateCode = field(form, "state");
    const series = field(form, "series").toUpperCase();
    const shopId = idOf(form, "shop");
    if (!["regular", "composition", "unregistered"].includes(scheme) || !/^[0-9]{2}$/.test(stateCode) || !shopId || !/^[A-Z0-9]{1,8}$/.test(series)) return invalid();
    if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return invalid();
    await command(session, "tax.registration.set", { scheme, ...(gstin ? { gstin } : {}), stateCode, shops: [{ shopId, invoiceSeries: series }] }, key);
    return undefined;
  });
}

export async function creditNoteAction(_prev: ActState, form: FormData): Promise<ActState> {
  const invoice = idOf(form, "invoice");
  return act(form, invoice ? `/app/invoices/${invoice}` : "/app/invoices", async (session, key) => {
    const saleId = idOf(form, "sale");
    const reason = field(form, "reason");
    if (!saleId || !["returned_goods", "entered_in_error", "customer_cancelled"].includes(reason)) return invalid();
    await command(session, "sale.reverse", { saleId, reason }, key);
    return undefined;
  });
}
