// The day report on the kirana seed: every figure is a cell of the period's sales.by_day / sales.by_item snapshot, the
// cells hold what the journal says the counter took (an independent read of the books), every digit on the page sits
// in a figure, a name or a time, in English and Hindi, and the week's chart plots only cells.
import { cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ReportView } from "../components/books/ReportView";
import type { ReportPage } from "../lib/books";
import { loadReport } from "../lib/server/reports";
import type { Lang } from "../lib/types";
import { one, renderPage, storedValue } from "./books-render";
import { AS_OF, type Home, openHome } from "./home-db";
import { DIGIT, fakeMatchMedia, unsourced } from "./render";

const YESTERDAY = "2026-10-26";
const WEEK_FROM = "2026-10-21";
const BEST = 10;

type Day = { bills: number; total: number; cash: number; upi: number; card: number; on_credit: number };
// What the journal holds for the counter's sales on a business day: one entry per sale, the sales account credited
// with its total, each tender's account debited, the rest to receivable (udhaar).
const JOURNAL_DAY = `
  select count(distinct e.id)::int as bills,
         coalesce(-sum(l.amount_minor) filter (where l.account = 'sales'), 0)::int as total,
         coalesce(sum(l.amount_minor) filter (where l.account = 'cash'), 0)::int as cash,
         coalesce(sum(l.amount_minor) filter (where l.account = 'upi_clearing'), 0)::int as upi,
         coalesce(sum(l.amount_minor) filter (where l.account = 'card_clearing'), 0)::int as card,
         coalesce(sum(l.amount_minor) filter (where l.account = 'receivable'), 0)::int as on_credit
    from books.journal_entry e join books.journal_line l on l.tenant_id = e.tenant_id and l.entry_id = e.id
   where e.source_rel = 'books.sale' and e.entry_date = $1`;
const ITEMS_SOLD = `
  select count(distinct sl.item_id)::int as n
    from books.sale_line sl join books.journal_entry e on e.tenant_id = sl.tenant_id and e.source_rel = 'books.sale' and e.source_id = sl.sale_id
   where e.entry_date between $1 and $2`;

let h: Home;
let yesterday: ReportPage;
let week: ReportPage;
let today: ReportPage;
beforeAll(async () => {
  h = await openHome();
  yesterday = await loadReport(h.k.owner, "yesterday");
  week = await loadReport(h.k.owner, "week");
  today = await loadReport(h.k.owner, "today");
});
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const figures = () => [...document.querySelectorAll(".pair")] as HTMLElement[];

describe("yesterday", () => {
  test("its takings, bills and tenders are the journal's, each the period's own cell", async () => {
    expect([yesterday.from, yesterday.to]).toEqual([YESTERDAY, YESTERDAY]);
    const j = await one<Day>(h, JOURNAL_DAY, [YESTERDAY]);
    expect(j.bills).toBeGreaterThan(0);
    expect(j.total).toBeGreaterThan(0);
    const [d] = yesterday.days;
    if (!d) throw new Error("the day has its row");
    const got = Object.fromEntries((["bills", "total", "cash", "upi", "card", "onCredit"] as const).map((k) => [k, storedValue(yesterday.snapshots, d[k])]));
    expect(got).toEqual({ bills: j.bills, total: j.total, cash: j.cash, upi: j.upi, card: j.card, onCredit: j.on_credit });
  });

  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: every digit sits in a figure, a name or a time; one figure per cell shown`, async () => {
      const { n } = await one<{ n: number }>(h, ITEMS_SOLD, [YESTERDAY, YESTERDAY]);
      expect(n).toBeGreaterThan(0);
      renderPage(<ReportView data={yesterday} />, lang);
      // The day's six figures, then three per best seller.
      expect(figures().length).toBe(6 + 3 * Math.min(n, BEST));
      for (const f of figures()) expect(f.querySelector(".amt")?.textContent ?? "").toMatch(DIGIT);
      expect(unsourced(document.body)).toEqual([]);
    });
  }

  test("a figure whose ref lands on no cell shows Cannot verify and no button", () => {
    const broken: ReportPage = structuredClone(yesterday);
    const item = broken.items[0];
    if (!item) throw new Error("a best seller");
    item.revenue = { ...item.revenue, row: 999 };
    renderPage(<ReportView data={broken} />);
    const row = screen.getAllByRole("row").find((r) => r.textContent?.startsWith(item.item)) as HTMLElement;
    expect(within(row).getByText("Cannot verify")).toBeTruthy();
    expect(within(row).getAllByRole("button")).toHaveLength(2); // sold and bills only
  });
});

describe("the week", () => {
  test("seven days to as_of, each the journal's, and the chart plots exactly the seven total cells", async () => {
    expect([week.from, week.to]).toEqual([WEEK_FROM, AS_OF]);
    expect(week.days.map((d) => d.day)).toEqual(["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", AS_OF]);
    for (const d of week.days) {
      const j = await one<Day>(h, JOURNAL_DAY, [d.day]);
      expect([storedValue(week.snapshots, d.total), storedValue(week.snapshots, d.bills)]).toEqual([j.total, j.bills]);
    }
    renderPage(<ReportView data={week} />);
    const bars = [...document.querySelectorAll(".bk-colbar")] as HTMLElement[];
    expect(bars).toHaveLength(7);
    const totals = week.days.map((d) => storedValue(week.snapshots, d.total) as number);
    const tallest = Math.max(...totals);
    expect(tallest).toBeGreaterThan(0);
    bars.forEach((bar, i) => {
      // Each bar's height is its own cell over the tallest cell, and it reads as that cell.
      const share = Number((bar.querySelector(".bk-bar-fill") as HTMLElement).style.getPropertyValue("--h"));
      expect(share).toBeCloseTo((totals[i] as number) / tallest, 10);
    });
    expect(document.querySelectorAll(".bk-colbar.is-peak")).toHaveLength(1);
  });

  test("the week's total row is sales.week_total, equal to the seven days' journal totals, and shown", async () => {
    let bills = 0;
    let total = 0;
    for (const d of week.days) {
      const j = await one<Day>(h, JOURNAL_DAY, [d.day]);
      bills += j.bills;
      total += j.total;
    }
    expect(total).toBeGreaterThan(0);
    if (!week.week) throw new Error("the week has its total row");
    expect([storedValue(week.snapshots, week.week.bills), storedValue(week.snapshots, week.week.total)]).toEqual([bills, total]);
    renderPage(<ReportView data={week} />);
    expect(document.querySelector(".bk-week-table tfoot")).toBeTruthy();
  });

  for (const lang of ["en", "hi"] as Lang[]) {
    test(`${lang}: no loose digit; seven bars, six figures a day and six for the week, three per best seller`, async () => {
      const { n } = await one<{ n: number }>(h, ITEMS_SOLD, [WEEK_FROM, AS_OF]);
      renderPage(<ReportView data={week} />, lang);
      expect(figures().length).toBe(7 + 7 * 6 + 6 + 3 * Math.min(n, BEST)); // the days, then the week's own row
      expect(unsourced(document.body)).toEqual([]);
    });
  }
});

test("today, before the counter opens: zero from the books, said so, and still every figure a cell", async () => {
  const j = await one<Day>(h, JOURNAL_DAY, [AS_OF]);
  expect(j.bills).toBe(0);
  const [d] = today.days;
  if (!d) throw new Error("today has its row");
  expect(storedValue(today.snapshots, d.bills)).toBe(0);
  renderPage(<ReportView data={today} />);
  expect(screen.getByText("No sale is recorded for this day yet.")).toBeTruthy();
  expect(screen.getByText("Nothing sold in this period yet.")).toBeTruthy();
  expect(unsourced(document.body)).toEqual([]);
});

test("the counter staff read the same report (reads are not a command), and payments are said to be recorded only", async () => {
  const staff = await loadReport(h.k.staff[0] as typeof h.k.owner, "yesterday");
  expect(staff.days.map((d) => storedValue(staff.snapshots, d.total))).toEqual(yesterday.days.map((d) => storedValue(yesterday.snapshots, d.total)));
  expect(staff.member.role).toBe("staff");
  renderPage(<ReportView data={staff} />);
  expect(document.body.textContent).toContain("Payments are recorded, never processed.");
});
