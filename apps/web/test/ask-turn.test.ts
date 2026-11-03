// A saved ask turn is read back from sessionStorage by a hand-written check (lib/ask-turn.ts), so no schema library ships
// to the browser. The check must be exactly as strict as the schema it replaced: the reference schema below is that
// schema, kept here only to compare, and every case must come out the same from both.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { savedTurns } from "../lib/ask-turn";

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
const reference = z.object({
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

const ref = { label: { en: "Sales", hi: "बिक्री" }, snapshotId: "s1", row: 1, col: "amount" };
const snap = {
  id: "s1",
  query: "sales_today",
  readAt: "2026-11-03T10:00:00Z",
  title: { en: "Sales", hi: "बिक्री" },
  simulatedSupplier: false,
  columns: [{ key: "amount", numeric: true }, { key: "item" }],
  rows: [
    {
      amount: { t: "money", minor: 25000, currency: "INR" },
      item: { t: "text", v: "Atta" },
      n: { t: "int", v: 3 },
      q: { t: "qty", milli: 1500, unit: "kg" },
      d: { t: "date", v: "2026-11-03" },
      h: { t: "time", v: "10:00" },
      z: { t: "null" },
    },
  ],
};
const good = {
  id: "t1",
  at: "2026-11-03T10:00:00Z",
  via: "text",
  words: "How much did I sell?",
  reply: { kind: "answer", desk: "keeper", segments: [[{ t: "text", v: "You sold " }, { t: "ref", ref }, { t: "name", v: "Atta" }, { t: "cannot" }]] },
  snapshots: [snap],
  recorded: true,
};
const abstained = { ...good, id: "t2", via: "voice", words: null, reply: { kind: "abstain", missing: ["sales"] }, snapshots: [] };

// Each case changes one thing about a good turn.
const variants: Record<string, unknown> = {
  good,
  abstained,
  "extra keys are dropped": { ...good, extra: 1, snapshots: [{ ...snap, photo: { url: "x" } }] },
  "no simulatedSupplier": { ...good, snapshots: [{ ...snap, simulatedSupplier: undefined }] },
  "null simulatedSupplier": { ...good, snapshots: [{ ...snap, simulatedSupplier: null }] },
  "words missing": { ...good, words: undefined },
  "words a number": { ...good, words: 4 },
  "via unknown": { ...good, via: "photo" },
  "recorded a string": { ...good, recorded: "yes" },
  "id missing": { ...good, id: undefined },
  "reply kind unknown": { ...good, reply: { kind: "other" } },
  "reply desk missing": { ...good, reply: { kind: "answer", segments: [] } },
  "segments not nested": { ...good, reply: { kind: "answer", desk: "k", segments: [{ t: "text", v: "x" }] } },
  "part kind unknown": { ...good, reply: { kind: "answer", desk: "k", segments: [[{ t: "figure", v: "9" }]] } },
  "ref row fractional": { ...good, reply: { kind: "answer", desk: "k", segments: [[{ t: "ref", ref: { ...ref, row: 1.5 } }]] } },
  "ref row past safe integers": { ...good, reply: { kind: "answer", desk: "k", segments: [[{ t: "ref", ref: { ...ref, row: 2 ** 53 } }]] } },
  "ref label half": { ...good, reply: { kind: "answer", desk: "k", segments: [[{ t: "ref", ref: { ...ref, label: { en: "x" } } }]] } },
  "missing a number": { ...abstained, reply: { kind: "abstain", missing: [1] } },
  "cell kind unknown": { ...good, snapshots: [{ ...snap, rows: [{ a: { t: "float", v: 1 } }] }] },
  "money as a string": { ...good, snapshots: [{ ...snap, rows: [{ a: { t: "money", minor: "1", currency: "INR" } }] }] },
  "row an array": { ...good, snapshots: [{ ...snap, rows: [[{ t: "null" }]] }] },
  "column numeric a string": { ...good, snapshots: [{ ...snap, columns: [{ key: "a", numeric: "yes" }] }] },
  "snapshots not an array": { ...good, snapshots: {} },
  "a turn that is a string": "turn",
  "a turn that is null": null,
};

describe("savedTurns", () => {
  test.each(Object.entries(variants))("%s: kept or dropped exactly as the reference schema does", (_name, v) => {
    const json = JSON.stringify([v]);
    const want = reference.safeParse(JSON.parse(json)[0]);
    expect(savedTurns(json)).toEqual(want.success ? [want.data] : []);
  });

  test("good turns are kept whole, bad ones are dropped, the rest of the list stays", () => {
    const got = savedTurns(JSON.stringify([good, { ...good, via: "photo" }, abstained]));
    expect(got.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(got[0]).toEqual(good);
  });

  test("unknown keys are left behind", () => {
    const [t] = savedTurns(JSON.stringify([{ ...good, extra: 1, snapshots: [{ ...snap, photo: { url: "x" } }] }]));
    expect(t).not.toHaveProperty("extra");
    expect(t?.snapshots[0]).not.toHaveProperty("photo");
  });

  test("storage that is not a list of turns reads as none", () => {
    expect(savedTurns(null)).toEqual([]);
    expect(savedTurns("not json")).toEqual([]);
    expect(savedTurns(JSON.stringify({ turns: [good] }))).toEqual([]);
  });
});
