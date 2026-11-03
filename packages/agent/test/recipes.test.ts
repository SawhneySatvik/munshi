// The recipes and the desks on their own (BLUEPRINT §7.5, §7.2). Each recipe's draft cites only cells: the finding's own
// row, or row 0 of a current-state read it minted (the stand-in read below answers at the system boundary; the database
// checks of the same drafts are db/test/v2/core/recipes). A package lapsing with value left drafts a reminder before its
// expiry and package.expire after it; a kind with no recipe gets none. The desks registry covers every capability.
import type { Cell, CellRef } from "@munshi/core/read";
import { formatRef } from "@munshi/core/read";
import { describe, expect, it } from "vitest";
import { DESK_REGISTRY, desksOpen, NO_DESK } from "../src/desks.ts";
import type { FindingRow } from "../src/port.ts";
import { RECIPES, type Recipe } from "../src/recipes.ts";

const HOLDING = "9a1b2c3d-0000-4000-8000-00000000000a";
const CUSTOMER = "9a1b2c3d-0000-4000-8000-00000000000b";
const t = (txt: string): Cell => ({ kind: "text", txt });
const int = (n: number): Cell => ({ kind: "integer", num: String(n) });
const money = (n: number): Cell => ({ kind: "money", num: String(n), currency: "INR" });

const finding = (daysLeft: number): FindingRow => ({
  id: "9a1b2c3d-0000-4000-8000-00000000000c",
  kind: "package_expiry",
  snapshotId: "9a1b2c3d-0000-4000-8000-00000000000d",
  row: 2,
  cells: { holding_id: t(HOLDING), customer_id: t(CUSTOMER), expires_on: { kind: "date", day: "2026-11-08" }, days_left: int(daysLeft), value_left: money(200_000), sessions_left: int(5) },
  status: "open",
  current: true,
  openDraft: false,
});

const BALANCE = "9a1b2c3d-0000-4000-8000-00000000000e";
const reads: { query: string; params: Record<string, unknown> }[] = [];
const read = async (query: string, params: Record<string, unknown>) => {
  reads.push({ query, params });
  return { snapshotId: BALANCE, rows: [{ holding_id: t(HOLDING), value_left: money(200_000), sessions_left: int(5) }] };
};
const ref = (snapshotId: string, row: number, col: string): CellRef => ({ snapshotId, row, col });
const packageFix = RECIPES.package_expiry as Recipe;

describe("RECIPE package expiry", () => {
  it("RECIPE before its expiry date: a package_expiring reminder whose figure is the holding's current value_left cell", async () => {
    reads.length = 0;
    const made = await packageFix(finding(10), read);
    expect(reads).toEqual([{ query: "package.balance", params: { holding_id: HOLDING } }]);
    expect(made).toEqual({
      command: "customer.remind",
      payload: { customerId: CUSTOMER, template: "package_expiring", figure: formatRef(ref(BALANCE, 0, "value_left")) },
      payloadRefs: {},
      basedOn: [ref(finding(10).snapshotId, 2, "holding_id"), ref(finding(10).snapshotId, 2, "value_left"), ref(finding(10).snapshotId, 2, "expires_on"), ref(BALANCE, 0, "value_left")],
    });
  });

  it("RECIPE after it: package.expire for the holding, citing the same current cell", async () => {
    const made = await packageFix(finding(-3), read);
    expect(made).toMatchObject({ command: "package.expire", payload: { holdingId: HOLDING }, payloadRefs: {} });
    expect((made as { basedOn: CellRef[] }).basedOn).toContainEqual(ref(BALANCE, 0, "value_left"));
  });

  it("RECIPE only the planned kinds have a recipe; the rest are explained only", () => {
    expect(Object.keys(RECIPES).sort()).toEqual(["expiry", "overdue_credit", "package_expiry", "paypal_unrecorded", "shrinkage"]); // expiry: Offer it (W2-B); paypal_unrecorded: record this payment (D-079)
  });
});

// ref.capability's 21 codes (BLUEPRINT §2.5, 01_ref.sql's seed), written out here so the registry is checked against
// the spec rather than against itself.
const CAPABILITIES = [
  "counter", "credit", "stock", "buying", "orders", "stitching", "bookings", "holds", "cart", "offers", "loyalty", "packages",
  "messaging", "campaigns", "staff", "salary", "gst", "site", "api", "ai", "variants",
];

describe("DESKS", () => {
  it("DESKS every capability is some desk's part or opens none, each exactly once in that sense; seven desks", () => {
    expect(CAPABILITIES).toHaveLength(21);
    const parts = new Set(Object.values(DESK_REGISTRY).flatMap((d) => d.parts.map(([, cap]) => cap as string)));
    for (const cap of CAPABILITIES) expect(parts.has(cap) !== (NO_DESK as readonly string[]).includes(cap), cap).toBe(true);
    expect([...parts].filter((cap) => !CAPABILITIES.includes(cap))).toEqual([]);
    expect(Object.keys(DESK_REGISTRY)).toEqual(["stock", "sales", "orders", "bookings", "packages", "customers", "staff"]);
    for (const d of Object.values(DESK_REGISTRY)) expect(d.parts.map(([, cap]) => cap), d.title).toContain(d.opens);
  });

  it("DESKS a shop sees the desks its capabilities open, each with only its parts that are on (the kirana's pack, §7.2)", () => {
    const kirana = new Set(["counter", "credit", "stock", "buying", "orders", "offers", "messaging", "staff", "gst", "site", "ai"]);
    expect(desksOpen(kirana).map((d) => d.desk)).toEqual(["stock", "sales", "orders", "customers", "staff"]);
    expect(desksOpen(kirana).find((d) => d.desk === "stock")?.parts).toEqual(["on_hand", "counts", "expiry", "dead_stock", "bills", "reorders"]);
    expect(desksOpen(kirana).find((d) => d.desk === "staff")?.parts).toEqual(["roster", "attendance", "leave", "advances"]);
  });
});
