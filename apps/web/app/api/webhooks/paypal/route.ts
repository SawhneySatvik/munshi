// PayPal's webhook (D-079, sandbox). On only with the PayPal sandbox keys: in recorded mode every request is a 404, as
// if the route did not exist, and opens no connection.
// - A body over the cap is refused before it is buffered (Content-Length, then a counted read).
// - The five transmission headers (SHA256withRSA, a certificate URL on PayPal's own hosts, a transmission time within
//   the window) and PayPal's own answer to verify-webhook-signature for our PAYPAL_WEBHOOK_ID; anything else is a 404.
//   The certificate URL a request names is never fetched here.
// - A verified INVOICING.INVOICE.PAID whose paid amount cannot be read from the event is read back from PayPal
//   (GET the invoice). A full payment is stored as one ops.payment_event through core (receivePaypalPaid, public pool),
//   once per PayPal event id: never a book row, never a draft, never an actor.
// - Never a 200 for a payment that was not stored and could be: an unknown PayPal id (the link's route may not be
//   written yet) or a database error answers 503, so PayPal retries; a partial or pending payment and another event type
//   answer 200 and are logged by code. A database error is caught and logged as a code only.
// Nothing from the body or the headers is logged.
import { createHash } from "node:crypto";
import { parsePaidEvent, type WebhookHeaders } from "@munshi/adapters/payments";
import { CoreError, log } from "@munshi/core";
import { receivePaypalPaid } from "@munshi/core/paypal";
import { publicPool } from "../../../../lib/server/db.ts";
import { paypalWebhook } from "../../../../lib/server/paypal.ts";

const notFound = () => new Response(null, { status: 404 });
const MAX_BODY = 256_000;
const HEADERS = ["paypal-transmission-id", "paypal-transmission-time", "paypal-transmission-sig", "paypal-cert-url", "paypal-auth-algo"] as const;

// The body, or null past the cap: the declared length first, then a counted read that stops at the cap.
async function capped(request: Request): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY) return null;
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

const answer = (status: number, result: string) => Response.json({ result }, { status });

export async function POST(request: Request): Promise<Response> {
  const paypal = paypalWebhook();
  if (!paypal) return notFound();
  const raw = await capped(request);
  if (!raw || raw.length === 0) return notFound();
  const headers = Object.fromEntries(HEADERS.map((h) => [h, request.headers.get(h)])) as WebhookHeaders;
  if (!(await paypal.verifyWebhook(raw, headers))) return notFound();
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return notFound();
  }
  let paid = parsePaidEvent(payload);
  if (!paid) {
    log("paypal.webhook.ignored", { code: "other_event" });
    return answer(200, "ignored");
  }
  try {
    // The event's own amount, else PayPal's invoice read back.
    if (paid.paidMinor === null || paid.currency === null) {
      const inv = await paypal.invoice(paid.paypalId);
      paid = { ...paid, status: inv.status, paidMinor: inv.paidMinor, currency: inv.currency };
    }
    const result = await receivePaypalPaid(publicPool(), paid, createHash("sha256").update(raw).digest("hex"));
    if (result === "unknown_link") {
      log("paypal.webhook.retry", { code: "unknown_link" }, "warn");
      return answer(503, result);
    }
    if (result === "not_paid") log("paypal.webhook.ignored", { code: "not_paid" });
    return answer(200, result);
  } catch (err) {
    const code = err instanceof CoreError ? err.code : typeof (err as { code?: unknown }).code === "string" ? String((err as { code: string }).code) : "error";
    log("paypal.webhook.retry", { code: /^[a-z0-9_]{1,40}$/.test(code) ? code : "error" }, "error");
    return answer(503, "retry");
  }
}
