// The PayPal desk (collections on AG Grid), on the demo shop as `pnpm dev` builds it, with its PayPal step: Neha J.
// owes past due, Sunita P.'s link is paid on PayPal and not yet in the books (db/seed/kirana-paypal.ts). What is proved:
//   - the read: every figure a row carries is a ref to a stored cell the page ships, the balance the very cell the
//     credit book shows, the link's amount the cell it was drafted for, the days late the overdue finding's own cell;
//   - a figure cell in the grid renders its cell's value and, tapped, opens the source drawer at that cell;
//   - a row action drafts (a PayPal link, a reminder) and writes no book row;
//   - Approve shows only where the member's role may decide: counter staff get no desk at all (404), and their decide
//     is refused with the draft left waiting;
//   - every digit on the page is sourced, in both languages, and English shows no Devanagari.
import { proposePaypalLink } from "@munshi/core/paypal";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { deskDecideAction, deskLinkAction, deskRemindAction } from "../app/app/paypal/actions";
import PaypalDeskRoute from "../app/app/paypal/page";
import { LangProvider } from "../components/LangProvider";
import { PaypalDesk } from "../components/paypal-desk/PaypalDesk";
import { DRAWER_ID } from "../components/Sources";
import { loadCredit } from "../lib/server/credit";
import { loadPaypalDesk } from "../lib/server/paypal-desk";
import type { PaypalDesk as Desk } from "../lib/paypal-desk";
import { formatTableCell, resolveCell, resolveNumber } from "../lib/snapshot";
import type { Lang, SourceRef } from "../lib/types";
import { NotFound } from "./helpers/app-state";
import { type Home, openHome, rows, signInAs } from "./helpers/home-db";
import { bookCounts, formOf, pinDay } from "./helpers/ops-db";
import { fakeMatchMedia, unsourced } from "./helpers/render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
  pinDay();
}, 240_000);
afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const customer = (name: string) => h.k.customers.get(name) as string;
const staff = () => h.k.staff[0] as NonNullable<Home["k"]["staff"][0]>;
const show = (data: Desk, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <PaypalDesk data={data} formKey="test-form-key" />
    </LangProvider>,
  );
const rowOf = (data: Desk, id: string) => data.rows.find((r) => r.customer.id === id);
const gridRow = async (id: string) => (await screen.findAllByRole("row")).find((r) => r.getAttribute("row-id") === id) as HTMLElement;
const linkDrafts = (id: string) =>
  rows<{ id: string }>(h, "select id::text from approval.draft where command = 'paypal.request' and status = 'proposed' and payload ->> 'customerId' = $1", [id]);

test("the read: each row's figures are refs to stored cells the page carries, the balance the credit book's own cell", async () => {
  const data = (await loadPaypalDesk(h.k.owner)) as Desk;
  const credit = await loadCredit(h.k.owner);
  expect(data.rows.length).toBeGreaterThanOrEqual(3);
  const cell = (ref: SourceRef | null) => (ref ? resolveCell(data.snapshots, ref) : undefined);
  for (const r of data.rows) {
    const owed = credit.owing.find((o) => o.customer.id === r.customer.id);
    if (!owed) {
      expect(r.balance).toBeNull(); // here only for a link: owes nothing, shown in words
      continue;
    }
    expect(cell(r.balance)?.t).toBe("money");
    expect(cell(r.balance)).toEqual(resolveCell(credit.snapshots, owed.balance));
    if (r.days) expect(cell(r.days)?.t).toBe("int");
  }
  // Sunita P.: her link is paid on PayPal, not yet in the books; its amount is the cell the link was drafted for.
  const sunita = rowOf(data, customer("Sunita P.")) as NonNullable<ReturnType<typeof rowOf>>;
  expect(sunita.state).toBe("paid");
  expect(sunita.unrecorded).not.toBeNull();
  expect(sunita.canRemind).toBe(false); // she has paid: no reminder chases her
  expect(cell(sunita.linkAmount)?.t).toBe("money");
  // A late customer the morning check flagged: their days late is the finding's own cell, and the reminder is offered.
  const flagged = data.rows.filter((r) => r.days !== null);
  expect(flagged.length).toBeGreaterThan(0);
  expect(flagged.every((r) => r.late && r.findingId !== null)).toBe(true);
  // The brief's overdue total: two cells of credit.overdue_total.
  expect(cell(data.total?.overdue ?? null)?.t).toBe("money");
  expect(cell(data.total?.customers ?? null)?.t).toBe("int");
  expect(data.snapshots.find((s) => s.id === data.total?.overdue.snapshotId)?.query).toBe("credit.overdue_total");
});

test("a figure in the grid renders from its cell, and tapping it opens the source drawer at that cell", async () => {
  const data = (await loadPaypalDesk(h.k.owner)) as Desk;
  const ramesh = rowOf(data, customer("Ramesh K.")) as NonNullable<ReturnType<typeof rowOf>>;
  const ref = ramesh.balance as SourceRef;
  const value = resolveNumber(data.snapshots, ref) as string;
  show(data);
  const row = await gridRow(ramesh.customer.id);
  // The first chip in the Owes cell is the balance (the overdue amount sits under it).
  const [owes] = within(row.querySelector('[col-id="owes"]') as HTMLElement).getAllByRole("button", { name: `${value}, source: Credit book` });
  if (!owes) throw new Error("test: no balance chip");
  expect(owes.querySelector(".amt")?.textContent).toBe(value);
  fireEvent.click(owes);
  const drawer = document.getElementById(DRAWER_ID) as HTMLElement;
  expect(drawer.className).toContain("is-open");
  const at = within(drawer).getByRole("cell", { current: true });
  expect(at.textContent).toBe(formatTableCell(resolveCell(data.snapshots, ref)));
  expect(at.closest("tr")?.firstElementChild?.textContent).toBe(String(ref.row));
});

test("Draft PayPal link from a row drafts it for approval and writes no book row; Draft reminder the same", async () => {
  const data = (await loadPaypalDesk(h.k.owner)) as Desk;
  const target = data.rows.find((r) => r.canLink && r.customer.id !== customer("Ramesh K."));
  if (!target) throw new Error("test: no row offers a PayPal link");
  const before = await bookCounts(h);
  const links = await rows<{ n: string }>(h, "select count(*)::text as n from ops.paypal_link");
  show(data);
  const row = await gridRow(target.customer.id);
  fireEvent.click(within(row).getByRole("button", { name: `Draft a PayPal link for ${target.customer.name}` }));
  await screen.findByText(/Drafted: it waits for approval/, {}, { timeout: 30_000 });
  expect(await linkDrafts(target.customer.id)).toHaveLength(1);
  expect(await bookCounts(h)).toEqual(before);
  expect(await rows<{ n: string }>(h, "select count(*)::text as n from ops.paypal_link")).toEqual(links);

  // A reminder, from the open overdue finding the row cites: a customer.remind draft, still nothing in the books.
  const late = data.rows.find((r) => r.canRemind && r.findingId);
  if (!late) throw new Error("test: no row offers a reminder");
  const result = await deskRemindAction(null, formOf({ finding: late.findingId as string }));
  expect(result).toEqual({ note: "fixDrafted", ok: true });
  const reminders = await rows<{ status: string }>(
    h,
    "select status from approval.draft where command = 'customer.remind' and payload ->> 'customerId' = $1 and payload ->> 'template' = 'credit_due'",
    [late.customer.id],
  );
  expect(reminders.map((r) => r.status)).toEqual(["proposed"]);
  expect(await bookCounts(h)).toEqual(before);
  // The desk now shows it waiting in the tray, and offers no second one.
  const after = rowOf((await loadPaypalDesk(h.k.owner)) as Desk, late.customer.id);
  expect(after?.reminder).toEqual({ status: "waiting" });
  expect(after?.canRemind).toBe(false);
});

test("Approve shows only for a member whose role may decide: the owner sees it; counter staff get no desk and their decide is refused", async () => {
  const ramesh = customer("Ramesh K.");
  if (!(await linkDrafts(ramesh)).length) await proposePaypalLink(h.db.app, { session: h.k.manager }, { customerId: ramesh });
  const [draft] = await linkDrafts(ramesh);

  const data = (await loadPaypalDesk(h.k.owner)) as Desk;
  expect(rowOf(data, ramesh)?.state).toBe("draft");
  show(data);
  const row = await gridRow(ramesh);
  expect(within(row).getByRole("button", { name: "Approve for Ramesh K." })).toBeTruthy();
  cleanup();

  // Counter staff: no desk (the page answers 404), and posting a decision anyway is refused, the draft still waiting.
  expect(await loadPaypalDesk(staff())).toBeNull();
  signInAs(staff());
  await expect(PaypalDeskRoute()).rejects.toBeInstanceOf(NotFound);
  const before = await bookCounts(h);
  expect(await deskDecideAction(null, formOf({ draft: draft?.id as string, verdict: "approved" }))).toEqual({ error: "refused" });
  const open = data.rows.find((r) => r.canLink);
  if (!open) throw new Error("test: no row offers a PayPal link");
  expect(await deskLinkAction(null, formOf({ customer: open.customer.id }))).toEqual({ error: "refused" });
  expect((await rows<{ status: string }>(h, "select status from approval.draft where id = $1", [draft?.id]))[0]?.status).toBe("proposed");
  expect(await bookCounts(h)).toEqual(before);
});

test("every digit on the desk is sourced, in both languages; English shows no Devanagari", async () => {
  const data = (await loadPaypalDesk(h.k.owner)) as Desk;
  for (const lang of ["en", "hi"] as Lang[]) {
    show(data, lang);
    await gridRow(data.rows[0]?.customer.id as string);
    expect(screen.getAllByText(/PayPal sandbox/).length).toBeGreaterThan(0);
    expect(unsourced(document.body)).toEqual([]);
    if (lang === "en") expect(document.body.textContent).not.toMatch(/[ऀ-ॿ]/);
    cleanup();
  }
});
