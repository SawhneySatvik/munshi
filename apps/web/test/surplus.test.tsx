// Surplus for good on the screens, on the demo kirana as `pnpm dev` builds it: two recipients (simulated), one gift already
// made (part of an older lot of a staple, to the food bank) and the planted Cheese lot near its expiry. Offer it leaves a
// draft and moves nothing; the impact tally renders only from cells, on the office and the surplus page,
// and is "Cannot verify" whole once a gift is valued in another currency; every place that names a
// recipient labels it simulated; a gift's card names only the payload's own item and recipient;
// the office's brief offers the same choice as Home; counter staff get no surplus screens; the
// seeded gift leaves its item in stock. The landing page's sample tally is static, inside its labelled example.
// Each test makes the drafts it needs. Red-proofs: db/test/v2/sabotage/surplus-app.ts.
import { type CellRef, decide, mintSnapshot, proposeDraft, resolveRef, runCommand, type Session, writeBrief } from "@munshi/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { tx } from "../../../db/test/v2/db.ts";
import { decideDraft } from "../app/actions";
import { fixAction } from "../app/app/findings/actions";
import { addRecipientAction } from "../app/app/surplus/actions";
import { AskProvider } from "../components/AskProvider";
import { BriefView } from "../components/app/BriefView";
import { LangProvider } from "../components/LangProvider";
import { SourcesProvider } from "../components/Sources";
import { Surplus } from "../components/Surplus";
import { SurplusTally } from "../components/SurplusTally";
import { TrayCard } from "../components/TrayCard";
import { ImpactExample } from "../components/site/ImpactExample";
import { SITE_WORDS } from "../components/site/words";
import { castOf } from "../lib/cast";
import { AGENTS } from "../lib/i18n-agents";
import { SURPLUS } from "../lib/i18n-surplus";
import { appPool } from "../lib/server/db";
import { loadOffice } from "../lib/server/desks";
import { loadBrief } from "../lib/server/office";
import { loadSurplus } from "../lib/server/surplus";
import { resolveCell } from "../lib/snapshot";
import { AS_OF, type Home, homeFor, openHome, rows, signInAs } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";
import { fakeMatchMedia, renderHome, unsourced } from "./helpers/render";

let h: Home;
beforeAll(async () => {
  h = await openHome();
}, 300_000);
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  signInAs(h.k.owner);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const en = SURPLUS.en;
const one = async <R,>(sql: string, params: unknown[] = []) => (await rows<R>(h, sql, params))[0] as R;
const tally = async () => one<{ gifts: number; value: string; other: number }>("select gifts, value_minor::text as value, other_currency_gifts as other from ops.surplus_impact()");
const donated = async () => Number((await one<{ n: string }>("select count(*)::text as n from books.stock_move where kind = 'donated'")).n);
const recipientId = async (name: string) => (await one<{ id: string }>("select id::text from ops.surplus_recipient where name = $1", [name])).id;

type Gift = { payload: { lotId: string; itemId: string; qtyMilli: number; recipientId: string }; own: CellRef[]; onHand: CellRef };

/** A gift of an item's whole stock on hand from one of its lots, to `recipient`, with the cells it cites: the item's
 * stock.on_hand (on_hand, item) and the recipient's row (id, name). */
async function giftOf(itemName: string, recipient: string): Promise<Gift> {
  const itemId = h.k.items.get(itemName) as string;
  const { id: lotId } = await one<{ id: string }>(
    "select id::text from books.purchase_line where item_id = $1 and expires_on is not null order by expires_on desc, id desc limit 1",
    [itemId],
  );
  const as = { kind: "member", session: h.k.owner } as const;
  const held = await mintSnapshot(await appPool(), as, "stock.on_hand", { item_id: itemId });
  const listed = await mintSnapshot(await appPool(), as, "surplus.recipients", {});
  const to = await recipientId(recipient);
  const row = listed.rows.findIndex((r) => r.id?.kind === "text" && r.id.txt === to);
  const qty = held.rows[0]?.on_hand;
  const onHand: CellRef = { snapshotId: held.id, row: 0, col: "on_hand" };
  return {
    payload: { lotId, itemId, qtyMilli: qty?.kind === "quantity" ? Number(qty.num) : 0, recipientId: to },
    own: [onHand, { snapshotId: held.id, row: 0, col: "item" }, { snapshotId: listed.id, row, col: "id" }, { snapshotId: listed.id, row, col: "name" }],
    onHand,
  };
}
const propose = async (g: Gift) =>
  proposeDraft(await appPool(), { session: h.k.owner }, { command: "surplus.give", payload: g.payload, basedOn: g.own, payloadRefs: { qtyMilli: g.onHand } });

test("Offer it from Home leaves the gift waiting in the tray, filed under Tally's desk; nothing moves before an approval", async () => {
  const before = await donated();
  const decided = Number((await one<{ n: string }>("select count(*)::text as n from approval.decision")).n);
  const home = await homeFor(h.k.owner);
  const expiry = home.findings.find((f) => f.kind === "expiry");
  const gaushala = expiry?.offer?.[1]?.id as string;
  expect(await fixAction(null, formOf({ finding: expiry?.ids ?? [], recipient: gaushala }))).toEqual({ note: "fixDrafted", ok: true });
  const [draft] = await rows<{ id: string; status: string; desk: string; recipient: string; qty: number }>(
    h,
    `select d.id::text, d.status, r.desk, d.payload->>'recipientId' as recipient, (d.payload->>'qtyMilli')::int as qty
       from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id where d.command = 'surplus.give'`,
  );
  expect(draft).toMatchObject({ status: "proposed", desk: "surplus", recipient: gaushala, qty: 15_285 });
  expect(castOf({ desk: draft?.desk })).toBe("tally");
  expect(await donated()).toBe(before);
  expect(Number((await one<{ n: string }>("select count(*)::text as n from approval.decision")).n)).toBe(decided);
});

test("the seeded gift is part of a lot: its item stays in stock, and the draft cites its recipient's name and its lot's item", async () => {
  const g = await one<{ item_id: string; qty: string; on_hand: string; lot_qty: string; value: string; based_on: CellRef[]; recipient: string; lot: string }>(
    `select l.item_id::text, l.qty_milli::text as qty, l.value_minor::text as value, pl.qty_milli::text as lot_qty, l.recipient_id::text as recipient,
            l.lot_id::text as lot, d.based_on,
            (select sum(m.qty_milli) from books.stock_move m where m.item_id = l.item_id)::text as on_hand
       from ops.surplus_listing l join books.purchase_line pl on pl.id = l.lot_id
       join approval.decision dc on dc.id = l.decision_id join approval.draft d on d.id = dc.draft_id`,
  );
  expect(Number(g.on_hand)).toBeGreaterThan(0);
  expect(Number(g.qty)).toBeGreaterThan(0);
  expect(Number(g.qty)).toBeLessThanOrEqual(Number(g.lot_qty));
  const cols = g.based_on.map((r) => r.col);
  expect(cols).toEqual(["item", "left", "on_hand", "id", "name"]);
  const cell = (r: CellRef) => tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => resolveRef(c, r));
  expect(await cell(g.based_on[4] as CellRef)).toEqual({ kind: "text", txt: "Annapurna Food Bank" });
  expect(await cell(g.based_on[3] as CellRef)).toEqual({ kind: "text", txt: g.recipient });
  expect(await cell({ ...(g.based_on[0] as CellRef), col: "lot_id" })).toEqual({ kind: "text", txt: g.lot });
  expect(g.recipient).toBe(await recipientId("Annapurna Food Bank"));
  expect(await tally()).toEqual({ gifts: 1, value: g.value, other: 0 });
});

test("the impact tally renders only from cells: on the office and the surplus page every figure is a chip on its surplus.impact cell", async () => {
  const seeded = await tally();
  const office = await loadOffice(h.k.owner);
  const impact = office.impact;
  if (!impact?.tally) throw new Error("test: the office has no tally");
  expect(impact.snapshot.query).toBe("surplus.impact");
  expect(impact.tally.mixed).toBe(false);
  for (const ref of [impact.tally.gifts, impact.tally.items, impact.tally.value]) {
    expect(ref?.snapshotId).toBe(impact.snapshot.id);
    expect(ref && resolveCell([impact.snapshot], ref), ref?.col).toBeDefined();
  }
  expect(resolveCell([impact.snapshot], impact.tally.value as NonNullable<typeof impact.tally.value>)).toEqual({ t: "money", minor: Number(seeded.value), currency: "INR" });
  render(
    <LangProvider initial="en">
      <SourcesProvider snapshots={[impact.snapshot]} deskRef={null}>
        <SurplusTally tally={impact.tally} manage />
      </SourcesProvider>
    </LangProvider>,
  );
  const section = screen.getByRole("region", { name: en.tallyHeading });
  expect(within(section).getAllByRole("button", { name: /source:/ })).toHaveLength(3);
  expect(within(section).getByRole("link", { name: en.manage }).getAttribute("href")).toBe("/app/surplus");
  expect(section.textContent).toContain(en.recipientsSimulated);
  expect(unsourced(document.body)).toEqual([]);
  cleanup();
  // The surplus page's tally: the same three chips, nothing typed.
  const page = await loadSurplus(h.k.owner);
  if (!page) throw new Error("test: no surplus page for the owner");
  render(
    <LangProvider initial="en">
      <Surplus data={page} />
    </LangProvider>,
  );
  expect(within(screen.getByRole("region", { name: en.tallyHeading })).getAllByRole("button", { name: /source:/ })).toHaveLength(3);
  expect(unsourced(document.body)).toEqual([]);
});

test("recipients are always labelled simulated on screen: the surplus page, Offer it on Home and the gift waiting in the tray", async () => {
  // The surplus page: every recipient listed with its sticker.
  const page = await loadSurplus(h.k.owner);
  if (!page) throw new Error("test: no surplus page for the owner");
  expect(page.recipients.map((r) => r.name)).toEqual(["Annapurna Food Bank", "Gaushala Seva Trust"]);
  const { container } = render(
    <LangProvider initial="en">
      <Surplus data={page} />
    </LangProvider>,
  );
  const listed = [...container.querySelectorAll<HTMLElement>(".surplus-recipients [data-recipient]")];
  expect(listed).toHaveLength(2);
  for (const li of listed) expect(within(li).getByText(en.simulated).className).toContain("sticker");
  cleanup();

  // Home: the Cheese lot's expiry finding offers "Offer it", each recipient named as simulated.
  const home = await homeFor(h.k.owner);
  const expiry = home.findings.find((f) => f.kind === "expiry");
  expect(expiry?.fix).toBe(true);
  expect(expiry?.offer?.map((r) => r.name)).toEqual(["Annapurna Food Bank", "Gaushala Seva Trust"]);
  renderHome(home);
  const offer = screen.getByRole("button", { name: AGENTS.en.offer }).closest("form") as HTMLFormElement;
  const options = within(offer).getAllByRole("option");
  expect(options.map((o) => o.textContent)).toEqual(["Annapurna Food Bank · Simulated", "Gaushala Seva Trust · Simulated"]);
  cleanup();

  // A gift of its own waiting in the tray: the recipient named with the simulated sticker.
  const g = await giftOf("Cheese slices 200 g", "Gaushala Seva Trust");
  const draftId = await propose(g);
  const before = await donated();
  const waiting = await homeFor(h.k.owner);
  const card = (waiting.tray ?? []).find((d) => d.id === draftId);
  expect(card).toMatchObject({ status: "proposed", canDecide: true, gift: { item: "Cheese slices 200 g", recipient: "Gaushala Seva Trust" } });
  expect(card?.gift?.qty && resolveCell(waiting.snapshots, card.gift.qty)).toEqual({ t: "qty", milli: g.payload.qtyMilli, unit: "pack" });
  renderHome(waiting);
  const section = document.getElementById(`tray-h-${draftId}`)?.closest("section") as HTMLElement;
  const named = section.querySelector("[data-recipient]") as HTMLElement;
  expect(named.textContent).toBe("Gaushala Seva Trust Simulated");
  expect(within(named).getByText(AGENTS.en.simulated).className).toContain("sticker");
  expect(section.textContent).toContain(AGENTS.en.giftNote);
  expect(unsourced(document.body)).toEqual([]);
  cleanup();

  // Approved by the owner: the stock leaves as given and the tally counts it.
  const gifts = (await tally()).gifts;
  expect(await decideDraft(null, formOf({ draft: draftId, verdict: "approved" }))).toBeNull();
  expect(await donated()).toBe(before + 1);
  expect((await tally()).gifts).toBe(gifts + 1);
  // A decided gift's card says what was recorded: given away, the recipient simulated, no message sent.
  render(
    <LangProvider initial="en">
      <SourcesProvider snapshots={waiting.snapshots} deskRef={null}>
        <TrayCard draft={{ ...(card as NonNullable<typeof card>), status: "executed" }} />
      </SourcesProvider>
    </LangProvider>,
  );
  expect(document.body.textContent).toContain(AGENTS.en.trayGiftApprovedNote);
  expect(document.body.textContent).not.toContain(AGENTS.en.trayApprovedNote);
});

test("a gift's card names only the payload's own item and recipient: a draft citing another recipient's name shows Cannot verify", async () => {
  const g = await giftOf("Butter 100 g", "Annapurna Food Bank");
  const listed = g.own[2] as CellRef;
  const other = await recipientId("Gaushala Seva Trust");
  const otherRow = (await mintSnapshot(await appPool(), { kind: "member", session: h.k.owner }, "surplus.recipients", {})).rows.findIndex(
    (r) => r.id?.kind === "text" && r.id.txt === other,
  );
  // Core refuses it outright; stored past core, as the app role can store a row, the card still names no one.
  const basedOn = [g.own[0], g.own[1], listed, { snapshotId: listed.snapshotId, row: otherRow, col: "name" }];
  const forged = await tx(h.db.app, { tenant_id: h.k.tenantId, actor_id: h.k.owner.memberId }, async (c) =>
    (
      await c.query<{ id: string }>(
        `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, created_txid)
         values ($1, 'surplus.give', $2, $3, $4, 'member', 0) returning id::text`,
        [h.k.tenantId, JSON.stringify(g.payload), JSON.stringify(basedOn), JSON.stringify({ qtyMilli: g.onHand })],
      )
    ).rows[0]?.id as string,
  );
  const home = await homeFor(h.k.owner);
  const card = (home.tray ?? []).find((d) => d.id === forged);
  expect(card?.gift).toMatchObject({ item: "Butter 100 g", recipient: null });
  renderHome(home);
  const section = document.getElementById(`tray-h-${forged}`)?.closest("section") as HTMLElement;
  expect(section.textContent).not.toContain("Gaushala");
  expect((section.querySelector("[data-recipient]") as HTMLElement).textContent).toContain(SURPLUS_CANNOT);
  cleanup();
  // And approving it gives nothing: core finds it stale.
  expect(await decide(await appPool(), h.k.owner, forged, "approved")).toMatchObject({ status: "stale" });
});
const SURPLUS_CANNOT = "Cannot verify";

test("the office's brief offers the same choice as Home on an expiry line: each recipient labelled simulated, none picked silently", async () => {
  await writeBrief(h.db.jobs, h.k.tenantId, h.k.shopId, { asOf: AS_OF });
  const brief = await loadBrief(h.k.owner);
  const line = brief.briefs.flatMap((b) => b.lines).find((l) => l.kind === "expiry");
  if (!line) throw new Error("test: the brief has no expiry line");
  expect(line.fix).toBe(true);
  expect(line.offer?.map((r) => r.name)).toEqual(["Annapurna Food Bank", "Gaushala Seva Trust"]);
  render(
    <LangProvider initial="en">
      <AskProvider who="test">
        <BriefView data={brief} />
      </AskProvider>
    </LangProvider>,
  );
  const offer = screen.getByRole("button", { name: AGENTS.en.offer }).closest("form") as HTMLFormElement;
  expect(within(offer).getAllByRole("option").map((o) => o.textContent)).toEqual(["Annapurna Food Bank · Simulated", "Gaushala Seva Trust · Simulated"]);
  // The expiry line offers no bare "Draft the fix" that would give to a recipient no one chose.
  const row = offer.closest(".find-moves") as HTMLElement;
  expect(within(row).queryByRole("button", { name: AGENTS.en.fix })).toBeNull();
});

test("counter staff get no surplus: the page is a 404, Home offers them no Offer it, and listing a recipient is refused", async () => {
  const staff = h.k.staff[0] as Session;
  expect(await loadSurplus(staff)).toBeNull();
  expect((await loadOffice(staff)).impact ?? null).toBeNull();
  const home = await homeFor(staff);
  const expiry = home.findings.find((f) => f.kind === "expiry");
  expect(expiry).toBeDefined(); // staff see stock findings, in quantities
  expect(expiry?.fix).toBeFalsy();
  expect(expiry?.offer).toBeUndefined();
  signInAs(staff);
  const listed = Number((await one<{ n: string }>("select count(*)::text as n from ops.surplus_recipient")).n);
  expect(await addRecipientAction(null, formOf({ name: "Staff pick", kind: "other", area: "Here" }))).toEqual({ note: "refused", ok: false });
  expect(Number((await one<{ n: string }>("select count(*)::text as n from ops.surplus_recipient")).n)).toBe(listed);
  // The owner can.
  signInAs(h.k.owner);
  expect(await addRecipientAction(null, formOf({ name: "Seva Kitchen", kind: "community_kitchen", area: "Station Road" }))).toEqual({ note: "added", ok: true });
});

test("the surplus words carry no digit, and the English ones no Devanagari: the page, Offer it, the tray and the drawer titles", async () => {
  const page = await loadSurplus(h.k.owner);
  const titles = (page?.snapshots ?? []).map((s) => s.title);
  expect(titles).toHaveLength(2);
  const keys = ["fix_no_recipient", "offer", "offerTo", "offerNone", "offerAdd", "simulated", "traySurplus", "giftLine", "giftNote", "trayGiftApprovedNote"] as const;
  for (const lang of ["en", "hi"] as const) {
    const words = [...Object.values(SURPLUS[lang]), ...keys.map((k) => AGENTS[lang][k]), ...titles.map((t) => t[lang])];
    expect(words.filter((v) => /[0-9०-९]/.test(v)), lang).toEqual([]);
    if (lang === "en") expect(words.filter((v) => /[ऀ-ॿ]/.test(v))).toEqual([]);
    // Hindi in Devanagari, with no stray letters of another script.
    if (lang === "hi") expect(words.filter((v) => /[֐-׿؀-ۿ]/.test(v))).toEqual([]);
  }
});

test("the landing page's sample tally sits inside its labelled example, in both languages, English with no Devanagari", () => {
  for (const lang of ["en", "hi"] as const) {
    const { container } = render(
      <LangProvider initial={lang}>
        <ImpactExample />
      </LangProvider>,
    );
    const ex = container.querySelector("[data-example]") as HTMLElement;
    expect(ex).not.toBeNull();
    expect(ex.textContent).toContain(SITE_WORDS[lang].impactNote);
    expect(ex.textContent).toMatch(/[0-9०-९]/);
    if (lang === "en") expect(ex.textContent).not.toMatch(/[ऀ-ॿ]/);
    cleanup();
  }
});

// Last: it values a gift in another currency, which every later tally would show.
test("once a gift is valued in another currency, the tally's three figures are Cannot verify and it says why; no figure counts only some gifts", async () => {
  // A lot bought in USD (the shop keeps INR), as the books admit one, and a gift of it approved by the owner.
  const itemId = ((await runCommand(await appPool(), h.k.owner, "item.create", { name: "Imported oats 500 g", unit: "pack" })) as { itemId: string }).itemId;
  const supplier = [...h.k.suppliers.values()][0] as string;
  await tx(h.db.app, { tenant_id: h.k.tenantId, actor_id: h.k.manager.memberId, command: "purchase.record" }, async (c) => {
    const p = (
      await c.query<{ id: string }>(
        "insert into books.purchase (tenant_id, supplier_id, bill_no, bill_date, total_minor, currency) values ($1, $2, 'USD-1', current_date, 800, 'USD') returning id::text",
        [h.k.tenantId, supplier],
      )
    ).rows[0]?.id;
    await c.query(
      `insert into books.purchase_line (tenant_id, purchase_id, line_no, item_id, qty_milli, unit_cost_minor, currency, expires_on)
       values ($1, $2, 1, $3, 2000, 400, 'USD', current_date + 3)`,
      [h.k.tenantId, p, itemId],
    );
    await c.query(
      `insert into books.stock_move (tenant_id, item_id, qty_milli, kind, source_rel, source_id, expires_on, at) values ($1, $2, 2000, 'purchase', 'books.purchase', $3, current_date + 3, now())`,
      [h.k.tenantId, itemId, p],
    );
  });
  h.k.items.set("Imported oats 500 g", itemId);
  const draftId = await propose(await giftOf("Imported oats 500 g", "Annapurna Food Bank"));
  expect((await decide(await appPool(), h.k.owner, draftId, "approved")).status).toBe("executed");
  expect((await tally()).other).toBe(1);

  const office = await loadOffice(h.k.owner);
  const impact = office.impact;
  if (!impact?.tally) throw new Error("test: the office has no tally");
  expect(impact.tally).toEqual({ gifts: null, items: null, value: null, mixed: true });
  render(
    <LangProvider initial="en">
      <SourcesProvider snapshots={[impact.snapshot]} deskRef={null}>
        <SurplusTally tally={impact.tally} manage />
      </SourcesProvider>
    </LangProvider>,
  );
  const section = screen.getByRole("region", { name: en.tallyHeading });
  expect(within(section).queryAllByRole("button", { name: /source:/ })).toEqual([]);
  expect(within(section).getAllByText(SURPLUS_CANNOT)).toHaveLength(3);
  expect(section.textContent).toContain(en.tallyMixed);
  expect(unsourced(document.body)).toEqual([]);
});
