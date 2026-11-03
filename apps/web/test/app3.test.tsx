// BP-APP-3 on the showcase seed (Elite and Prabhave as `pnpm dev` builds them): the inbox, campaigns, settings and the
// office's morning brief. Each renders from its core view, every figure a <Figure> whose ref lands on a stored cell, no
// digit without a source in either language, absent while its capability is off (or for a role it is not for). Each
// action writes as the signed-in member under the form's key and refuses a keyless form: a message handled (an ops
// row, handled_by the member), a campaign composed, its words (a typed figure refused), a test to oneself (no book row)
// and its proposal; the send runs only through decide() as the owner, and on a shop with no grant it is recorded.
import { cleanup, render, screen } from "@testing-library/react";
import { can, recordSale, runCommand, runWatchers, switchCapability, withPage } from "@munshi/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { tx } from "../../../db/test/v2/db.ts";
import { writeBrief } from "../../../packages/core/src/brief.ts";
import { createCampaignAction, decideCampaignAction, proposeCampaignAction, testSendAction, writeCopyAction } from "../app/app/campaigns/actions";
import CampaignsPage from "../app/app/campaigns/page";
import { handleMessageAction } from "../app/app/inbox/actions";
import InboxPage from "../app/app/inbox/page";
import OfficePage from "../app/app/office/page";
import { switchAction } from "../app/app/settings/actions";
import SettingsPage from "../app/app/settings/page";
import { LangProvider } from "../components/LangProvider";
import { APP, CHANNEL_REASON } from "../lib/i18n-app";
import { appPool } from "../lib/server/db";
import type { BriefPage, CampaignsPage as Camps, InboxPage as Inbox, SettingsPage as Settings } from "../lib/server/office";
import { dataOf, figures, isAbsent, resolves, sourcedInBoth } from "./app-render";
import { formOf } from "./ops-db";
import { fakeMatchMedia } from "./render";
import { openShowcase, SHOW_AS_OF, type Shows, showRows, signInShow } from "./showcase-db";

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

const e = () => h.s.elite;
const p = () => h.s.prabhave;
const keyless = (fields: Record<string, string>) => {
  const form = formOf(fields);
  form.delete("key");
  return form;
};

/** A message as the webhook stores it: munshi_public, the tenant's context, no actor. */
async function inbound(tenantId: string, text: string, from = "+919800000001"): Promise<string> {
  const id = crypto.randomUUID();
  await tx(h.db.as("munshi_public"), { tenant_id: tenantId }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, id, provider_message_id, from_address, kind, text, received_at) values ($1, $2, $3, $4, 'text', $5, now())`,
      [tenantId, id, `wamid.${id}`, from, text],
    ),
  );
  return id;
}

describe("the inbox (§8.6)", () => {
  test("empty, then a message quoting the waiting cart's code shows that request (inbox.order_link); a STOP has no handle", async () => {
    await signInShow(h, p().owner);
    const empty = await InboxPage();
    expect(dataOf<Inbox>(empty).messages).toEqual([]);
    expect(sourcedInBoth(empty)).toContain("Recorded · nothing is sent");
    cleanup();

    const [req] = await showRows<{ code: string }>(h, p().tenantId, "select code from ops.order_request where id = $1", [p().requests.get("waiting")]);
    const code = req?.code as string;
    const quoting = await inbound(p().tenantId, `Hello, about order ${code}, can I pick it up on the 12th?`);
    await inbound(p().tenantId, "Do you have the green one in size 40?", "+919800000002");
    await inbound(p().tenantId, "STOP", "+919800000003");
    const el = await InboxPage();
    const data = dataOf<Inbox>(el);
    expect(data.granted).toBe(false);
    expect(data.messages).toHaveLength(3);
    const linked = data.messages.find((m) => m.id === quoting);
    expect(linked?.orders?.rows.map((r) => r.code)).toEqual([code]);
    expect(data.messages.filter((m) => m.orders).length).toBe(1);
    expect(resolves(el)).toBe(1);
    const text = sourcedInBoth(el);
    expect(text).toContain(code);
    expect(figures()).toBe(1);
    // Two handle pairs: the STOP is handled only beside its withdrawal, never from here.
    expect(screen.getAllByRole("button", { name: "Mark handled" })).toHaveLength(2);
  });

  test("a manager marks a message handled (handleInbound, as the member); a keyless form is refused", async () => {
    const id = await inbound(p().tenantId, "Thank you!", "+919800000004");
    const manager = await signInShow(h, p().manager);
    expect(await handleMessageAction(null, keyless({ message: id, status: "handled" }))).toEqual({ error: "other" });
    const state = async () => (await showRows<{ status: string; handled_by: string | null }>(h, p().tenantId, "select status, handled_by::text from ops.inbound_message where id = $1", [id]))[0];
    expect(await state()).toEqual({ status: "new", handled_by: null });
    expect(await handleMessageAction(null, formOf({ message: id, status: "handled" }))).toEqual({ done: true });
    expect(await state()).toEqual({ status: "handled", handled_by: manager.memberId });
    // Once handled, it is never handled again.
    expect(await handleMessageAction(null, formOf({ message: id, status: "ignored" }))).toMatchObject({ error: expect.any(String) });
    const el = await InboxPage();
    expect(dataOf<Inbox>(el).messages.find((m) => m.id === id)?.status).toBe("handled");
  });

  test("messaging switched off: the inbox and campaigns are absent", async () => {
    const owner = await signInShow(h, p().owner);
    const pool = await appPool();
    await switchCapability(pool, owner, "campaigns", false);
    await switchCapability(pool, owner, "messaging", false);
    try {
      await isAbsent(() => InboxPage());
      await isAbsent(() => CampaignsPage());
    } finally {
      await switchCapability(pool, owner, "messaging", true);
      await switchCapability(pool, owner, "campaigns", true);
    }
  });
});

describe("campaigns (§8.6)", () => {
  test("compose, words (a typed figure refused), a test to me (no book row), propose, approve by decide(): recorded", async () => {
    const owner = await signInShow(h, e().owner);
    const empty = await CampaignsPage();
    expect(dataOf<Camps>(empty).campaigns).toEqual([]);
    sourcedInBoth(empty);
    cleanup();

    // One customer the campaign may reach: a phone in the vault, marketing consent on WhatsApp, a sale this week.
    const pool = await appPool();
    const { customerId } = await runCommand(pool, owner, "customer.create", { name: "Sample regular", phone: "+919800000010" });
    await runCommand(pool, owner, "consent.record", { customerId, purpose: "marketing", granted: true, source: "in_person", noticeVersion: "v1" });
    const plan = await runCommand(pool, owner, "package.plan.create", {
      name: "Two trims (sample)",
      priceMinor: 80_000,
      validityDays: 60,
      lines: [{ itemId: e().services.get("s-cut-m") as string, sessions: 2 }],
    });
    await recordSale(pool, owner, {
      shopId: e().shops.get("Kalkaji") as string,
      customerId: customerId as string,
      lines: [{ itemId: plan.itemId as string, qtyMilli: 1000 }],
      payments: [{ method: "cash", amountMinor: 80_000 }],
    });

    const fields = { name: "Come back this week", channel: "whatsapp", segment: "bought_within_days", days: "30", offer: "" };
    expect(await createCampaignAction(null, keyless(fields))).toEqual({ error: "other" });
    expect(await createCampaignAction(null, formOf(fields))).toEqual({ done: true });
    const [k] = await showRows<{ id: string; created_by: string }>(h, e().tenantId, "select id::text, created_by::text from ops.campaign");
    const campaign = k?.id as string;
    expect(k?.created_by).toBe(owner.memberId);

    expect(await writeCopyAction(null, formOf({ campaign, body: "Twenty percent off: 20% this week" }))).toEqual({ error: "invalid" });
    expect(await writeCopyAction(null, keyless({ campaign, body: "We miss you. Your chair is waiting this week." }))).toEqual({ error: "other" });
    expect(await writeCopyAction(null, formOf({ campaign, body: "We miss you. Your chair is waiting this week." }))).toEqual({ done: true });

    const composing = await CampaignsPage();
    const row = dataOf<Camps>(composing).campaigns[0];
    expect(row?.status).toBe("composing");
    expect(row?.audience?.col).toBe("_count");
    expect(resolves(composing)).toBe(1);
    expect(sourcedInBoth(composing)).toContain("Recorded · nothing is sent");
    expect(figures()).toBe(2); // the audience on the rail and in its line
    cleanup();

    const books = async () => (await showRows(h, e().tenantId, "select 1 from books.outbound_message")).length;
    const before = await books();
    expect(await testSendAction(null, formOf({ campaign }))).toEqual({ done: true });
    const [test1] = await showRows<{ mode: string; test_member_id: string }>(h, e().tenantId, "select mode, test_member_id::text from ops.delivery where test_member_id is not null");
    expect(test1).toEqual({ mode: "recorded", test_member_id: owner.memberId });
    expect(await books()).toBe(before);

    expect(await proposeCampaignAction(null, keyless({ campaign }))).toEqual({ error: "other" });
    expect(await proposeCampaignAction(null, formOf({ campaign }))).toEqual({ done: true });
    const proposed = await CampaignsPage();
    const waiting = dataOf<Camps>(proposed).campaigns[0];
    expect(waiting?.status).toBe("proposed");
    expect(waiting?.draftStatus).toBe("proposed");
    expect(resolves(proposed)).toBe(1);
    sourcedInBoth(proposed);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(await books()).toBe(before); // nothing sent while it waits
    cleanup();

    const draft = waiting?.draftId as string;
    expect(await decideCampaignAction(null, keyless({ draft, verdict: "approved" }))).toEqual({ error: "other" });
    expect(await decideCampaignAction(null, formOf({ draft, verdict: "approved" }))).toEqual({ done: true });
    const [decision] = await showRows<{ decided_by: string; verdict: string }>(h, e().tenantId, "select decided_by::text, verdict from approval.decision where draft_id = $1", [draft]);
    expect(decision).toEqual({ decided_by: owner.memberId, verdict: "approved" });
    // One message per customer in the audience the draft cited, each recorded (no grant), written under the approver.
    const audience = await showRows<{ n: number }>(h, e().tenantId, "select row_count as n from snap.snapshot where query_name = 'campaign.audience' order by created_at desc limit 1");
    const sent = await showRows<{ created_by: string }>(h, e().tenantId, "select created_by::text from books.outbound_message where campaign_id = $1", [campaign]);
    expect(audience[0]?.n).toBe(1);
    expect(sent.length).toBe(1);
    expect(sent.every((m) => m.created_by === owner.memberId)).toBe(true);
    const after = await CampaignsPage();
    expect(dataOf<Camps>(after).campaigns[0]?.draftStatus).toBe("executed");
    sourcedInBoth(after);
  });
});

test("LABEL2 the shop's settings show WhatsApp and Instagram as recorded, not sent, with the reason, in both languages", async () => {
  await signInShow(h, e().owner);
  const el = await SettingsPage();
  // A showcase shop is a sample (data_class showcase): whatever the deployment holds, its sends are recorded.
  expect(dataOf<Settings>(el).channels).toEqual([
    { channel: "whatsapp", live: false, reason: "sample_shop" },
    { channel: "instagram", live: false, reason: "sample_shop" },
  ]);
  const shown = (lang: "en" | "hi") => {
    cleanup();
    render(<LangProvider initial={lang}>{el}</LangProvider>);
    return document.getElementById("channels-h")?.closest("section")?.querySelector(".l-card")?.textContent ?? ""; // the rows, not the note
  };
  for (const lang of ["en", "hi"] as const) {
    const text = shown(lang);
    expect(text.split(APP[lang].channelRecorded).length - 1, lang).toBe(2);
    expect(text.split(CHANNEL_REASON.sample_shop?.[lang] as string).length - 1, lang).toBe(2);
    expect(text, lang).not.toContain(APP[lang].channelLive);
  }
  expect(sourcedInBoth(el)).toContain(APP.en.channelsHeading);
});

describe("settings (§8.13)", () => {
  test("the owner's capabilities, people and sessions; a switch is the owner's own ops row under the key", async () => {
    const owner = await signInShow(h, e().owner);
    const el = await SettingsPage();
    const data = dataOf<Settings>(el);
    expect(data.capabilities.find((c) => c.code === "messaging")).toMatchObject({ on: true, usable: false, needsGrant: true });
    expect(data.capabilities.find((c) => c.code === "salary")?.requires).toEqual(["staff"]);
    expect(data.sessions.some((s) => s.mine)).toBe(true);
    expect(data.members.length).toBeGreaterThanOrEqual(3);
    expect(sourcedInBoth(el)).toContain("Needs the platform's approval");
    cleanup();

    const pool = await appPool();
    const usable = () => withPage(pool, owner, (c) => can(c, owner, "loyalty"));
    expect(await switchAction(null, keyless({ capability: "loyalty", on: "false" }))).toEqual({ error: "other" });
    expect(await usable()).toBe(true);
    expect(await switchAction(null, formOf({ capability: "loyalty", on: "false" }))).toEqual({ done: true });
    expect(await usable()).toBe(false);
    const [row] = await showRows<{ by: string; is_on: boolean }>(h, e().tenantId, `select "by"::text as by, is_on from ops.capability_switch where capability = 'loyalty' order by id desc limit 1`);
    expect(row).toEqual({ by: owner.memberId, is_on: false });
    // Off while something requires it on is refused (staff: salary and bookings need it).
    expect(await switchAction(null, formOf({ capability: "staff", on: "false" }))).toMatchObject({ error: expect.any(String) });
    expect(await switchAction(null, formOf({ capability: "loyalty", on: "true" }))).toEqual({ done: true });
    expect(await usable()).toBe(true);
  });

  test("a manager has no settings, and no office for counter staff", async () => {
    await signInShow(h, e().desks.Kalkaji);
    await isAbsent(() => SettingsPage());
    await signInShow(h, p().counter);
    await isAbsent(() => OfficePage());
  });
});

describe("the office: the morning brief (§7.6)", () => {
  test("no brief yet, then each branch's brief in brief.ranked's order, every figure a stored cell", async () => {
    await signInShow(h, e().owner);
    const empty = await OfficePage();
    expect(dataOf<BriefPage>(empty).briefs).toEqual([]);
    sourcedInBoth(empty);
    cleanup();

    await runWatchers(h.db.jobs, e().tenantId, SHOW_AS_OF);
    for (const shopId of e().shops.values()) await writeBrief(h.db.jobs, e().tenantId, shopId, { asOf: SHOW_AS_OF });
    const el = await OfficePage();
    const data = dataOf<BriefPage>(el);
    expect(data.briefs).toHaveLength(e().shops.size);
    const lines = data.briefs.flatMap((b) => b.lines);
    expect(lines.length).toBeGreaterThan(0);
    for (const b of data.briefs) expect(b.lines.map((l) => l.rank.row)).toEqual(b.lines.map((_, i) => i + 1));
    expect(resolves(el)).toBe(lines.length + lines.reduce((n, l) => n + l.refs.length, 0));
    sourcedInBoth(el);
    expect(figures()).toBeGreaterThanOrEqual(lines.length);
  });
});
