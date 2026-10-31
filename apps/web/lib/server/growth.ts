// The growth page (server only, Paytm edition): core's viewGrowth mints five reads as the signed-in member in the page's
// one transaction; every figure is a ref into those snapshots and nothing is added up here. Names stay plain text; the
// weekday and the payment method are words, not figures. Owners and managers only (the null case is a 404).
import { type Session, type StoredSnapshot, viewGrowth } from "@munshi/core";
import type { Localized, Snapshot, SourceRef } from "../types";
import { frame, type Minted, mintedAs, page, refTo, textOf } from "./ops";

const book = (en: string, hi: string): Localized => ({ en, hi });

export type GrowthPage = {
  shop: string;
  peak: { weekday: string; hour: SourceRef; bills: SourceRef; total: SourceRef }[];
  customers: Record<"customers" | "newCustomers" | "repeatCustomers" | "namedBills" | "anonymousBills", SourceRef> | null;
  basket: { weekFrom: SourceRef; bills: SourceRef; average: SourceRef | null; trend: string }[];
  slow: { item: string; onHand: SourceRef; lastSold: SourceRef | null }[];
  mix: { method: string; payments: SourceRef; amount: SourceRef; share: SourceRef }[];
  snapshots: Snapshot[];
};

export async function loadGrowth(session: Session): Promise<GrowthPage | null> {
  const v = await page(session, (c) => viewGrowth(c, session));
  const floor = frame(v.viewer);
  if (!floor.may.has("settlement.import")) return null; // the commands an owner or a manager holds, as the settlements page gates
  const m = (s: StoredSnapshot, en: string, hi: string, cols: string[]): Minted => mintedAs(s, book(en, hi), cols);
  const peak = m(v.peak, "Growth · busiest hours", "बढ़त · व्यस्त घंटे", ["weekday", "hour", "bills", "total"]);
  const cust = m(v.customers, "Growth · customers", "बढ़त · ग्राहक", ["customers", "new_customers", "repeat_customers", "named_bills", "anonymous_bills"]);
  const basket = m(v.basket, "Growth · average basket", "बढ़त · औसत टोकरी", ["week_from", "bills", "total", "average", "trend"]);
  const slow = m(v.slow, "Growth · slow movers", "बढ़त · धीमा माल", ["item", "on_hand", "last_sold_on"]);
  const mix = m(v.mix, "Growth · payment mix", "बढ़त · भुगतान का तरीक़ा", ["method", "payments", "amount", "share_bp"]);
  const ref = (x: Minted, row: number, col: string) => refTo(x, row, col, x.snapshot.title);
  return {
    shop: floor.shop,
    peak: peak.cells.map((row, i) => ({
      weekday: textOf(row.weekday),
      hour: ref(peak, i, "hour"),
      bills: ref(peak, i, "bills"),
      total: ref(peak, i, "total"),
    })),
    customers: cust.cells.length
      ? {
          customers: ref(cust, 0, "customers"),
          newCustomers: ref(cust, 0, "new_customers"),
          repeatCustomers: ref(cust, 0, "repeat_customers"),
          namedBills: ref(cust, 0, "named_bills"),
          anonymousBills: ref(cust, 0, "anonymous_bills"),
        }
      : null,
    basket: basket.cells.map((row, i) => ({
      weekFrom: ref(basket, i, "week_from"),
      bills: ref(basket, i, "bills"),
      average: row.average?.kind === "money" ? ref(basket, i, "average") : null,
      trend: textOf(row.trend),
    })),
    slow: slow.cells.map((row, i) => ({
      item: textOf(row.item),
      onHand: ref(slow, i, "on_hand"),
      lastSold: row.last_sold_on?.kind === "date" ? ref(slow, i, "last_sold_on") : null,
    })),
    mix: mix.cells.map((row, i) => ({
      method: textOf(row.method),
      payments: ref(mix, i, "payments"),
      amount: ref(mix, i, "amount"),
      share: ref(mix, i, "share_bp"),
    })),
    snapshots: [peak, cust, basket, slow, mix].map((x) => x.snapshot),
  };
}
