// PayPal's wiring in the web app (server only; D-079, sandbox). The keys come through @munshi/config (paypalSettings,
// which names settings, never values): all three set is the live sandbox, none is recorded mode (no PayPal call, every
// screen says so). One adapter per process (so its OAuth token is cached across requests), rebuilt only if the keys
// change. Boot wires it into core's link sweep (wireOutbox calls wirePaypal), so an approved link reaches PayPal from
// the jobs role, never from the approval. The webhook is on only with the sandbox keys. The page's panel is
// paypal-panel.ts.
import { createHash } from "node:crypto";
import { type PayPal, paypalSandbox, recordedPayPal } from "@munshi/adapters/payments";
import { paypalSettings } from "@munshi/config";
import { wirePayPal } from "@munshi/core/paypal";

const held = globalThis as typeof globalThis & { munshiPaypal?: { key: string; adapter: PayPal }; munshiPaypalWired?: boolean };

/** The deploy's PayPal mode: `sandbox` with all three keys, else `recorded`. A partial set throws (names only). */
export const paypalMode = (): "sandbox" | "recorded" => paypalSettings().mode;

/** The process's PayPal adapter: the sandbox one with the keys, else recorded; cached under a hash of the settings. */
export function paypalAdapter(): PayPal {
  const s = paypalSettings();
  const key = s.mode === "sandbox" ? createHash("sha256").update(`${s.clientId}\n${s.clientSecret}\n${s.webhookId}`).digest("hex") : "recorded";
  if (held.munshiPaypal?.key !== key) {
    held.munshiPaypal = { key, adapter: s.mode === "sandbox" ? paypalSandbox({ clientId: s.clientId, clientSecret: s.clientSecret, webhookId: s.webhookId }) : recordedPayPal() };
  }
  return held.munshiPaypal.adapter;
}

/** Wires the PayPal adapter into core's link sweep, once per process. */
export function wirePaypal(): void {
  if (held.munshiPaypalWired) return;
  wirePayPal(paypalAdapter());
  held.munshiPaypalWired = true;
}

/** The webhook's adapter: the sandbox one, or null (recorded mode has no webhook: the route answers 404). */
export function paypalWebhook(): PayPal | null {
  return paypalMode() === "sandbox" ? paypalAdapter() : null;
}
