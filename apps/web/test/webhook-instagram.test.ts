// The Instagram webhook through the app's route, on a live-kind database (platform design §5). Meta's subscription
// check answers only our verify token; a POST is read only with its own X-Hub-Signature-256 over the raw body, under the
// Instagram app secret (a missing, forged, other-body or other-secret signature is a 404); a body over the cap is refused
// unread, by its Content-Length or as it streams; without Instagram configured every request is a 404. A signed direct
// message to the configured account is stored once as an ops row for the one shop whose latest Instagram grant grants
// the account's alias (INSTAGRAM_ACCOUNT_REF), never a book row; an account no shop holds granted, another account's
// event and a comment store nothing, and the answer is the same quiet 200 with counts; a STOP there is a message like
// any other (IG1). No token or secret reaches the answer. Red-proofs: db/test/v2/sabotage/live-channels.ts (IGHOOK) and
// db/test/v2/sabotage/instagram.ts (IGIN).
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { grant } from "../../../db/test/v2/core/messaging/lib.ts";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { acceptTenant, asOwner, plant } from "../../../db/test/v2/gates/lib.ts";
import { GET, POST } from "../app/api/webhooks/instagram/route";
import type { Config } from "../lib/server/config";
import { state } from "./app-state";
import { openWebDb, urlAs, type WebDb } from "./home-db";

const APP_SECRET = randomBytes(32).toString("hex");
const VERIFY = "verify-token-for-the-instagram-test";
const ACCOUNT = "17841400000000001";
const TOKEN = `IGAA-${randomBytes(16).toString("hex")}`;

let db: WebDb;
let tenantId: string; // the shop granted "ig_held"
let withdrawnId: string; // a shop that held "ig_gone" and withdrew it

const configured = (over: Partial<Config> = {}, accountRef = "ig_held"): Config =>
  ({
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: tenantId,
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    deployment: "live",
    instagram: { accountRef, businessAccountId: ACCOUNT, accessToken: TOKEN, appSecret: APP_SECRET, verifyToken: VERIFY, graphHost: "graph.instagram.com" },
    ...over,
  }) as Config;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  // Real shops, accepted by the operator: a sample shop takes no channel grant.
  tenantId = (await smallShop(db.app, "Instagram inbound", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  withdrawnId = (await smallShop(db.app, "Instagram withdrawn", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  await grant(db, tenantId, "instagram", true, "ig_held");
  await grant(db, withdrawnId, "instagram", true, "ig_gone");
  await grant(db, withdrawnId, "instagram", false, "ig_gone");
  await db.sabotage();
  state.config = configured();
});
afterAll(async () => {
  const held = globalThis as { munshiPublicPool?: pg.Pool | undefined };
  await held.munshiPublicPool?.end();
  held.munshiPublicPool = undefined;
  await db.close();
});

type Event = { mid: string; text?: string; from?: string };
const body = (events: Event[], account = ACCOUNT, comment?: string) =>
  JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: account,
        time: 1761700000,
        messaging: events.map((e) => ({ sender: { id: e.from ?? "9000000000000001" }, recipient: { id: account }, timestamp: 1761700001, message: { mid: e.mid, text: e.text ?? "Is the kurta in stock?" } })),
        changes: comment ? [{ field: "comments", value: { id: comment, from: { id: "9000000000000002", username: "synthetic_user" }, text: "Kitne ka?" } }] : [],
      },
    ],
  });
const mid = () => `aWdfZAG1${randomUUID().replaceAll("-", "")}`;
const signed = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (raw: string, signature: string | null) =>
  POST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body: raw, headers: signature ? { "x-hub-signature-256": signature } : {} }));
const check = (token: string, challenge = "1158201444") =>
  GET(new Request(`http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`));
const rowsOf = async (providerIds: string[]) =>
  (
    await db.admin.query<{ tenant_id: string; channel: string; account_ref: string; from_address: string; kind: string; text: string; opt_out: boolean; status: string }>(
      `select tenant_id::text, channel, account_ref, from_address, kind, text, opt_out, status from ops.inbound_message where provider_message_id = any($1) order by received_at`,
      [providerIds],
    )
  ).rows;
const books = async () =>
  (
    await db.admin.query<{ n: string }>(
      `select sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from books.%I', table_name), false, true, '')))[1]::text::bigint)::text as n
         from information_schema.tables where table_schema = 'books' and table_type = 'BASE TABLE'`,
    )
  ).rows[0]?.n;

it("IGHOOK Meta's subscription check answers only our verify token", async () => {
  state.config = configured();
  const ok = await check(VERIFY);
  expect([ok.status, await ok.text()]).toEqual([200, "1158201444"]);
  expect((await check("wrong-token")).status).toBe(404);
  expect((await check(VERIFY, "<script>")).status).toBe(404);
});

it("IGHOOK a POST is read only with its own signature under the Instagram app secret: a missing, malformed, forged, other-body or other-secret one is a 404", async () => {
  state.config = configured();
  const id = mid();
  const raw = body([{ mid: id }]);
  const refused = [
    await post(raw, null),
    await post(raw, "sha256=nothex"),
    await post(raw, `sha256=${"0".repeat(64)}`),
    await post(raw, signed(raw, randomBytes(32).toString("hex"))),
    await post(raw, signed(body([{ mid: id }], "17841400000000009"))),
  ];
  expect(refused.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  expect(await Promise.all(refused.map((r) => r.text()))).toEqual(["", "", "", "", ""]);
  expect(await rowsOf([id])).toEqual([]);
  // Signed: read and stored.
  const ok = await post(raw, signed(raw));
  expect([ok.status, await ok.json()]).toEqual([200, { received: 1, stored: 1 }]);
  expect(await rowsOf([id])).toHaveLength(1);
});

it("IGHOOK without Instagram configured every request is a 404, and no answer carries a token or a secret", async () => {
  state.config = configured({ instagram: undefined });
  const raw = body([{ mid: mid() }]);
  expect((await post(raw, signed(raw))).status).toBe(404);
  expect((await check(VERIFY)).status).toBe(404);
  // Without the public pool nothing could be stored: Meta's check fails too, so no subscription can be made to it.
  state.config = configured({ publicDatabaseUrl: undefined });
  expect((await post(raw, signed(raw))).status).toBe(404);
  expect((await check(VERIFY)).status).toBe(404);
  state.config = configured();
  const answers = [await (await post(raw, signed(raw))).text(), await (await check(VERIFY)).text(), await (await check("wrong")).text()].join("\n");
  for (const secret of [TOKEN, APP_SECRET, VERIFY]) expect(answers).not.toContain(secret);
});

it("IGHOOK a body over the cap is refused unread: a Content-Length past it, or a stream that runs past it, is a 404 even when signed", async () => {
  state.config = configured();
  const raw = body([{ mid: mid() }]);
  const claimed = await POST(
    new Request("http://localhost/api/webhooks/instagram", { method: "POST", body: raw, headers: { "x-hub-signature-256": signed(raw), "content-length": "2000000" } }),
  );
  expect(claimed.status).toBe(404);
  const big = JSON.stringify({ object: "instagram", entry: [], pad: "x".repeat(1_000_001) });
  const streamed = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(big));
      c.close();
    },
  });
  const long = await POST(
    new Request("http://localhost/api/webhooks/instagram", { method: "POST", body: streamed, duplex: "half", headers: { "x-hub-signature-256": signed(big) } } as RequestInit),
  );
  expect(long.status).toBe(404);
});

it("IGIN1 a signed direct message is stored once, as an ops row of the shop granted the account, under the grant's alias and the sender's scoped id; a redelivery, and a comment, store nothing more; no book row is written", async () => {
  state.config = configured();
  const before = await books();
  const id = mid();
  const raw = body([{ mid: id, text: "Do you have the green one?", from: "9000000000000011" }], ACCOUNT, `1800${randomBytes(6).readUIntBE(0, 6)}`);
  const first = await post(raw, signed(raw));
  expect([first.status, await first.json()]).toEqual([200, { received: 1, stored: 1 }]);
  const again = await post(raw, signed(raw));
  expect([again.status, await again.json()]).toEqual([200, { received: 1, stored: 0 }]);
  expect(await rowsOf([id])).toEqual([
    { tenant_id: tenantId, channel: "instagram", account_ref: "ig_held", from_address: "9000000000000011", kind: "text", text: "Do you have the green one?", opt_out: false, status: "new" },
  ]);
  // The comment in the same delivery is not an inbox message.
  const comments = await db.admin.query("select 1 from ops.inbound_message where tenant_id = $1 and text = 'Kitne ka?'", [tenantId]);
  expect(comments.rowCount).toBe(0);
  expect(await books()).toBe(before);
});

it("IGIN2 an account no shop holds granted stores nothing, quietly: a withdrawn grant, an alias no grant names, another account's event and an account two shops hold each answer the same 200 with counts only; two holders log a coded warning naming no shop", async () => {
  const quiet = async (config: Config, account = ACCOUNT) => {
    state.config = config;
    const id = mid();
    const raw = body([{ mid: id }], account);
    const r = await post(raw, signed(raw));
    return { status: r.status, answer: await r.text(), rows: (await rowsOf([id])).length };
  };
  const answered = (received: number) => ({ status: 200, answer: JSON.stringify({ received, stored: 0 }), rows: 0 });
  expect(await quiet(configured({}, "ig_gone")), "withdrawn").toEqual(answered(1));
  expect(await quiet(configured({}, "ig_nobody")), "never granted").toEqual(answered(1));
  expect(await quiet(configured(), "17841400000000009"), "another account").toEqual(answered(0));
  // Two shops granted one account (planted past the database's own refusal, MS017): stored for neither, never guessed.
  const twice = (await smallShop(db.app, "Instagram twice", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  const other = (await smallShop(db.app, "Instagram twice too", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  await grant(db, twice, "instagram", true, "ig_twice");
  await grant(db, other, "instagram", true, "ig_twice");
  const warned = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await quiet(configured({}, "ig_twice")), "held twice").toEqual(answered(1));
    const lines = warned.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes('"code":"account_held_twice"'))).toHaveLength(1);
    for (const named of [twice, other, "ig_twice", ACCOUNT]) expect(lines.join("\n")).not.toContain(named);
  } finally {
    warned.mockRestore();
  }
});

it("IGIN4 a shop the sign-up purge removed (its directory row gone, its grant left behind) does not block the shop granted the account now", async () => {
  const purged = (await smallShop(db.app, "Instagram purged", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  const live = (await smallShop(db.app, "Instagram regranted", { accept: (t) => acceptTenant(db.admin, t) })).owner.tenantId;
  await grant(db, purged, "instagram", true, "ig_moved");
  // What ops.purge_pending_signups leaves behind: the directory row deleted, the grant row kept.
  await plant(db.admin, "delete from ops.tenant_directory where tenant_id = $1", [purged]);
  await grant(db, live, "instagram", true, "ig_moved");
  state.config = configured({}, "ig_moved");
  const id = mid();
  const raw = body([{ mid: id }]);
  expect(await (await post(raw, signed(raw))).json()).toEqual({ received: 1, stored: 1 });
  expect((await rowsOf([id])).map((r) => r.tenant_id)).toEqual([live]);
});

it("IGIN5 a store that fails (the public pool unreachable) answers an empty 500, never a 200 for an event not stored, so Meta redelivers it", async () => {
  const held = globalThis as { munshiPublicPool?: pg.Pool | undefined };
  const kept = held.munshiPublicPool;
  held.munshiPublicPool = undefined;
  const warned = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    state.config = configured({ publicDatabaseUrl: "postgres://munshi_public:none@127.0.0.1:1/none" });
    const id = mid();
    const raw = body([{ mid: id }]);
    const r = await post(raw, signed(raw));
    expect([r.status, await r.text()]).toEqual([500, ""]);
    expect(await rowsOf([id])).toEqual([]);
    expect(warned.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"code":"store_failed"'))).toHaveLength(1);
  } finally {
    warned.mockRestore();
    await held.munshiPublicPool?.end();
    held.munshiPublicPool = kept;
    state.config = configured();
  }
});

it("IGIN3 a STOP on Instagram is stored as a message like any other, with no opt-out (IG1)", async () => {
  state.config = configured();
  const id = mid();
  const raw = body([{ mid: id, text: "STOP" }]);
  expect(await (await post(raw, signed(raw))).json()).toEqual({ received: 1, stored: 1 });
  expect((await rowsOf([id])).map((r) => [r.text, r.opt_out])).toEqual([["STOP", false]]);
});
