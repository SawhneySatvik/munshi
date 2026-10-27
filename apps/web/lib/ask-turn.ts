// The shape of an ask turn kept in the tab's sessionStorage (AskProvider). Storage is the person's to edit and older
// builds wrote other shapes, so a saved turn is parsed before it is shown; one that does not parse is dropped.
import { z } from "zod";
import type { AskTurn } from "./hero-types";

const localized = z.object({ en: z.string(), hi: z.string() });
const sourceRef = z.object({ label: localized, snapshotId: z.string(), row: z.number().int(), col: z.string() });
const cell = z.discriminatedUnion("t", [
  z.object({ t: z.literal("int"), v: z.number() }),
  z.object({ t: z.literal("money"), minor: z.number(), currency: z.string() }),
  z.object({ t: z.literal("qty"), milli: z.number(), unit: z.string() }),
  z.object({ t: z.literal("text"), v: z.string() }),
  z.object({ t: z.literal("date"), v: z.string() }),
  z.object({ t: z.literal("time"), v: z.string() }),
  z.object({ t: z.literal("null") }),
]);
const snapshot = z.object({
  id: z.string(),
  query: z.string(),
  readAt: z.string(),
  title: localized,
  simulatedSupplier: z.boolean().optional(),
  columns: z.array(z.object({ key: z.string(), numeric: z.boolean().optional() })),
  rows: z.array(z.record(z.string(), cell)),
});
const part = z.discriminatedUnion("t", [
  z.object({ t: z.literal("text"), v: z.string() }),
  z.object({ t: z.literal("ref"), ref: sourceRef }),
  z.object({ t: z.literal("name"), v: z.string() }),
  z.object({ t: z.literal("cannot") }),
]);

const turn = z.object({
  id: z.string(),
  at: z.string(),
  via: z.enum(["text", "voice"]),
  words: z.string().nullable(),
  reply: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("answer"), desk: z.string(), segments: z.array(z.array(part)) }),
    z.object({ kind: z.literal("abstain"), missing: z.array(z.string()) }),
  ]),
  snapshots: z.array(snapshot),
  recorded: z.boolean(),
});

/** The turns in a stored JSON string that parse; anything else (not an array, a malformed turn) is dropped. */
export function savedTurns(json: string | null): AskTurn[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const ok = turn.safeParse(t);
    return ok.success ? [ok.data as AskTurn] : [];
  });
}
