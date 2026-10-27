import type { OwnerHome, SourceRef, Supplier } from "./types";

// Synthetic data: a made-up shop, a simulated supplier. Every figure the home shows is a cell in `snapshots`.

const glucose = { en: "Glucose biscuits 70 g", hi: "ग्लूकोज़ बिस्कुट 70 ग्राम" };
const gupta: Supplier = { name: { en: "Gupta Traders", hi: "गुप्ता ट्रेडर्स" }, simulated: true };

const STOCK = "snap_01J9W4K2A7";
const BILLS = "snap_01J9W4K2B3";
const CREDIT = "snap_01J9W4K2C8";
const REORDER = "snap_01J9W4K2D1";

const stockLedger = { en: "Stock ledger", hi: "स्टॉक बही" };
const shelfPhoto = { en: "Shelf photo", hi: "शेल्फ़ फ़ोटो" };
const guptaBill = { en: "Gupta Traders' bill", hi: "गुप्ता ट्रेडर्स का बिल" };
const creditBook = { en: "Credit book", hi: "उधार खाता" };
const reorderSum = { en: "Reorder calculation", hi: "ऑर्डर का हिसाब" };

const ref = (label: SourceRef["label"], snapshotId: string, row: number, col: string): SourceRef => ({
  label,
  snapshotId,
  row,
  col,
});

export const sharmaHome: OwnerHome = {
  shop: { name: { en: "Sharma General Store", hi: "शर्मा जनरल स्टोर" } },
  owner: { greeting: { en: "Ramesh", hi: "रमेश जी" } },
  briefAt: "2026-10-27T07:30:00+05:30",
  snapshots: [
    {
      id: STOCK,
      query: "stock_vs_shelf",
      readAt: "2026-10-27T07:02:00+05:30",
      title: { en: `${glucose.en} · shelf check`, hi: `${glucose.hi} · शेल्फ़ जाँच` },
      columns: [{ key: "item" }, { key: "books", numeric: true }, { key: "shelf", numeric: true }],
      rows: [{ item: { t: "text", v: glucose.en }, books: { t: "int", v: 24 }, shelf: { t: "int", v: 18 } }],
      photo: { takenAt: "2026-10-27T07:02:00+05:30", shelves: ["#####..#", "##...###", "#######."] },
    },
    {
      id: BILLS,
      query: "supplier_bill_lines",
      readAt: "2026-10-27T07:02:00+05:30",
      title: { en: "Butter 100 g · Gupta Traders' bills", hi: "मक्खन 100 ग्राम · गुप्ता ट्रेडर्स के बिल" },
      simulatedSupplier: true,
      columns: [{ key: "bill" }, { key: "bill_date" }, { key: "price", numeric: true }],
      rows: [
        { bill: { t: "text", v: "GT-0412" }, bill_date: { t: "date", v: "2026-10-20" }, price: { t: "money", minor: 5600, currency: "INR" } },
        { bill: { t: "text", v: "GT-0431" }, bill_date: { t: "date", v: "2026-10-27" }, price: { t: "money", minor: 6000, currency: "INR" } },
      ],
    },
    {
      id: CREDIT,
      query: "overdue_credit",
      readAt: "2026-10-27T07:02:00+05:30",
      title: { en: "Customer credit (udhaar) · overdue", hi: "ग्राहक उधार · बकाया" },
      columns: [
        { key: "count", numeric: true },
        { key: "owed", numeric: true },
        { key: "days", numeric: true },
      ],
      rows: [{ count: { t: "int", v: 3 }, owed: { t: "money", minor: 235000, currency: "INR" }, days: { t: "int", v: 30 } }],
    },
    {
      id: REORDER,
      query: "reorder_suggestion",
      readAt: "2026-10-27T07:02:00+05:30",
      title: { en: `Reorder draft · ${glucose.en}`, hi: `दोबारा मँगाने का ड्राफ़्ट · ${glucose.hi}` },
      columns: [{ key: "item" }, { key: "case", numeric: true }, { key: "cases", numeric: true }, { key: "qty", numeric: true }],
      rows: [{ item: { t: "text", v: glucose.en }, case: { t: "int", v: 24 }, cases: { t: "int", v: 2 }, qty: { t: "int", v: 48 } }],
    },
  ],
  findings: [
    {
      kind: "shelf_gap",
      id: "fnd_shelf",
      item: glucose,
      books: ref(stockLedger, STOCK, 1, "books"),
      shelf: ref(shelfPhoto, STOCK, 1, "shelf"),
    },
    {
      kind: "price_rise",
      id: "fnd_butter",
      item: { en: "Butter 100 g", hi: "मक्खन 100 ग्राम" },
      supplier: gupta,
      was: ref(guptaBill, BILLS, 1, "price"),
      now: ref(guptaBill, BILLS, 2, "price"),
    },
    {
      kind: "overdue_credit",
      id: "fnd_credit",
      customers: ref(creditBook, CREDIT, 1, "count"),
      owed: ref(creditBook, CREDIT, 1, "owed"),
      days: ref(creditBook, CREDIT, 1, "days"),
    },
  ],
  unverified: [
    {
      what: { en: "UPI received yesterday", hi: "कल आया UPI भुगतान" },
      reason: { en: "the bank statement has not been imported", hi: "बैंक स्टेटमेंट अभी नहीं आया" },
    },
  ],
  draft: {
    id: "drf_reorder_glucose",
    command: "reorder.place",
    item: glucose,
    supplier: gupta,
    qty: ref(reorderSum, REORDER, 1, "qty"),
    mockDecision: { by: "Ramesh Sharma", at: "2026-10-27T07:41:00+05:30" },
  },
};
