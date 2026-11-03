// BP-F3b: the WhatsApp webhook through the app's route, on a live-kind database. Meta's subscription check answers
// only our verify token; a POST is read only with its own X-Hub-Signature-256 over the raw body; a signed message from
// a routed number is stored once, as an ops row, and a replay or a stranger's stores nothing; no books row is ever
// written; without WhatsApp configured (its settings or the route key) every request is a 404, while a demo deployment
// holding them answers as a live one does (D-080: any deployment may hold channel credentials).
import { createHmac, randomBytes } from "node:crypto";
import { listTestRecipient, startSession } from "@munshi/core";
import type pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { customer, grant } from "../../../db/test/v2/core/messaging/lib.ts";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { acceptTenant, asOwner } from "../../../db/test/v2/gates/lib.ts";
import { GET, POST } from "../app/api/webhooks/whatsapp/route";
import type { Config } from "../lib/server/config";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";

const APP_SECRET = randomBytes(32).toString("hex");
const ROUTE_SECRET = randomBytes(32).toString("hex");
const VERIFY = "verify-token-for-the-webhook-test";
const NUMBER_ID = "1000000001";

let db: WebDb;
let phone: string;
let tenantId: string;

const live = (over: Partial<Config> = {}): Config =>
  ({
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: tenantId,
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    deployment: "live",
    whatsapp: { accessToken: "EAAG-test", phoneNumberId: NUMBER_ID, appSecret: APP_SECRET, verifyToken: VERIFY },
    phoneRouteSecret: ROUTE_SECRET,
    ...over,
  }) as Config;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  // A real shop, accepted by the operator (D-080): a sample shop takes no channel grant.
  const shop = await smallShop(db.app, "Webhook", { accept: (t) => acceptTenant(db.admin, t) });
  tenantId = shop.owner.tenantId;
  const owner = (await startSession(db.app, tenantId, shop.owner.memberId, "real")).session;
  const person = await customer(db.app, owner);
  phone = person.phone;
  await grant(db, tenantId, "whatsapp");
  await listTestRecipient(db.app, owner, { contactId: person.contact }, Buffer.from(ROUTE_SECRET, "utf8"));
  state.config = live();
});
afterAll(async () => {
  const held = globalThis as { munshiPublicPool?: pg.Pool | undefined };
  await held.munshiPublicPool?.end();
  held.munshiPublicPool = undefined;
  await db.close();
});

const body = (messageId: string, from = phone.slice(1), text = "Do you have it in blue?") =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: NUMBER_ID }, messages: [{ id: messageId, from, type: "text", text: { body: text } }] } }] }],
  });
const signed = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (raw: string, signature: string | null) =>
  POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw, headers: signature ? { "x-hub-signature-256": signature } : {} }));
const stored = async () => Number((await db.admin.query("select count(*) as n from ops.inbound_message where tenant_id = $1", [tenantId])).rows[0].n);
const books = async () =>
  (
    await db.admin.query<{ n: string }>(
      `select sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from books.%I', table_name), false, true, '')))[1]::text::bigint)::text as n
         from information_schema.tables where table_schema = 'books' and table_type = 'BASE TABLE'`,
    )
  ).rows[0]?.n;

it("F3b Meta's subscription check answers only our verify token", async () => {
  const check = (token: string) => GET(new Request(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`));
  const ok = await check(VERIFY);
  expect([ok.status, await ok.text()]).toEqual([200, "1158201444"]);
  expect((await check("wrong-token")).status).toBe(404);
});

it("F3b a POST is read only with its own signature: a missing, forged or other-secret one is a 404 and stores nothing", async () => {
  const raw = body("wamid.sig-1");
  const before = await stored();
  expect((await post(raw, null)).status).toBe(404);
  expect((await post(raw, `sha256=${"0".repeat(64)}`)).status).toBe(404);
  expect((await post(raw, signed(raw, randomBytes(32).toString("hex")))).status).toBe(404);
  expect((await post(raw, signed(body("wamid.other")))).status).toBe(404); // another body's signature
  expect(await stored()).toBe(before);
});

it("F3b a signed message from a routed number is stored once as an ops row; a replay and a stranger store nothing; no books row is written", async () => {
  const booksBefore = await books();
  const raw = body("wamid.ok-1");
  const first = await post(raw, signed(raw));
  expect([first.status, await first.json()]).toEqual([200, { stored: 1, moved: 0 }]);
  const again = await post(raw, signed(raw));
  expect(await again.json()).toEqual({ stored: 0, moved: 0 });
  const stranger = body("wamid.stranger-1", "919800000999");
  expect(await (await post(stranger, signed(stranger))).json()).toEqual({ stored: 0, moved: 0 });
  const { rows } = await db.admin.query("select channel, kind, text, from_address from ops.inbound_message where provider_message_id = 'wamid.ok-1'");
  expect(rows).toEqual([{ channel: "whatsapp", kind: "text", text: "Do you have it in blue?", from_address: phone }]);
  expect(await books()).toBe(booksBefore);
});

it("F3b without WhatsApp configured, or without the route key, every request is a 404; a demo deployment holding them answers Meta's check", async () => {
  const raw = body("wamid.demo-1");
  const check = () => GET(new Request(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`));
  for (const config of [live({ whatsapp: undefined }), live({ phoneRouteSecret: undefined })]) {
    state.config = config;
    expect((await post(raw, signed(raw))).status).toBe(404);
    expect((await check()).status).toBe(404);
  }
  state.config = live({ deployment: "demo" });
  expect((await check()).status).toBe(200);
  state.config = live();
});

it("F3b a body over the cap is refused unread: a Content-Length past it is a 404 even when signed, and stores nothing", async () => {
  state.config = live();
  const raw = body("wamid.big-1");
  const before = await stored();
  const r = await POST(
    new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": signed(raw), "content-length": "2000000" } }),
  );
  expect(r.status).toBe(404);
  expect(await stored()).toBe(before);
});
