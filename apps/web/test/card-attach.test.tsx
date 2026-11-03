// An Instagram post's card through the app: the office attaches a JPEG or a PNG while composing (made a JPEG
// Instagram takes, stored in the configured media store, named by the campaign), sees it on the campaign line, and the
// approver sees the very card the draft bound; the office's private card route serves it to the office only. Sample
// shops on the default deployment, signed in with demo sessions as a browser is. The post itself: card-post.test.tsx.
// Red-proofs: db/test/v2/sabotage/card.ts.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachCard, createCampaign, isJpeg, proposeCampaign, type Session, startSession, switchCapability, writeCopy } from "@munshi/core";
import { cleanup, render } from "@testing-library/react";
import type pg from "pg";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { GET as publicCardRoute } from "../app/api/cards/[tenant]/[file]/route";
import { attachCardAction, proposeCampaignAction, removeCardAction } from "../app/app/campaigns/actions";
import { GET as officeCardRoute } from "../app/api/office/cards/[file]/route";
import { CampaignsView } from "../components/app/OfficeViews";
import { LangProvider } from "../components/LangProvider";
import { swapApiPorts, writableStore } from "../lib/api/deps";
import { APP } from "../lib/i18n-app";
import type { Config } from "../lib/server/config";
import { MAX_CARD_UPLOAD } from "../lib/server/card-image";
import { loadCampaigns } from "../lib/server/office";
import { SESSION_COOKIE, signSession } from "../lib/server/session";
import { state } from "./helpers/app-state";
import { openWebDb, urlAs, type WebDb } from "./helpers/home-db";
import { formOf } from "./helpers/ops-db";

const ORIGIN = "https://shops.example";
let db: WebDb;
const mediaDir = mkdtempSync(path.join(tmpdir(), "munshi-card-media-"));

// The app's config, its media store the local folder (as pnpm dev's .run/media), swapped out only to show none.
const configured = (over: Partial<Config> = {}): Config =>
  ({
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: randomUUID(),
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    appUrl: ORIGIN,
    media: { kind: "local", dir: mediaDir },
    ...over,
  }) as Config;

beforeAll(async () => {
  db = await openWebDb();
  state.config = configured();
  await db.sabotage();
});
afterEach(() => {
  cleanup();
  swapApiPorts({});
  state.config = configured();
  state.cookies.clear();
});
afterAll(async () => {
  rmSync(mediaDir, { recursive: true, force: true });
  const held = globalThis as { munshiPublicPool?: pg.Pool; munshiPool?: Promise<pg.Pool> };
  await held.munshiPublicPool?.end();
  await (await held.munshiPool?.catch(() => undefined))?.end();
  held.munshiPublicPool = undefined;
  held.munshiPool = undefined;
  await db.close();
});

// A sample shop with campaigns on, its people signed in with demo sessions as the browser would be.
async function sampleShop(label: string) {
  const shop = await smallShop(db.app, label);
  await switchCapability(db.app, shop.owner, "campaigns", true);
  return shop;
}
async function signIn(who: Session): Promise<void> {
  const o = await startSession(db.app, who.tenantId, who.memberId, "demo");
  const claim = { tenantId: who.tenantId, memberId: who.memberId, sessionId: o.session.sessionId as string, via: "demo" as const };
  state.cookies.set(SESSION_COOKIE, signSession(claim, o.expiresAt, (state.config as Config).sessionSecret));
}
const composing = async (owner: Session, words = "Festive picks are in this week.") => {
  const id = await createCampaign(db.app, owner, { name: "Festive post", channel: "instagram", segment: "bought_within_days", segmentDays: 30 });
  await writeCopy(db.app, { session: owner }, id, words);
  return id;
};
const cardOf = async (campaign: string) =>
  (
    await db.admin.query<{ card: string | null; key: string | null; sha: Buffer | null; mime: string | null }>(
      "select k.card_document_id::text as card, d.storage_key as key, d.sha256 as sha, d.mime from ops.campaign k left join ops.document d on d.id = k.card_document_id where k.id = $1",
      [campaign],
    )
  ).rows[0];
const upload = (campaign: string, bytes: Buffer, type = "image/png") => {
  const form = formOf({ campaign });
  form.append("card", new Blob([new Uint8Array(bytes)], { type }), "card.png");
  return attachCardAction(null, form);
};
// A tall PNG with transparency: Instagram takes neither its type nor its shape.
const tallPng = () => sharp({ create: { width: 300, height: 900, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }).png().toBuffer();
// A pixel of a stored JPEG, as [r, g, b].
const pixel = async (jpeg: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]] as number[];
};
const fetchOffice = (doc: string) => officeCardRoute(new Request(`http://localhost/api/office/cards/${doc}.jpg`), { params: Promise.resolve({ file: `${doc}.jpg` }) });

it("the office attaches a PNG while composing and the store holds a JPEG Instagram takes (within 4:5 to 1.91:1 exactly, at the edges too, at least 320 wide, no transparency), its sha256 the document's; a GIF, staff, no store and a proposed campaign are refused with nothing stored; remove names none", async () => {
  const shop = await sampleShop("Card attach");
  const campaign = await composing(shop.owner);
  await signIn(shop.owner);
  expect(await upload(campaign, await tallPng())).toEqual({ done: true });
  const row = await cardOf(campaign);
  const bytes = (await writableStore()?.read(row?.key as string)) as Buffer;
  expect([row?.mime, isJpeg(bytes), createHash("sha256").update(bytes).digest().equals(row?.sha as Buffer)]).toEqual(["image/jpeg", true, true]);
  const meta = await sharp(bytes).metadata();
  expect(meta.format).toBe("jpeg");
  const inRange = (m: sharp.Metadata) => 0.8 <= (m.width as number) / (m.height as number) && (m.width as number) / (m.height as number) <= 1.91;
  expect(inRange(meta), `${meta.width}x${meta.height}`).toBe(true);
  expect(meta.width).toBeGreaterThanOrEqual(320);
  expect([meta.exif, meta.icc, meta.hasAlpha]).toEqual([undefined, undefined, false]);
  // At the edges of Instagram's range, where rounding the height to whole pixels could step outside it: a phone's
  // portrait (750x1334, taller than 4:5) and a panorama 301 high (wider than 1.91:1).
  for (const [width, height] of [
    [750, 1334],
    [1000, 301],
  ] as const) {
    const edge = await sharp({ create: { width, height, channels: 3, background: "#884422" } }).jpeg().toBuffer();
    expect(await upload(campaign, edge, "image/jpeg"), `${width}x${height}`).toEqual({ done: true });
    const kept = await sharp((await writableStore()?.read((await cardOf(campaign))?.key as string)) as Buffer).metadata();
    expect(inRange(kept), `${width}x${height} stored as ${kept.width}x${kept.height}`).toBe(true);
  }
  expect(await upload(campaign, await tallPng())).toEqual({ done: true });
  const first = (await cardOf(campaign))?.card;
  // A real GIF (a picture sharp could read, but not a type Instagram's card takes), a text file named .png and the
  // empty file are refused with the reason; the card stays.
  const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#22aa22" } }).gif().toBuffer();
  for (const bad of [gif, Buffer.from("not a picture at all"), Buffer.alloc(0)]) expect(await upload(campaign, bad, "image/gif")).toEqual({ error: "card_bad" });
  expect((await cardOf(campaign))?.card).toBe(first);
  // Staff are refused (campaigns are the office's), before the picture is read.
  await signIn(shop.staff);
  expect(await upload(campaign, await tallPng())).toEqual({ error: "refused" });
  // With no store wired, nothing can be attached.
  await signIn(shop.manager);
  swapApiPorts({ media: null });
  expect(await upload(campaign, await tallPng())).toEqual({ error: "invalid" });
  swapApiPorts({});
  expect((await cardOf(campaign))?.card).toBe(first);
  // A manager replaces it with a JPEG, then removes it.
  const jpeg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#3366aa" } }).jpeg().toBuffer();
  expect(await upload(campaign, jpeg, "image/jpeg")).toEqual({ done: true });
  expect((await cardOf(campaign))?.card).not.toBe(first);
  expect(await removeCardAction(null, formOf({ campaign }))).toEqual({ done: true });
  expect((await cardOf(campaign))?.card).toBeNull();
  // Once proposed, the card is fixed.
  expect(await upload(campaign, jpeg, "image/jpeg")).toEqual({ done: true });
  expect(await proposeCampaignAction(null, formOf({ campaign }))).toEqual({ done: true });
  const bound = (await cardOf(campaign))?.card;
  expect(await upload(campaign, jpeg, "image/jpeg")).toEqual({ error: "invalid" });
  expect((await cardOf(campaign))?.card).toBe(bound);
});

it("the composer and the approver see the card on the campaign line (the approver the one the draft bound); the office's card route serves it to an owner or a manager only, never to staff or another shop, never cached", async () => {
  const shop = await sampleShop("Card see");
  const other = await sampleShop("Card other");
  const campaign = await composing(shop.owner);
  const doc = await attachCard(db.app, shop.owner, campaign, await sharp({ create: { width: 800, height: 800, channels: 3, background: "#22aa66" } }).jpeg().toBuffer(), writableStore() as NonNullable<ReturnType<typeof writableStore>>);
  const shown = async (who: Session) => {
    const data = await loadCampaigns(who);
    if (!data) throw new Error("campaigns are the office's");
    cleanup();
    render(
      <LangProvider initial="en">
        <CampaignsView data={data} />
      </LangProvider>,
    );
    return document.querySelector(`[data-card="${doc}"] img`)?.getAttribute("src");
  };
  expect(await shown(shop.owner)).toBe(`/api/office/cards/${doc}.jpg`);
  expect(document.body.textContent).toContain(APP.en.replaceCard);
  await proposeCampaign(db.app, shop.owner, campaign);
  expect(await shown(shop.manager)).toBe(`/api/office/cards/${doc}.jpg`);
  expect(document.body.textContent).toContain(APP.en.cardBound);
  expect(document.body.textContent).not.toContain(APP.en.replaceCard);
  const stored = (await writableStore()?.read((await cardOf(campaign))?.key as string)) as Buffer;
  for (const who of [shop.owner, shop.manager]) {
    await signIn(who);
    const r = await fetchOffice(doc);
    expect([r.status, r.headers.get("content-type"), r.headers.get("cache-control"), r.headers.get("x-content-type-options")]).toEqual([200, "image/jpeg", "private, no-store", "nosniff"]);
    expect(Buffer.from(await r.arrayBuffer()).equals(stored)).toBe(true);
  }
  for (const who of [shop.staff, other.owner]) {
    await signIn(who);
    const r = await fetchOffice(doc);
    expect([r.status, (await r.arrayBuffer()).byteLength]).toEqual([404, 0]);
  }
  state.cookies.clear();
  expect((await fetchOffice(doc)).status, "signed out").toBe(404);
  await signIn(shop.owner);
  expect((await fetchOffice(randomUUID())).status, "unknown").toBe(404);
  // Bytes in the store that are not the document's own are never served.
  const key = (await cardOf(campaign))?.key ?? "";
  const file = path.join(mediaDir, ...key.split("/"));
  writeFileSync(file, Buffer.concat([stored, Buffer.from([0])]));
  expect((await fetchOffice(doc)).status, "other bytes").toBe(404);
  writeFileSync(file, stored);
  expect((await fetchOffice(doc)).status).toBe(200);
  // Not yet approved: the public route serves nothing.
  expect((await publicCardRoute(new Request(`http://localhost/api/cards/${shop.owner.tenantId}/${doc}.jpg`), { params: Promise.resolve({ tenant: shop.owner.tenantId, file: `${doc}.jpg` }) })).status).toBe(404);
});

it("a phone's photo taken sideways, carrying EXIF, is stored upright with no EXIF left; a valid picture over the four-megabyte cap is refused", async () => {
  const shop = await sampleShop("Card upright");
  const campaign = await composing(shop.owner);
  await signIn(shop.owner);
  // Landscape as the sensor wrote it, red on the left and blue on the right, tagged to be turned a quarter clockwise
  // (EXIF orientation 6), so the person saw red on top; with a camera field beside it.
  const blue = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#0000ff" } }).png().toBuffer();
  const sideways = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#ff0000" } })
    .composite([{ input: blue, left: 400, top: 0 }])
    .withExif({ IFD0: { Make: "Synthetic camera", Copyright: "synthetic test image" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const before = await sharp(sideways).metadata();
  expect([before.orientation, before.exif !== undefined]).toEqual([6, true]);
  expect(await upload(campaign, sideways, "image/jpeg")).toEqual({ done: true });
  const stored = (await writableStore()?.read((await cardOf(campaign))?.key as string)) as Buffer;
  const meta = await sharp(stored).metadata();
  expect([meta.exif, meta.orientation, (meta.width as number) < (meta.height as number)]).toEqual([undefined, undefined, true]);
  const [top, bottom] = [await pixel(stored, Math.floor((meta.width as number) / 2), 10), await pixel(stored, Math.floor((meta.width as number) / 2), (meta.height as number) - 10)];
  expect([top[0] > 200 && (top[2] as number) < 60, (bottom[2] as number) > 200 && (bottom[0] as number) < 60], `top ${top} bottom ${bottom}`).toEqual([true, true]);
  // A valid PNG over the cap (noise does not compress), as a browser that could not scale it down would send it.
  const noise = randomBytes(1400 * 1100 * 3);
  const big = await sharp(noise, { raw: { width: 1400, height: 1100, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  expect([big.length > MAX_CARD_UPLOAD, (await sharp(big).metadata()).format]).toEqual([true, "png"]);
  const card = (await cardOf(campaign))?.card;
  expect(await upload(campaign, big)).toEqual({ error: "card_bad" });
  expect((await cardOf(campaign))?.card).toBe(card);
});
