// An approved campaign's Instagram post, through the app's own wiring, on a live-kind database (platform design §5).
// The card route serves a campaign's card where Meta fetches it, only once an Instagram campaign of that shop is
// approved and only bytes that are the document's own; anything else is the one empty 404. The outbox wires Instagram's
// sender only where a card can be served (an https MUNSHI_APP_URL and a media store), and the screens' channel state
// says the same; the post goes through the outbox's claim with the card's public address and the approved words, exactly;
// a campaign whose card the public may not fetch posts nothing. Red-proofs: db/test/v2/sabotage/instagram.ts (IGCARD,
// IGPOST).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { channelStates, createCampaign, decide, proposeCampaign, runDueJobs, type Session, startSession, switchCapability, wireChannels, withTx, writeCopy } from "@munshi/core";
import type pg from "pg";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { grant } from "../../../db/test/v2/core/messaging/lib.ts";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { tx } from "../../../db/test/v2/db.ts";
import { acceptTenant, asOwner } from "../../../db/test/v2/gates/lib.ts";
import { GET as cardRoute } from "../app/api/cards/[tenant]/[file]/route";
import { CampaignsView, InboxView } from "../components/app/OfficeViews";
import { LangProvider } from "../components/LangProvider";
import { swapApiPorts } from "../lib/api/deps";
import { AGENTS } from "../lib/i18n-agents";
import { APP } from "../lib/i18n-app";
import { channelDeploy } from "../lib/server/channels";
import type { Config } from "../lib/server/config";
import { loadCampaigns, loadInbox } from "../lib/server/office";
import { flushOutbox, jobsPool, rewireOutbox, wireOutbox } from "../lib/server/outbox";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";

const ORIGIN = "https://shops.example";
const ACCOUNT = "17841400000000001";
let db: WebDb;
const outboxDir = mkdtempSync(path.join(tmpdir(), "munshi-ig-post-"));

// Meta's Graph API as a fetch: each call recorded, answered as the docs show.
type Call = { url: string; body: Record<string, unknown> };
const graph: Call[] = [];
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  graph.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  const answer = String(url).endsWith("/media") ? { id: "container-1" } : { id: "ig-media-1" };
  return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// The media store: each card's bytes by storage key.
const stored = new Map<string, Buffer>();
const store = { read: async (key: string) => stored.get(key) ?? null };

const configured = (accountRef: string, over: Partial<Config> = {}): Config =>
  ({
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: randomUUID(),
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    deployment: "live",
    sendMode: "live",
    outboxDir,
    appUrl: ORIGIN,
    instagram: { accountRef, businessAccountId: ACCOUNT, accessToken: "ig-token", appSecret: "s".repeat(32), verifyToken: "verify", graphHost: "graph.instagram.com" },
    ...over,
  }) as Config;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  await db.sabotage();
  state.tick = { cronSecret: "", jobsDatabaseUrl: urlAs(db, "munshi_jobs") };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  swapApiPorts({});
  wireChannels(null);
  (globalThis as { munshiOutboxWired?: unknown }).munshiOutboxWired = undefined;
  graph.length = 0;
});
afterAll(async () => {
  const held = globalThis as { munshiPublicPool?: pg.Pool; munshiJobsPool?: { pool: pg.Pool }; munshiPool?: Promise<pg.Pool> };
  await held.munshiPublicPool?.end();
  await held.munshiJobsPool?.pool.end();
  await (await held.munshiPool?.catch(() => undefined))?.end();
  held.munshiPublicPool = undefined;
  held.munshiJobsPool = undefined;
  held.munshiPool = undefined;
  state.tick = undefined;
  await db.close();
});

// A real shop (accepted by the operator), its owner signed in for real, granted Instagram under its own alias.
async function igShop(label: string, alias: string): Promise<Session> {
  const shop = await smallShop(db.app, label, { accept: (t) => acceptTenant(db.admin, t) });
  await switchCapability(db.app, shop.owner, "campaigns", true);
  await grant(db, shop.owner.tenantId, "instagram", true, alias);
  return (await startSession(db.app, shop.owner.tenantId, shop.owner.memberId, "real")).session;
}

// A card document (a JPEG's record; its bytes in the store), as the owner uploads it.
async function card(owner: Session): Promise<string> {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64), Buffer.from([0xff, 0xd9])]);
  const key = `t-${owner.tenantId}/card/${randomUUID()}.jpg`;
  stored.set(key, bytes);
  const { rows } = await tx(db.app, { tenant_id: owner.tenantId, actor_id: owner.memberId }, (c) =>
    c.query<{ id: string }>(`insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'card', 'upload', $2, $3, 'image/jpeg', $4) returning id`, [
      owner.tenantId,
      key,
      createHash("sha256").update(bytes).digest(),
      bytes.length,
    ]),
  );
  return rows[0]?.id as string;
}
const bytesOf = async (doc: string) => stored.get((await db.admin.query<{ k: string }>("select storage_key as k from ops.document where id = $1", [doc])).rows[0]?.k as string);
const asOwnerOf = (owner: Session) => ({ tenant_id: owner.tenantId, actor_id: owner.memberId });

// An Instagram campaign with its words and card, proposed and approved by the owner through decide().
async function approvedPost(owner: Session, words: string, withCard = true): Promise<{ campaign: string; card: string | null }> {
  const campaign = await createCampaign(db.app, owner, { name: "Festive post", channel: "instagram", segment: "bought_within_days", segmentDays: 30 });
  await writeCopy(db.app, { session: owner }, campaign, words);
  const doc = withCard ? await card(owner) : null;
  if (doc) await tx(db.app, asOwnerOf(owner), (c) => c.query("update ops.campaign set card_document_id = $2 where id = $1", [campaign, doc]));
  expect((await decide(db.app, owner, await proposeCampaign(db.app, owner, campaign), "approved")).status).toBe("executed");
  return { campaign, card: doc };
}
const deliveryOf = async (campaign: string) =>
  (
    await db.admin.query<{ mode: string; status: string; provider_message_id: string | null }>(
      "select d.mode, d.status, d.provider_message_id from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.campaign_id = $1",
      [campaign],
    )
  ).rows;
const fetchCard = (tenant: string, file: string) => cardRoute(new Request(`http://localhost/api/cards/${tenant}/${file}`), { params: Promise.resolve({ tenant, file }) });
const wireLive = (accountRef: string, over: Partial<Config> = {}) => {
  state.config = configured(accountRef, over);
  vi.stubGlobal("fetch", fakeFetch);
  wireOutbox();
};

it("IGCARD1 the card route serves a card only once its Instagram campaign is approved, as the bare JPEG whose sha256 is the document's own; composing, a WhatsApp campaign's, another shop's path, a malformed path, other bytes and no store are the one empty 404", async () => {
  const owner = await igShop("Card route", "ig_card_route");
  state.config = configured("ig_card_route");
  swapApiPorts({ media: store });
  const doc = await card(owner);
  const make = (channel: string) =>
    tx(db.app, asOwnerOf(owner), async (c) =>
      (
        await c.query<{ id: string }>(
          `insert into ops.campaign (tenant_id, name, channel, segment, segment_days, card_document_id) values ($1, 'Card post', $2, 'bought_within_days', 30, $3) returning id`,
          [owner.tenantId, channel, doc],
        )
      ).rows[0]?.id as string,
    );
  const move = (id: string, status: string) => tx(db.app, asOwnerOf(owner), (c) => c.query("update ops.campaign set status = $2 where id = $1", [id, status]));
  const answer = async (tenant = owner.tenantId, file = `${doc}.jpg`) => {
    const r = await fetchCard(tenant, file);
    return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
  };
  const nothing = { status: 404, body: Buffer.alloc(0) };
  const wa = await make("whatsapp");
  await move(wa, "proposed");
  await move(wa, "approved");
  expect(await answer(), "a WhatsApp campaign's").toEqual(nothing);
  const ig = await make("instagram");
  expect(await answer(), "composing").toEqual(nothing);
  await move(ig, "proposed");
  expect(await answer(), "proposed").toEqual(nothing);
  await move(ig, "approved");
  const ok = await fetchCard(owner.tenantId, `${doc}.jpg`);
  expect([ok.status, ok.headers.get("content-type"), ok.headers.get("x-content-type-options"), ok.headers.get("set-cookie")]).toEqual([200, "image/jpeg", "nosniff", null]);
  expect(Buffer.from(await ok.arrayBuffer()).equals(await bytesOf(doc))).toBe(true);
  expect(await answer(randomUUID()), "another shop's path").toEqual(nothing);
  expect(await answer(owner.tenantId, `${doc}.png`), "malformed").toEqual(nothing);
  expect(await answer("not-a-tenant"), "malformed tenant").toEqual(nothing);
  // Bytes that are not the document's own are never served.
  const key = (await db.admin.query<{ k: string }>("select storage_key as k from ops.document where id = $1", [doc])).rows[0]?.k as string;
  const own = stored.get(key) as Buffer;
  stored.set(key, Buffer.concat([own, Buffer.from([0])]));
  expect(await answer(), "other bytes").toEqual(nothing);
  stored.set(key, own);
  swapApiPorts({});
  expect(await answer(), "no store").toEqual(nothing);
});

it("IGPOST1 an approved post goes through the outbox's claim to Meta with the card's public address under MUNSHI_APP_URL and the approved words exactly, and that address serves the card", async () => {
  const owner = await igShop("Post one", "ig_post_one");
  swapApiPorts({ media: store });
  const words = "Festive picks are in, come and see them this week.";
  const { campaign, card: doc } = await approvedPost(owner, words);
  wireLive("ig_post_one");
  await flushOutbox();
  const caption = (
    await db.admin.query<{ body: string }>("select t.body from books.outbound_message m join ops.message_text t on t.id = m.text_id where m.campaign_id = $1", [campaign])
  ).rows[0]?.body;
  expect(caption).toBe(words);
  const address = `${ORIGIN}/api/cards/${owner.tenantId}/${doc}.jpg`;
  expect(graph).toEqual([
    { url: `https://graph.instagram.com/v26.0/${ACCOUNT}/media`, body: { image_url: address, caption } },
    { url: `https://graph.instagram.com/v26.0/${ACCOUNT}/media_publish`, body: { creation_id: "container-1" } },
  ]);
  expect(await deliveryOf(campaign)).toEqual([{ mode: "instagram", status: "sent", provider_message_id: "ig-media-1" }]);
  // What Meta fetches from that address is the card.
  const r = await fetchCard(owner.tenantId, `${doc}.jpg`);
  expect([r.status, Buffer.from(await r.arrayBuffer()).equals(await bytesOf(doc as string))]).toEqual([200, true]);
});

it("IGPOST2 without a card address (no media store, or an origin that is not https) no Instagram sender is wired: the approved post waits unposted, and the shop's channel state says no_card; with both it reads live", async () => {
  const owner = await igShop("Post two", "ig_post_two");
  const stateNow = async () => (await withTx(db.app, { kind: "member", session: owner }, (c) => channelStates(c, owner.tenantId, channelDeploy())))[1];
  const { campaign } = await approvedPost(owner, "New stock is on the shelf.");
  for (const [why, ports, origin] of [
    ["no store", {}, ORIGIN],
    ["http origin", { media: store }, "http://localhost:3000"],
  ] as const) {
    swapApiPorts(ports);
    wireLive("ig_post_two", { appUrl: origin });
    expect(await stateNow(), why).toEqual({ channel: "instagram", live: false, reason: "no_card" });
    await flushOutbox();
    expect(graph, why).toEqual([]);
    expect(await deliveryOf(campaign), why).toEqual([{ mode: "pending", status: "queued", provider_message_id: null }]);
    wireChannels(null);
    (globalThis as { munshiOutboxWired?: unknown }).munshiOutboxWired = undefined;
  }
  swapApiPorts({ media: store });
  state.config = configured("ig_post_two");
  expect(await stateNow()).toEqual({ channel: "instagram", live: true, reason: "live" });
});

it("IGPOST3 a post whose card the public may not fetch (erased after approval, or none named) reaches no Meta call: the sender is given no address the route would not serve, and the post fails", async () => {
  const owner = await igShop("Post three", "ig_post_three");
  swapApiPorts({ media: store });
  const erased = await approvedPost(owner, "The card of this post is gone.");
  await tx(db.app, asOwnerOf(owner), (c) => c.query("update ops.document set storage_key = null, erased_at = now() where id = $1", [erased.card]));
  const none = await approvedPost(owner, "This post never had a card.", false);
  wireLive("ig_post_three");
  await flushOutbox();
  expect(graph).toEqual([]);
  expect([...(await deliveryOf(erased.campaign)), ...(await deliveryOf(none.campaign))].map((d) => [d.mode, d.status])).toEqual([
    ["instagram", "failed"],
    ["instagram", "failed"],
  ]);
});

it("IGPOST4 the outbox asks instagramCards() again before each sweep, as the screens do: a sender wired while a card address held is unwired once the store is gone, and the tick's rewire wires it again once it is back", async () => {
  const owner = await igShop("Post four", "ig_post_four");
  const { campaign } = await approvedPost(owner, "Fresh arrivals this week.");
  swapApiPorts({ media: store });
  wireLive("ig_post_four");
  // The store goes before the sweep: the flush wires again and posts nothing.
  swapApiPorts({});
  expect(channelDeploy().instagramCard).toBe(false);
  await flushOutbox();
  expect(graph).toEqual([]);
  expect(await deliveryOf(campaign)).toEqual([{ mode: "pending", status: "queued", provider_message_id: null }]);
  // Back, and the tick's check wires the sender before its sweep (a later minute's slot than the flush's).
  swapApiPorts({ media: store });
  rewireOutbox();
  await runDueJobs(jobsPool() as pg.Pool, new Date(Date.now() + 120_000), ["outbox"]);
  expect(graph.map((c) => c.url.split("/").at(-1))).toEqual(["media", "media_publish"]);
  expect(await deliveryOf(campaign)).toEqual([{ mode: "instagram", status: "sent", provider_message_id: "ig-media-1" }]);
});

it("IGCARD2 the card route counts each caller's IP against the public API's read limit before any card is looked up: past it, an empty 429 with Retry-After and no store read; another IP is not limited", async () => {
  state.config = configured("ig_card_rate");
  let reads = 0;
  const counting = async (key: string) => {
    reads++;
    return stored.get(key) ?? null;
  };
  swapApiPorts({ media: { read: counting } });
  // The limit counts in fixed minutes of the database clock: start early in one, so all the calls fall inside it.
  const second = new Date().getUTCSeconds();
  if (second > 40) await new Promise((r) => setTimeout(r, (61 - second) * 1000));
  const ask = (ip: string) =>
    cardRoute(new Request(`http://localhost/api/cards/${randomUUID()}/${randomUUID()}.jpg`, { headers: { "x-forwarded-for": ip } }), {
      params: Promise.resolve({ tenant: randomUUID(), file: `${randomUUID()}.jpg` }),
    });
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const statuses: number[] = [];
  for (let i = 0; i < 120; i++) statuses.push((await ask(ip)).status);
  expect(new Set(statuses)).toEqual(new Set([404]));
  const before = reads;
  const limited = await ask(ip);
  expect([limited.status, await limited.text(), Number(limited.headers.get("retry-after")) > 0]).toEqual([429, "", true]);
  expect(reads).toBe(before);
  expect((await ask("198.51.100.9")).status).toBe(404);
}, 120_000);

it("IGLABEL1 the inbox and campaigns screens say which channel sends for real and which is only recorded, in both languages; with none live, Recorded, nothing is sent; an Instagram message is labelled Instagram and offers no Draft reply or Draft order", async () => {
  const owner = await igShop("Labels", "ig_labels");
  await tx(db.as("munshi_public"), { tenant_id: owner.tenantId }, (c) =>
    c.query(
      `insert into ops.inbound_message (tenant_id, channel, provider_message_id, from_address, account_ref, kind, text, received_at) values ($1, 'instagram', $2, '9000000000000021', 'ig_labels', 'text', 'Is it in stock?', now())`,
      [owner.tenantId, `ig.${randomUUID()}`],
    ),
  );
  const note = (el: ReactElement, lang: "en" | "hi") => {
    cleanup();
    render(<LangProvider initial={lang}>{el}</LangProvider>);
    return document.querySelector(".app-note")?.textContent ?? "";
  };
  // Instagram live (a card address and the account's grant), WhatsApp not (no credential, no grant): each as it is.
  swapApiPorts({ media: store });
  state.config = configured("ig_labels");
  const inbox = await loadInbox(owner);
  const camps = await loadCampaigns(owner);
  if (!inbox || !camps) throw new Error("the inbox and campaigns are the owner's");
  expect(inbox.channels.map((ch) => [ch.channel, ch.live])).toEqual([
    ["whatsapp", false],
    ["instagram", true],
  ]);
  for (const lang of ["en", "hi"] as const) {
    const a = APP[lang];
    for (const el of [<InboxView key="i" data={inbox} />, <CampaignsView key="c" data={camps} />]) {
      const shown = note(el, lang);
      expect(shown, lang).toContain(a.instagramLive);
      expect(shown, lang).toContain(a.channelNotLive.replace("{name}", a.channelWhatsapp));
      expect(shown, lang).not.toContain(a.inboxLive);
    }
  }
  cleanup();
  render(
    <LangProvider initial="en">
      <InboxView data={inbox} />
    </LangProvider>,
  );
  expect(document.querySelector("#inbox-waiting")?.closest("section")?.textContent).toContain(`${APP.en.channelInstagram} · `);
  // A drafted reply or order goes back on WhatsApp to the sender's phone, which an Instagram DM does not have.
  expect(screen.queryAllByRole("button", { name: AGENTS.en.draftReply })).toEqual([]);
  expect(screen.queryAllByRole("button", { name: AGENTS.en.draftOrder })).toEqual([]);
  // No card address: nothing is live, and the screens say so.
  swapApiPorts({});
  const recorded = await loadCampaigns(owner);
  expect(recorded?.channels.map((ch) => [ch.live, ch.reason])).toEqual([
    [false, "no_credential"],
    [false, "no_card"],
  ]);
  for (const lang of ["en", "hi"] as const) expect(note(<CampaignsView data={recorded as NonNullable<typeof recorded>} />, lang), lang).toBe(APP[lang].inboxRecorded);
});
