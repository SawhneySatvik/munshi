// A form's idempotency key: each render of a form that runs a command mints a fresh one, and the action passes it
// to core's runCommand, so a double tap, a retried POST or a second tab's resubmission of the same form records once (a
// replay returns the first run's ids; the same key with another body is refused). A successful submit revalidates the
// page, which renders the next form with a new key. An action refuses a form without one.
import { randomUUID } from "node:crypto";

const KEY = /^[A-Za-z0-9_-]{8,128}$/; // core's IDEMPOTENCY_KEY

export const formKey = (): string => randomUUID();

export function keyOf(form: FormData): string | null {
  const key = form.get("key");
  return typeof key === "string" && KEY.test(key) ? key : null;
}
