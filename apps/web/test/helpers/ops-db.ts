// Shared by the counter, credit-book and stock tests: the demo shop as `pnpm dev` builds it (home-db.ts's openHome), the
// clock pinned inside its business day (the seed is as of AS_OF; "today" for the pages is the shop's date now), forms
// built as the browser posts them, and counts read as the app role for "nothing was written".
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { AS_OF, type Home, rows } from "./home-db";

/** 11:00 in the shop's zone on the seed's as_of: the pages' "today" is the seed's day 0 whenever the tests run. */
export function pinDay() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${AS_OF}T11:00:00+05:30`) });
}

// A form as a browser posts it, carrying a fresh idempotency key unless the test names one (lib/server/form-key.ts).
export function formOf(fields: Record<string, string | string[]>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries({ key: randomUUID(), ...fields })) for (const v of [value].flat()) form.append(key, v);
  return form;
}

export const count = async (h: Home, sql: string, params: unknown[] = []) =>
  ((await rows<{ n: string }>(h, `select count(*)::text as n from (${sql}) x`, params))[0] as { n: string }).n;

/** Every book table a command here writes: a refused command must leave all of them as they were. */
export async function bookCounts(h: Home): Promise<Record<string, string>> {
  const tables = ["books.sale", "books.sale_line", "books.payment", "books.credit_entry", "books.stock_move", "books.journal_entry", "books.journal_line"];
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = await count(h, `select 1 from ${t}`);
  return out;
}
