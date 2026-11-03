// readBill when core refuses the draft because the supplier's bill is already a purchase: the flow returns
// alreadyRecorded (with the purchase, found through bills.recent) instead of throwing. The port is an in-memory stand-in
// at the system boundary; the full path over the database is apps/web/test/hero-bill.test.tsx.
import { readFileSync } from "node:fs";
import type { Cell } from "@munshi/core/read";
import { describe, expect, it } from "vitest";
import { readBill } from "../src/bill.ts";
import type { EvidencePort } from "../src/port.ts";
import { env, json, noSleep, queueFetch, responsesBody } from "./helpers.ts";

const SUPPLIER = "9a1b2c3d-0000-4000-8000-000000000002";
const ITEM = "9a1b2c3d-0000-4000-8000-000000000001";
const PURCHASE = "9a1b2c3d-0000-4000-8000-000000000003";
const t = (txt: string): Cell => ({ kind: "text", txt });
const WORLD: Record<string, Record<string, Cell>[]> = {
  "bill.lines": [
    {
      item_id: t(ITEM),
      bill_no: t("GT-9"),
      bill_date: { kind: "date", day: "2026-10-27" },
      qty: { kind: "quantity", num: "48000", unit: "pack" },
      unit_cost: { kind: "money", num: "850", currency: "INR" },
    },
  ],
  "stock.on_hand": [{ on_hand: { kind: "quantity", num: "10000", unit: "pack" } }],
  "purchases.last_price": [{ unit_cost: { kind: "money", num: "850", currency: "INR" } }],
  "bills.recent": [{ purchase_id: t(PURCHASE), bill_no: t("GT-9"), supplier_id: t(SUPPLIER) }],
};
const place = [10, 10, 20, 20];
const reading = { billNo: "GT-9", billDate: "2026-10-27", lines: [{ text: "Glucose", qty: "48", qtyAt: place, rate: "8.50", rateAt: place }] };

function port(propose: () => Promise<string>, reads: string[] = []): EvidencePort {
  return {
    async read(name) {
      reads.push(name);
      const rows = WORLD[name];
      if (!rows) throw new Error("no such read");
      return { snapshotId: `00000000-0000-4000-8000-${String(reads.length).padStart(12, "0")}`, rows };
    },
    resolve: async () => null,
    propose,
    finding: async () => null,
    trace: () => {},
    recordCount: async () => "count",
    recordBill: async () => "00000000-0000-4000-8000-0000000000aa",
  };
}
const refusal = (fields: string[]) => Object.assign(new Error("conflict"), { code: "conflict", fields });
const photo = new Uint8Array(readFileSync(new URL("../fixtures/media/bill.png", import.meta.url)));
const vision = () => {
  const body = responsesBody({ output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(reading), annotations: [] }] }] });
  return { deps: { mode: "live", env, fetch: queueFetch(json(200, body)).f, sleep: noSleep }, supplierId: SUPPLIER };
};

describe("a bill the books already hold", () => {
  it("is a result, not a throw, and names the recorded purchase", async () => {
    const r = await readBill(photo, { port: port(async () => { throw refusal(["billNo"]); }), ...vision() });
    expect(r).toEqual({ kind: "alreadyRecorded", billNo: "GT-9", purchaseId: PURCHASE });
  });

  it("any other refusal still throws", async () => {
    await expect(readBill(photo, { port: port(async () => { throw refusal(["lines"]); }), ...vision() })).rejects.toThrow("conflict");
  });

  it("a draft that goes through is still a draft", async () => {
    const r = await readBill(photo, { port: port(async () => "draft-1"), ...vision() });
    expect(r).toMatchObject({ kind: "read", draftId: "draft-1" });
  });
});
