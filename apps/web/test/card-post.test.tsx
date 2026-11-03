// An Instagram post with an attached card, end to end in recorded Meta, on a live-kind database: with the
// config's media store (a local folder, as pnpm dev's .run/media) and an https MUNSHI_APP_URL, a real shop's approved
// post goes through the outbox's claim to a fake Graph endpoint with the attached card's public address and the
// approved words exactly, and that address serves the stored bytes. Attaching and seeing the card: card-attach.test.tsx.
// Red-proofs: db/test/v2/sabotage/card.ts.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachCard, createCampaign, decide, proposeCampaign, type Session, startSession, switchCapability, wireChannels, writeCopy } from "@munshi/core";
import type pg from "pg";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { grant } from "../../../db/test/v2/core/messaging/lib.ts";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { acceptTenant, asOwner } from "../../../db/test/v2/gates/lib.ts";
import { GET as publicCardRoute } from "../app/api/cards/[tenant]/[file]/route";
import { swapApiPorts, writableStore } from "../lib/api/deps";
import type { Config } from "../lib/server/config";
import { flushOutbox } from "../lib/server/outbox";
import { state } from "./helpers/app-state";
import { openWebDb, urlAs, type WebDb } from "./helpers/home-db";

const ORIGIN = "https://shops.example";
const ACCOUNT = "17841400000000002";
let db: WebDb;
const outboxDir = mkdtempSync(path.join(tmpdir(), "munshi-card-outbox-"));
const mediaDir = mkdtempSync(path.join(tmpdir(), "munshi-card-media-"));

type Call = { url: string; body: Record<string, unknown> };
const graph: Call[] = [];
const fakeGraph = (async (url: string | URL, init?: RequestInit) => {
  graph.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  return Response.json(String(url).endsWith("/media") ? { id: "container-9" } : { id: "ig-media-9" });
}) as typeof fetch;

// The app's config, its media store the local folder (as pnpm dev's .run/media), never swapped in.
const configured = (over: Partial<Config> = {}): Config =>
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
    media: { kind: "local", dir: mediaDir },
    instagram: { accountRef: "ig_card_post", businessAccountId: ACCOUNT, accessToken: "ig-token", appSecret: "s".repeat(32), verifyToken: "verify", graphHost: "graph.instagram.com" },
    ...over,
  }) as Config;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  state.config = configured();
  state.tick = { cronSecret: "", jobsDatabaseUrl: urlAs(db, "munshi_jobs") };
  await db.sabotage();
});
afterEach(() => {
  vi.unstubAllGlobals();
  swapApiPorts({});
  wireChannels(null);
  (globalThis as { munshiOutboxWired?: unknown }).munshiOutboxWired = undefined;
  state.config = configured();
  graph.length = 0;
});
afterAll(async () => {
  for (const d of [outboxDir, mediaDir]) rmSync(d, { recursive: true, force: true });
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

const composing = async (owner: Session, words: string) => {
  const id = await createCampaign(db.app, owner, { name: "Festive post", channel: "instagram", segment: "bought_within_days", segmentDays: 30 });
  await writeCopy(db.app, { session: owner }, id, words);
  return id;
};

it("end to end in recorded Meta: with the config's store and an https MUNSHI_APP_URL, a real shop's approved post with an attached card goes through the outbox's claim to the Graph endpoint with that card's public address and the approved words exactly, and the address serves the stored bytes", async () => {
  const shop = await smallShop(db.app, "Card post", { accept: (t) => acceptTenant(db.admin, t) });
  await switchCapability(db.app, shop.owner, "campaigns", true);
  await grant(db, shop.owner.tenantId, "instagram", true, "ig_card_post");
  const owner = (await startSession(db.app, shop.owner.tenantId, shop.owner.memberId, "real")).session;
  const words = "New festive stock is on the shelf this week.";
  const campaign = await composing(owner, words);
  const picture = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: "#aa5522" } }).jpeg().toBuffer();
  const doc = await attachCard(db.app, owner, campaign, picture, writableStore() as NonNullable<ReturnType<typeof writableStore>>);
  expect((await decide(db.app, owner, await proposeCampaign(db.app, owner, campaign), "approved")).status).toBe("executed");
  vi.stubGlobal("fetch", fakeGraph);
  await flushOutbox();
  const caption = (
    await db.admin.query<{ body: string }>("select t.body from books.outbound_message m join ops.message_text t on t.id = m.text_id where m.campaign_id = $1", [campaign])
  ).rows[0]?.body;
  expect(caption).toBe(words);
  const address = `${ORIGIN}/api/cards/${owner.tenantId}/${doc}.jpg`;
  expect(graph).toEqual([
    { url: `https://graph.instagram.com/v26.0/${ACCOUNT}/media`, body: { image_url: address, caption: words } },
    { url: `https://graph.instagram.com/v26.0/${ACCOUNT}/media_publish`, body: { creation_id: "container-9" } },
  ]);
  const delivered = await db.admin.query<{ mode: string; status: string; id: string | null }>(
    "select d.mode, d.status, d.provider_message_id as id from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.campaign_id = $1",
    [campaign],
  );
  expect(delivered.rows).toEqual([{ mode: "instagram", status: "sent", id: "ig-media-9" }]);
  vi.unstubAllGlobals();
  const r = await publicCardRoute(new Request(address), { params: Promise.resolve({ tenant: owner.tenantId, file: `${doc}.jpg` }) });
  expect([r.status, r.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
  expect(Buffer.from(await r.arrayBuffer()).equals(picture)).toBe(true);
});
