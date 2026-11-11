// Offers, packages, loyalty, customers and GST invoices on the showcase shops' books, built by core's real paths (Elite's package plans, holdings and two branches;
// Prabhave's Diwali offer and its customers): offers, packages, loyalty, customers and GST invoices. Each screen renders
// from its core view, every figure a <Figure> whose ref lands on a stored cell of the page's own snapshots, no digit on
// it without a source in English or Hindi, and absent (404) once its capability is switched off. Each action writes
// through its command as the signed-in member with the form's key (a replay records once), and refuses a keyless form.
import { cleanup } from "@testing-library/react";
import { recordSale, runCommand, switchCapability, type Session } from "@munshi/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import CustomerPage from "../app/app/customers/[id]/page";
import CustomersPage from "../app/app/customers/page";
import { creditNoteAction, registerAction } from "../app/app/invoices/actions";
import InvoicePage from "../app/app/invoices/[id]/page";
import InvoicesPage from "../app/app/invoices/page";
import { setRuleAction } from "../app/app/loyalty/actions";
import LoyaltyPage from "../app/app/loyalty/page";
import { createOfferAction, endOfferAction } from "../app/app/offers/actions";
import OffersPage from "../app/app/offers/page";
import { createPlanAction, redeemAction } from "../app/app/packages/actions";
import PackagesPage from "../app/app/packages/page";
import { appPool } from "../lib/server/db";
import { navOf } from "../lib/server/ops";
import { dataOf, isAbsent, resolves, sourcedInBoth } from "./helpers/app-render";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia } from "./helpers/render";
import { openShowcase, type Shows, showRows, signInShow } from "./helpers/showcase-db";

let h: Shows;
beforeAll(async () => {
  h = await openShowcase();
}, 300_000);
afterAll(() => h.close());
beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const keyless = (fields: Record<string, string>) => {
  const form = formOf(fields);
  form.delete("key");
  return form;
};
const claimed = async (tenantId: string, key: string) =>
  (await showRows<{ command: string; member_id: string }>(h, tenantId, "select command, split_part(scope, ':', 2) as member_id from ops.idempotency where key = $1", [key]))[0];
/** Switched off, the page answers 404; switched back on afterwards. */
async function offThenOn(owner: Session, cap: Parameters<typeof switchCapability>[2], page: () => Promise<unknown>) {
  await switchCapability(await appPool(), owner, cap, false);
  try {
    await isAbsent(page);
  } finally {
    await switchCapability(await appPool(), owner, cap, true);
  }
}

describe("the navigation", () => {
  test("each shop's capability sections, by role, asked in one transaction (navOf)", async () => {
    const elite = await navOf(h.s.elite.owner);
    expect(elite?.extra).toEqual(expect.arrayContaining(["packages", "loyalty", "calendar", "staff", "salary", "campaigns", "settings"]));
    expect(elite?.extra).not.toContain("orders");
    const prabhave = await navOf(h.s.prabhave.owner);
    expect(prabhave?.extra).toEqual(expect.arrayContaining(["orders", "offers", "invoices", "campaigns"]));
    expect(prabhave?.extra).not.toContain("packages");
    expect((await navOf(h.s.prabhave.counter))?.extra).toEqual(["chat"]); // of the extra sections, only their own chat link
  });
});

describe("offers", () => {
  test("Prabhave's Diwali offer: its percentage, redemptions so far and code, each a cell of offers.list; every digit sourced", async () => {
    await signInShow(h, h.s.prabhave.owner);
    const el = await OffersPage();
    expect(resolves(el)).toBeGreaterThanOrEqual(2);
    const text = sourcedInBoth(el);
    expect(text).toContain("DIWALI10");
    expect(text).toContain("10%");
    expect(text).not.toContain("Cannot verify");
  });

  test("the owner creates an offer and ends it: offer.create and offer.end under the owner, with the form's key, once", async () => {
    const owner = await signInShow(h, h.s.prabhave.owner);
    const fields = { key: "offer-create-key-0001", name: "Weekend (sample)", kind: "amount_off", value: "150", scope: "all", code: "WKND150", ends: "2027-01-31" };
    expect(await createOfferAction(null, formOf(fields))).toEqual({ done: true });
    expect(await createOfferAction(null, formOf(fields))).toEqual({ done: true }); // the same form again records once
    const offers = await showRows<{ id: string; created_by: string; amount_off_minor: string }>(
      h,
      owner.tenantId,
      "select id::text, created_by::text, amount_off_minor::text from books.offer where code = 'WKND150'",
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ created_by: owner.memberId, amount_off_minor: "15000" });
    expect(await claimed(owner.tenantId, fields.key)).toEqual({ command: "offer.create", member_id: owner.memberId });

    expect(await endOfferAction(null, formOf({ offer: offers[0]?.id as string }))).toEqual({ done: true });
    const [end] = await showRows<{ created_by: string }>(h, owner.tenantId, "select created_by::text from books.offer_end where offer_id = $1", [offers[0]?.id]);
    expect(end?.created_by).toBe(owner.memberId);
  });

  test("a keyless form is refused before the books; a manager's offer is refused by the database", async () => {
    const owner = await signInShow(h, h.s.prabhave.owner);
    const before = await showRows(h, owner.tenantId, "select 1 from books.offer");
    expect(await createOfferAction(null, keyless({ name: "No key", kind: "percent_off", value: "5", scope: "all", ends: "2027-01-31" }))).toEqual({ error: "other" });
    await signInShow(h, h.s.prabhave.manager);
    expect(await createOfferAction(null, formOf({ name: "Manager's", kind: "percent_off", value: "5", scope: "all", ends: "2027-01-31" }))).toEqual({ error: "refused" });
    expect(await showRows(h, owner.tenantId, "select 1 from books.offer")).toEqual(before);
  });

  test("switched off, the screen is absent", async () => {
    await offThenOn(await signInShow(h, h.s.prabhave.owner), "offers", () => OffersPage());
  });
});

describe("packages", () => {
  const anita = () => h.s.elite.holdings.get("Anita R.") as string;
  const page = (holding?: string) => PackagesPage({ searchParams: Promise.resolve(holding ? { holding } : {}) });

  test("Elite's plans, holdings and one holding's balance: prices, sessions, value left and expiry are cells", async () => {
    await signInShow(h, h.s.elite.owner);
    const el = await page(anita());
    const data = dataOf<{ plans: unknown[]; holdings: unknown[]; open: { rows: unknown[] } | null }>(el);
    expect(data.plans.length).toBeGreaterThanOrEqual(4);
    expect(data.holdings).toHaveLength(4);
    expect(data.open?.rows.length).toBeGreaterThan(0);
    expect(resolves(el)).toBeGreaterThan(20);
    const text = sourcedInBoth(el);
    expect(text).toContain("Anita R.");
    expect(text).not.toContain("Cannot verify");
  });

  test("a desk redeems a session: package.redeem under the desk's member with the key; the balance read after is one less", async () => {
    const desk = await signInShow(h, h.s.elite.desks["Kirti Nagar"]);
    const holding = anita();
    const [line] = await showRows<{ item_id: string; left: string }>(
      h,
      desk.tenantId,
      `select e.item_id::text, e.sessions_after::text as left from books.package_entry e where e.holding_id = $1 and e.item_id is not null order by e.seq desc limit 1`,
      [holding],
    );
    const key = "redeem-key-000000001";
    const shop = h.s.elite.shops.get("Kirti Nagar") as string;
    expect(await redeemAction(null, formOf({ key, holding, shop, item: line?.item_id as string }))).toEqual({ done: true });
    const [after] = await showRows<{ left: string; created_by: string }>(
      h,
      desk.tenantId,
      `select e.sessions_after::text as left, e.created_by::text from books.package_entry e where e.holding_id = $1 and e.item_id = $2 order by e.seq desc limit 1`,
      [holding, line?.item_id],
    );
    expect(after).toEqual({ left: String(Number(line?.left) - 1), created_by: desk.memberId });
    expect(await claimed(desk.tenantId, key)).toEqual({ command: "package.redeem", member_id: desk.memberId });
    expect(await redeemAction(null, keyless({ holding, shop, item: line?.item_id as string }))).toEqual({ error: "other" });
  });

  test("the owner creates a plan (package.plan.create); a desk manager is refused", async () => {
    const owner = await signInShow(h, h.s.elite.owner);
    const service = [...h.s.elite.services.values()][0] as string;
    expect(await createPlanAction(null, formOf({ name: "Three cuts (sample)", price: "900", days: "60", service, sessions: "3" }))).toEqual({ done: true });
    const [plan] = await showRows<{ created_by: string; validity_days: number }>(h, owner.tenantId, "select created_by::text, validity_days from books.package_plan order by created_at desc limit 1");
    expect(plan).toEqual({ created_by: owner.memberId, validity_days: 60 });
    await signInShow(h, h.s.elite.desks.Kalkaji);
    expect(await createPlanAction(null, formOf({ name: "Desk plan", price: "100", days: "10", service, sessions: "1" }))).toEqual({ error: "refused" });
  });

  test("switched off, the screen is absent; Prabhave (no packages in its pack) has none", async () => {
    await signInShow(h, h.s.prabhave.owner);
    await isAbsent(() => page());
    await offThenOn(await signInShow(h, h.s.elite.owner), "packages", () => page());
  });
});

describe("loyalty and customers", () => {
  test("Elite has no rule: the empty state; the owner sets one (loyalty.rule.set) and it reads back as cells", async () => {
    const owner = await signInShow(h, h.s.elite.owner);
    let el = await LoyaltyPage();
    expect(dataOf<{ rule: unknown }>(el).rule).toBeNull();
    expect(sourcedInBoth(el)).toContain("No rule yet");
    cleanup();
    const key = "loyalty-rule-key-0001";
    expect(await setRuleAction(null, formOf({ key, earn: "5", value: "0.25", min: "100" }))).toEqual({ done: true });
    expect(await claimed(owner.tenantId, key)).toEqual({ command: "loyalty.rule.set", member_id: owner.memberId });
    el = await LoyaltyPage();
    expect(dataOf<{ rule: unknown }>(el).rule).not.toBeNull();
    expect(resolves(el)).toBeGreaterThanOrEqual(3);
    expect(sourcedInBoth(el)).toContain("₹0.25");
    expect(await setRuleAction(null, keyless({ earn: "5", value: "0.25", min: "100" }))).toEqual({ error: "other" });
  });

  test("customers: every customer with what each owes (credit.balances) and a customer's page (credit.balance, packages)", async () => {
    await signInShow(h, h.s.elite.owner);
    const el = await CustomersPage();
    expect(dataOf<{ customers: unknown[] }>(el).customers).toHaveLength(h.s.elite.customers.size);
    resolves(el);
    expect(sourcedInBoth(el)).toContain("Neelam G.");
    cleanup();
    const one = await CustomerPage({ params: Promise.resolve({ id: h.s.elite.customers.get("Anita R.") as string }) });
    expect(resolves(one)).toBeGreaterThanOrEqual(4);
    expect(sourcedInBoth(one)).not.toContain("Cannot verify");
  });

  test("switched off, loyalty is absent; Prabhave's pack has none", async () => {
    await signInShow(h, h.s.prabhave.owner);
    await isAbsent(() => LoyaltyPage());
    await offThenOn(await signInShow(h, h.s.elite.owner), "loyalty", () => LoyaltyPage());
  });
});

describe("GST invoices", () => {
  test("unregistered: no invoices; the owner registers (tax.registration.set), a sale is invoiced, and a credit note cancels it", async () => {
    // Elite's Kirti Nagar branch. Goods and services carry no tax class yet (item.create takes none), so the invoiced
    // sale is of a package plan made with one (package.plan.create's taxClass), sold to a named customer.
    const owner = await signInShow(h, h.s.elite.owner);
    const shopId = h.s.elite.shops.get("Kirti Nagar") as string;
    const list = () => InvoicesPage({ searchParams: Promise.resolve({ shop: shopId }) });
    let el = await list();
    expect(dataOf<{ invoices: unknown[] }>(el).invoices).toEqual([]);
    expect(sourcedInBoth(el)).toContain("Not registered for GST");
    cleanup();

    const key = "gst-register-key-0001";
    expect(await registerAction(null, formOf({ key, scheme: "regular", gstin: "07ABCDE1234F1Z5", state: "07", series: "KN", shop: shopId }))).toEqual({ done: true });
    expect(await claimed(owner.tenantId, key)).toEqual({ command: "tax.registration.set", member_id: owner.memberId });

    const service = [...h.s.elite.services.values()][1] as string;
    const { itemId } = await runCommand(await appPool(), owner, "package.plan.create", {
      name: "Taxed trio (sample)",
      priceMinor: 105_000,
      validityDays: 90,
      lines: [{ itemId: service, sessions: 3 }],
      taxClass: "salon_service",
    });
    const { saleId } = await recordSale(await appPool(), h.s.elite.desks["Kirti Nagar"], {
      shopId,
      customerId: h.s.elite.customers.get("Karan B.") as string,
      lines: [{ itemId: itemId as string, qtyMilli: 1000 }],
      payments: [{ method: "cash", amountMinor: 105_000 }],
    });
    el = await list();
    const invoices = dataOf<{ invoices: { id: string }[] }>(el).invoices;
    expect(invoices).toHaveLength(1);
    expect(resolves(el)).toBeGreaterThanOrEqual(6);
    expect(sourcedInBoth(el)).toContain("KN/");
    cleanup();

    const id = invoices[0]?.id as string;
    const one = await InvoicePage({ params: Promise.resolve({ id }) });
    expect(resolves(one)).toBeGreaterThanOrEqual(8);
    const text = sourcedInBoth(one);
    expect(text).toContain("Cancel with a credit note");
    expect(text).toContain("5%");
    cleanup();

    expect(await creditNoteAction(null, keyless({ invoice: id, sale: saleId as string, reason: "returned_goods" }))).toEqual({ error: "other" });
    // sale.reverse is the owner's: a desk manager is refused by the database, the owner writes the credit note.
    await signInShow(h, h.s.elite.desks["Kirti Nagar"]);
    expect(await creditNoteAction(null, formOf({ invoice: id, sale: saleId as string, reason: "returned_goods" }))).toEqual({ error: "refused" });
    await signInShow(h, owner);
    expect(await creditNoteAction(null, formOf({ invoice: id, sale: saleId as string, reason: "returned_goods" }))).toEqual({ done: true });
    const [note] = await showRows<{ kind: string; by: string }>(
      h,
      owner.tenantId,
      `select v.kind, s.created_by::text as by from books.invoice v join books.sale s on s.tenant_id = v.tenant_id and s.id = v.sale_id
        where v.original_invoice_id = $1`,
      [id],
    );
    expect(note).toEqual({ kind: "credit_note", by: owner.memberId });
    const after = await InvoicePage({ params: Promise.resolve({ id }) });
    expect(sourcedInBoth(after)).toContain("Cancelled by a credit note.");
  });

  test("switched off, the screens are absent", async () => {
    await offThenOn(await signInShow(h, h.s.elite.owner), "gst", () => InvoicesPage({ searchParams: Promise.resolve({}) }));
  });
});
