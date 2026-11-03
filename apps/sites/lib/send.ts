// Shared by the site's forms. A write carries one Idempotency-Key per attempt: a retry of the same request reuses it, so
// the API replays its first answer instead of storing a second request; a changed request is a new attempt.
import { MunshiError, newIdempotencyKey } from "@munshi/sdk";

export type Attempt = { key: string; body: string } | null;

export function keyFor(current: Attempt, body: unknown): { key: string; next: Attempt } {
  const text = JSON.stringify(body);
  if (current && current.body === text) return { key: current.key, next: current };
  const key = newIdempotencyKey();
  return { key, next: { key, body: text } };
}

/** The API's error code of a refusal, or undefined for a network failure (then the same attempt is sent again). */
export const codeOf = (err: unknown): string | undefined => (err instanceof MunshiError ? err.code : undefined);

// The bot check: the demo API's recorded verifier passes any non-empty token solved on the page's own origin; a deployed
// site puts the Turnstile widget's token here, behind the same field.
export const BOT_TOKEN = "recorded-bot-check";

/** The contract's phone shape, and at least ten digits. */
export const phoneOk = (raw: string) => /^\+?[0-9][0-9 ()-]{6,22}[0-9]$/.test(raw.trim()) && raw.replace(/\D/g, "").length >= 10;

/** A time as the shop's clock shows it: "4:30 pm". Slot and hold times are roster times, not book figures. */
export const clock = (at: string, lang: "en" | "hi") =>
  new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(at));
