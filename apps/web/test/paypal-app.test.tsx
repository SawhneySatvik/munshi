// PayPal live in the app (sandbox, recorded mode), on the demo shop as `pnpm dev` builds it with its PayPal step
// (db/seed/kirana-paypal.ts) and a watcher run of today: overdue udhaar's finding offers a PayPal link beside the
// reminder; the link's draft waits in Home's tray with its amount the balance cell it cites; approving it makes the
// link (the jobs role's sweep) and drafts the WhatsApp message carrying it, which waits in the tray with its words in
// full for its own approval; the credit book shows the link, the message and a recorded demo payment. What is proved:
//   - the sandbox label (and "Munshi never moves money") wherever a link shows: the finding's fix, the tray card,
//     the credit book's panel, in both languages; a recorded demo payment says it is one; every digit sourced;
//   - counter staff see no PayPal surface (no panel, no PayPal fix) and their PayPal fix is refused;
//   - the overdue walkthrough's recorded track; the pending note; recorded mode said where the person decides (no sandbox keys
//   here), and an invoice link's card speaking of a bill.
// Each test makes or reads its own state (the red-proof harness runs each alone). The database gates are
// db/test/v2/core/paypal/paypal-app.test.ts.
import { randomUUID } from "node:crypto";
import { runCommand, runWatchers, type Session } from "@munshi/core";
import { proposePaypalLink } from "@munshi/core/paypal";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { PAYPAL_DEMO } from "../../../db/seed/kirana-paypal.ts";
import { decideDraft } from "../app/actions";
import { decidePaypalAction, recordPaypalAction } from "../app/app/credit/paypal-actions";
import { fixAction } from "../app/app/findings/actions";
import { CreditBook } from "../components/CreditBook";
import { LangProvider } from "../components/LangProvider";
import { loadCredit } from "../lib/server/credit";
import { afterLinkApproved } from "../lib/server/paypal-deliver";
import { resolveCell } from "../lib/snapshot";
import type { Lang, MessagePart } from "../lib/types";
import { state } from "./helpers/app-state";
import { type Home, homeFor, openHome, rows, signInAs, urlAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia, renderHome, unsourced } from "./helpers/render";

let h: Home;
let neha = "";
beforeAll(async () => {
  h = await openHome();
  neha = h.paypal.customerId; // openHome ran the PayPal step, as pnpm dev does
  // Today's watcher run (pnpm dev's ticker runs one within a minute): Neha's overdue balance and Sunita's PayPal payment.
  await runWatchers(h.db.jobs, h.k.tenantId);
  // The jobs pool, as the deploy sets it: an approved link reaches PayPal (recorded) from the approver's request.
  state.tick = { cronSecret: "", jobsDatabaseUrl: urlAs(h.db, "munshi_jobs") };
}, 240_000);
afterAll(async () => {
  state.tick = undefined;
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

const findingOf = async (kind: string, customerId: string) =>
  (
    await rows<{ id: string }>(
      h,
      `select f.id::text from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
        where f.kind = $1 and f.status = 'open'
          and exists (select 1 from jsonb_array_elements(s.rows -> f.snapshot_row) c where c ->> 't' = $2)`,
      [kind, customerId],
    )
  )[0]?.id;
const LABEL: Record<Lang, RegExp> = { en: /PayPal sandbox/, hi: /PayPal sandbox/ };
const NEVER: Record<Lang, string> = { en: "Munshi never moves money", hi: "मुंशी कभी पैसा नहीं भेजता" };

test("overdue udhaar offers a PayPal link beside the reminder, labelled PayPal sandbox; its draft's card shows the cited amount and the label", async () => {
  const home = await homeFor(h.k.owner);
  const card = home.findings.find((f) => f.kind === "overdue_credit");
  expect(card).toMatchObject({ fix: true, paypal: "recorded" }); // no sandbox keys in the tests: recorded mode
  for (const lang of ["en", "hi"] as Lang[]) {
    renderHome(home, lang);
    const link = screen.getByRole("button", { name: lang === "en" ? "Send a PayPal link" : "PayPal लिंक भेजें" });
    expect(link.closest("form")?.textContent).toMatch(LABEL[lang]);
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
  // The finding's PayPal fix: a draft for Neha, waiting in the tray; nothing is written to the books.
  const finding = await findingOf("overdue_credit", neha);
  expect(finding).toBeTruthy();
  const before = await rows<{ n: string }>(h, "select (select count(*) from books.payment) + (select count(*) from books.outbound_message) as n");
  expect(await fixAction(null, formOf({ finding: finding as string, fix: "paypal" }))).toEqual({ note: "fixDrafted", ok: true });
  expect(await rows<{ n: string }>(h, "select (select count(*) from books.payment) + (select count(*) from books.outbound_message) as n")).toEqual(before);
  const tray = (await homeFor(h.k.owner)).tray ?? [];
  const draft = tray.find((d) => d.command === "paypal.request");
  expect(draft).toMatchObject({ status: "proposed", customer: PAYPAL_DEMO.customer, canDecide: true });
  const after = await homeFor(h.k.owner);
  const amount = draft?.figure ? resolveCell(after.snapshots, draft.figure) : null;
  expect(amount).toEqual({ t: "money", minor: PAYPAL_DEMO.openingMinor, currency: "INR" });
  for (const lang of ["en", "hi"] as Lang[]) {
    renderHome(after, lang);
    const section = screen.getByRole("heading", { name: lang === "en" ? "PayPal link" : "PayPal लिंक" }).closest("section") as HTMLElement;
    expect(section.textContent).toMatch(LABEL[lang]);
    expect(section.textContent).toContain(NEVER[lang]);
    expect(section.textContent).toContain(PAYPAL_DEMO.customer);
    expect(within(section).getAllByRole("button").length).toBeGreaterThan(0);
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }

  // Approved from the tray: the link is made (recorded), and its WhatsApp message is drafted, not sent.
  expect(await decideDraft(null, formOf({ draft: draft?.id as string, verdict: "approved" }))).toEqual({ paypal: "drafted" });
  expect(await rows<{ n: string }>(h, "select (select count(*) from books.payment) + (select count(*) from books.outbound_message) as n")).toEqual(before);
  const waiting = await homeFor(h.k.owner);
  const message = (waiting.tray ?? []).find((d) => d.template === "paypal_link");
  expect(message).toMatchObject({ command: "customer.remind", status: "proposed", customer: PAYPAL_DEMO.customer, canDecide: true });
  // Its words, from the very link it names: the shop and the link as names, the amount (twice: English, Hindi) its cell.
  const parts: MessagePart[] = message?.paypalMessage ?? [];
  expect(parts.filter((x) => x.t === "ref").map((x) => (x.t === "ref" ? resolveCell(waiting.snapshots, x.ref) : null))).toEqual([
    { t: "money", minor: PAYPAL_DEMO.openingMinor, currency: "INR" },
    { t: "money", minor: PAYPAL_DEMO.openingMinor, currency: "INR" },
  ]);
  const names = parts.flatMap((x) => (x.t === "name" ? [x.v] : []));
  expect(names[1]).toMatch(/^PayPal sandbox link REC-[0-9A-F]{20} \(recorded: nothing was sent to PayPal\)$/);
  for (const lang of ["en", "hi"] as Lang[]) {
    renderHome(waiting, lang);
    const quote = document.querySelector("blockquote.app-quote");
    expect(quote, "the message's words are shown before its approval").not.toBeNull();
    const section = (quote as HTMLElement).closest("section") as HTMLElement;
    expect(section.textContent).toMatch(LABEL[lang]);
    expect(quote.textContent).toContain("recorded: nothing was sent to PayPal");
    expect(within(section).getAllByRole("button").length).toBeGreaterThan(0);
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
  // Its own approval writes it, under the approver, with the very words the tray showed.
  const shown = parts.map((x) => (x.t === "ref" ? "\u0000" : x.v)).join("");
  expect(await decideDraft(null, formOf({ draft: message?.id as string, verdict: "approved" }))).toBeNull();
  const [msg] = await rows<{ template_code: string; created_by: string; recipient_id: string; body: string }>(
    h,
    `select m.template_code, m.created_by::text, m.recipient_id::text, t.body from books.outbound_message m
       join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.template_code = 'paypal_link'`,
  );
  expect(msg).toMatchObject({ template_code: "paypal_link", created_by: h.k.owner.memberId, recipient_id: neha });
  // The body is the shown words with each amount slot the cell rendered (one rendering, both slots).
  const [head = "", next = ""] = shown.split("\u0000");
  const body = msg?.body ?? "";
  const rendered = body.slice(head.length, body.indexOf(next, head.length));
  expect(rendered).toContain("840");
  expect(body).toBe(shown.replaceAll("\u0000", rendered));

  // The credit book: Neha's link made and sent on WhatsApp; Sunita's paid in the recorded demo; labelled throughout.
  const data = await loadCredit(h.k.owner);
  expect(data.paypal?.links[neha]?.[0]).toMatchObject({ status: "sent", mode: "recorded", messaged: true });
  const sunita = h.k.customers.get(PAYPAL_DEMO.paid) as string;
  expect(data.paypal?.links[sunita]?.[0]?.events).toHaveLength(1);
  for (const lang of ["en", "hi"] as Lang[]) {
    render(
      <LangProvider initial={lang}>
        <CreditBook data={data} formKey="test-form-key" />
      </LangProvider>,
    );
    expect(screen.getAllByText(LABEL[lang]).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain(NEVER[lang]);
    expect(document.body.textContent).toContain(lang === "en" ? "Sent to the customer on WhatsApp" : "ग्राहक को WhatsApp पर भेजा गया");
    expect(document.body.textContent).toContain(lang === "en" ? "Paid (recorded demo: PayPal sent no notice)" : "रिकॉर्डेड डेमो");
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
});

test("counter staff see no PayPal surface: no panel on the credit book, no PayPal fix, and a PayPal fix of theirs is refused", async () => {
  const staff = h.k.staff[0] as Session;
  signInAs(staff);
  const data = await loadCredit(staff);
  expect(data.paypal).toBeNull();
  render(
    <LangProvider initial="en">
      <CreditBook data={data} formKey="test-form-key" />
    </LangProvider>,
  );
  expect(document.body.textContent).not.toMatch(/PayPal/);
  cleanup();
  const home = await homeFor(staff);
  expect(home.findings.filter((f) => "paypal" in f && f.paypal)).toEqual([]);
  expect((home.tray ?? []).filter((d) => d.command === "paypal.request")).toEqual([]);
  renderHome(home);
  expect(document.body.textContent).not.toMatch(/PayPal/);
  cleanup();
  const drafts = await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft");
  const finding = await findingOf("overdue_credit", h.k.customers.get("Ramesh K.") as string);
  expect(finding, "the finding exists: the refusal is the staff member's, not a missing finding").toBeTruthy();
  expect((await fixAction(null, formOf({ finding: finding as string, fix: "paypal" }))) as { ok: boolean }).toMatchObject({ ok: false });
  expect(await rows<{ n: string }>(h, "select count(*)::text as n from approval.draft")).toEqual(drafts);
});

test("the overdue walkthrough: the overdue card's PayPal fix drafts a link per overdue customer, skipping live and paid-unrecorded ones; a customer with no phone gets the link but no message; a recorded demo payment is recorded only by a person's approval", async () => {
  // Home's overdue card stands for every overdue customer: one PayPal link draft each, except Sunita (PayPal says paid,
  // the books do not show it yet) and anyone whose link is live or waits: skipped, and the card says so.
  const books = async () => rows<{ payments: string; messages: string }>(h, "select (select count(*) from books.payment)::text as payments, (select count(*) from books.outbound_message)::text as messages");
  const before = await books();
  const held = new Set(
    (
      await rows<{ customer: string }>(
        h,
        `select l.customer_id::text as customer from ops.paypal_link l
          where l.status in ('queued', 'cancel_queued') or (l.status = 'sent' and not exists (select 1 from ops.payment_event e where e.link_id = l.id))
         union select payload ->> 'customerId' from approval.draft where command = 'paypal.request' and status = 'proposed'`,
      )
    ).map((r) => r.customer),
  );
  const waitingBefore = await rows<{ id: string }>(h, "select id::text from approval.draft where command = 'paypal.request' and status = 'proposed'");
  expect(await fixAction(null, formOf({ card: "overdue_credit", fix: "paypal" }))).toEqual({ note: "fixPaypalSome", ok: true });
  expect(await books()).toEqual(before);
  const drafted = (
    await rows<{ id: string; customer: string }>(
      h,
      "select id::text, payload ->> 'customerId' as customer from approval.draft where command = 'paypal.request' and status = 'proposed' order by created_at",
    )
  ).filter((d) => !waitingBefore.some((w) => w.id === d.id));
  const overdue = ["Ramesh K.", "Mohan L.", PAYPAL_DEMO.customer]
    .map((n) => (n === PAYPAL_DEMO.customer ? h.paypal.customerId : (h.k.customers.get(n) as string)))
    .filter((id) => !held.has(id));
  expect(drafted.map((d) => d.customer).sort()).toEqual([...overdue].sort());
  expect(drafted.map((d) => d.customer)).not.toContain(h.k.customers.get(PAYPAL_DEMO.paid));
  // Ramesh K. has no phone on file: approving makes his link, and the screen says to share it himself.
  const ramesh = drafted.find((d) => d.customer === h.k.customers.get("Ramesh K."));
  expect(await decideDraft(null, formOf({ draft: ramesh?.id as string, verdict: "approved" }))).toEqual({ paypal: "no_contact" });
  expect((await loadCredit(h.k.owner)).paypal?.links[ramesh?.customer as string]?.[0]).toMatchObject({ status: "sent", messaged: false });
  expect(await books()).toEqual(before);
  // Sunita P.'s recorded demo payment: Record this payment, then Approve, from the credit book.
  const sunita = h.k.customers.get(PAYPAL_DEMO.paid) as string;
  const owed = async () => Number((await rows<{ n: string }>(h, "select coalesce(sum(amount_minor), 0)::text as n from books.credit_entry where customer_id = $1", [sunita]))[0]?.n);
  const owedBefore = await owed();
  const event = (await loadCredit(h.k.owner)).paypal?.links[sunita]?.find((l) => l.events.length)?.events[0];
  expect(await recordPaypalAction(null, formOf({ event: event?.id as string }))).toEqual({ drafted: true });
  const [record] = await rows<{ id: string }>(h, "select id::text from approval.draft where command = 'payment.record' and status = 'proposed' and payload ->> 'customerId' = $1", [sunita]);
  expect(await books()).toEqual(before);
  expect(await decidePaypalAction(null, formOf({ draft: record?.id as string, verdict: "approved" }))).toEqual({ decided: "executed" });
  const paid = await rows<{ method: string; created_by: string; amount_minor: string }>(h, "select method, created_by::text, amount_minor::text from books.payment where customer_id = $1 and method = 'paypal'", [sunita]);
  expect(paid).toEqual([{ method: "paypal", created_by: h.k.owner.memberId, amount_minor: String(owedBefore) }]);
  expect(await owed()).toBe(0);
});

test("a pending link: an approved link whose link cannot be read back says the approval is done and the link pending, never an error", async () => {
  const unreadable = async () => {
    throw new Error("the link could not be read back");
  };
  await expect(afterLinkApproved(h.k.owner, randomUUID(), "paypal.request", unreadable)).resolves.toBe("pending");
  // Only a PayPal link's approval has anything to follow: any other draft's says nothing.
  await expect(afterLinkApproved(h.k.owner, randomUUID(), "customer.remind", unreadable)).resolves.toBeNull();
});

test("recorded mode: with no sandbox keys, the PayPal fix and the link card say recorded and claim no call to PayPal; an invoice link speaks of a bill", async () => {
  const customer = ((await runCommand(h.db.app, h.k.owner, "customer.create", { name: "Recorded mode customer" })) as { customerId: string }).customerId;
  await runCommand(h.db.app, h.k.owner, "credit.record", { customerId: customer, amountMinor: 5_500 });
  const draftId = await proposePaypalLink(h.db.app, { session: h.k.manager }, { customerId: customer });
  const home = await homeFor(h.k.owner);
  const card = (home.tray ?? []).find((d) => d.id === draftId);
  expect(card).toMatchObject({ command: "paypal.request", paypalMode: "recorded", paypalPurpose: "credit" });
  // The same card for an invoice's link speaks of a bill (its amount is the bill's open credit, labelled so).
  const asInvoice = { ...(card as NonNullable<typeof card>), id: randomUUID(), paypalPurpose: "invoice" as const };
  for (const lang of ["en", "hi"] as Lang[]) {
    renderHome({ ...home, tray: [card as NonNullable<typeof card>, asInvoice] }, lang);
    const sections = screen.getAllByRole("heading", { name: lang === "en" ? "PayPal link" : "PayPal लिंक" }).map((x) => x.closest("section") as HTMLElement);
    const [own, bill] = [sections[0]?.textContent ?? "", sections[1]?.textContent ?? ""];
    expect(own).toContain(lang === "en" ? "recorded: sandbox keys not set" : "sandbox keys नहीं लगीं");
    expect(own).toContain(lang === "en" ? "Approving records a PayPal link here only" : "PayPal लिंक सिर्फ़ यहाँ दर्ज होता है");
    expect(own).not.toContain(lang === "en" ? "Approving asks PayPal" : "PayPal (sandbox) से भुगतान लिंक माँगा जाता है");
    expect(bill).toContain(lang === "en" ? "still owed on a bill" : "एक बिल पर बाक़ी");
    // The finding's PayPal fix says recorded too.
    const fix = screen.getByRole("button", { name: lang === "en" ? "Send a PayPal link" : "PayPal लिंक भेजें" });
    expect(fix.closest("form")?.textContent).toContain(lang === "en" ? "recorded: sandbox keys not set" : "sandbox keys नहीं लगीं");
    expect(unsourced(document.body)).toEqual([]);
    cleanup();
  }
});
