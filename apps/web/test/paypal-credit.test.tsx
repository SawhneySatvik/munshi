// PayPal sandbox on the credit book, from the demo shop's books (the PayPal tables are the schema's, the commands and
// reads core's own registries): a member's "Send PayPal link" draft shows on the customer's row with its
// amount as a source chip (the balance cell it cites) and Approve/Reject for a member who may decide; the page stays one
// transaction's worth of reads; every digit on the page is sourced, in both languages.
import { cleanup, render, screen } from "@testing-library/react";
import { proposePaypalLink } from "@munshi/core/paypal";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { CreditBook } from "../components/CreditBook";
import { LangProvider } from "../components/LangProvider";
import { resolveCell } from "../lib/snapshot";
import { loadCredit } from "../lib/server/credit";
import type { Lang } from "../lib/types";
import { type Home, openHome } from "./helpers/home-db";
import { pinDay } from "./helpers/ops-db";
import { fakeMatchMedia, unsourced } from "./helpers/render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
  pinDay();
});
afterAll(async () => {
  vi.useRealTimers();
  await h.close();
});
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("a Send PayPal link draft shows on the customer's row: its amount the balance cell it cites, Approve for the owner, no second Send, labelled PayPal sandbox", async () => {
  const ramesh = h.k.customers.get("Ramesh K.") as string;
  await proposePaypalLink(h.db.app, { session: h.k.manager }, { customerId: ramesh });
  const data = await loadCredit(h.k.owner);
  const panel = data.paypal;
  expect(panel?.canSend).toBe(true);
  const [draft, ...more] = panel?.drafts[ramesh] ?? [];
  expect(more).toEqual([]);
  expect(draft?.command).toBe("paypal.request");
  const amount = draft?.amount ? resolveCell([...data.snapshots, ...(panel?.snapshots ?? [])], draft.amount) : null;
  const owed = data.owing.find((r) => r.customer.id === ramesh);
  const balance = owed ? resolveCell(data.snapshots, owed.balance) : null;
  expect(amount?.t).toBe("money");
  expect(amount).toEqual(balance); // the link asks for exactly the balance the row shows
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <CreditBook data={data} formKey="test-form-key" />
      </LangProvider>,
    );
    expect(screen.getAllByText(/PayPal sandbox/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: lang === "en" ? "Approve" : "मंज़ूर करें" }).length).toBe(1);
    // A link draft waits for Ramesh: no second "Send PayPal link" on his row; nor on Sunita's, whose seeded link PayPal
    // reports paid with the books not showing it yet (db/seed/kirana-paypal.ts); other rows still offer one.
    const send = (who: string) => screen.queryByRole("button", { name: lang === "en" ? `Send a PayPal link to ${who}` : `${who} को PayPal लिंक भेजें` });
    expect(send("Ramesh K.")).toBeNull();
    expect(send("Sunita P.")).toBeNull();
    const held = new Set([ramesh, h.k.customers.get("Sunita P.")]);
    expect(data.owing.filter((r) => !held.has(r.customer.id)).every((r) => send(r.customer.name) !== null)).toBe(true);
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
});
