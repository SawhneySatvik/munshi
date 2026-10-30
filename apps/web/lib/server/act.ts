// What every BP-APP server action shares: the person from sessionFrom() alone (never the form), the form's idempotency
// key required (lib/server/form-key.ts) and passed to core's runCommand, a refusal in the screen's own words, and the
// page revalidated after a write, so it renders the books as they now stand with a fresh key for the next form.
import { runCommand, type Session } from "@munshi/core";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import type { ActState } from "../app-types";
import { appPool } from "./db";
import { keyOf } from "./form-key";
import { errorOf } from "./ops";
import { sessionFrom } from "./session";

export type Act = (session: Session, key: string) => Promise<ActState | undefined>;

/** Runs `fn` as the signed-in member with the form's key, then revalidates `path`. A form without a key is refused. */
export async function act(form: FormData, path: string, fn: Act): Promise<ActState> {
  const session = await sessionFrom(await cookies());
  if (!session) return { error: "signed_out" };
  const key = keyOf(form);
  if (!key) return { error: "other" };
  let out: ActState | undefined;
  try {
    out = await fn(session, key);
  } catch (err) {
    return { error: errorOf(err) };
  }
  revalidatePath(path);
  return out ?? { done: true };
}

/** A person's own direct command, under the form's key. */
export const command = async (session: Session, name: string, input: unknown, key: string) => runCommand(await appPool(), session, name, input, key);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A form field as text, trimmed; "" when absent. */
export const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** A form field that must be an id. */
export const idOf = (form: FormData, name: string) => {
  const v = field(form, name);
  return UUID.test(v) ? v : null;
};

/** A calendar day (YYYY-MM-DD), or null. */
export const dayOf = (form: FormData, name: string) => {
  const v = field(form, name);
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) ? v : null;
};

/** A whole number typed into a field, within bounds, or null. */
export const wholeOf = (form: FormData, name: string, min: number, max: number) => {
  const v = field(form, name);
  if (!/^[0-9]{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

/** A refusal before the books: the action's own check failed, nothing was sent to core. */
export const invalid = (): ActState => ({ error: "invalid" });
