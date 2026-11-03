// The Instagram webhook through the app's route (platform design §5). Meta's subscription check answers only our verify
// token; a POST is read only with its own X-Hub-Signature-256 over the raw body, under the Instagram app secret (a
// missing, forged, other-body or other-secret signature is a 404); a body over the cap is refused unread, by its
// Content-Length or as it streams; a signed body is read for the configured account only and, since nothing is stored
// yet, answered 503 so Meta retries instead of dropping it; without Instagram configured every request is a 404. No
// token or secret reaches the answer. Red-proofs: db/test/v2/sabotage/live-channels.ts.
import { createHmac, randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import { GET, POST } from "../app/api/webhooks/instagram/route";
import type { Config } from "../lib/server/config";
import { state } from "./app-state";

const APP_SECRET = randomBytes(32).toString("hex");
const VERIFY = "verify-token-for-the-instagram-test";
const ACCOUNT = "17841400000000001";
const TOKEN = `IGAA-${randomBytes(16).toString("hex")}`;

const configured = (over: Partial<Config> = {}): Config =>
  ({
    databaseUrl: "postgres://munshi_app:unused@127.0.0.1:1/unused",
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: "019a0000-0000-7000-8000-0000000000aa",
    deployment: "demo",
    instagram: { accountRef: "founder_pro", businessAccountId: ACCOUNT, accessToken: TOKEN, appSecret: APP_SECRET, verifyToken: VERIFY, graphHost: "graph.instagram.com" },
    ...over,
  }) as Config;

const body = (account = ACCOUNT) =>
  JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: account,
        time: 1761700000,
        messaging: [{ sender: { id: "9000000000000001" }, recipient: { id: account }, timestamp: 1761700001, message: { mid: "aWdfZAG1", text: "Price?" } }],
        changes: [{ field: "comments", value: { id: "18000000000000001", from: { id: "9000000000000002", username: "synthetic_user" }, text: "Kitne ka?" } }],
      },
    ],
  });
const signed = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
const post = (raw: string, signature: string | null) =>
  POST(new Request("http://localhost/api/webhooks/instagram", { method: "POST", body: raw, headers: signature ? { "x-hub-signature-256": signature } : {} }));
const check = (token: string, challenge = "1158201444") =>
  GET(new Request(`http://localhost/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=${challenge}`));

it("IGHOOK Meta's subscription check answers only our verify token", async () => {
  state.config = configured();
  const ok = await check(VERIFY);
  expect([ok.status, await ok.text()]).toEqual([200, "1158201444"]);
  expect((await check("wrong-token")).status).toBe(404);
  expect((await check(VERIFY, "<script>")).status).toBe(404);
});

it("IGHOOK a POST is read only with its own signature under the Instagram app secret: a missing, malformed, forged, other-body or other-secret one is a 404", async () => {
  state.config = configured();
  const raw = body();
  const refused = [
    await post(raw, null),
    await post(raw, "sha256=nothex"),
    await post(raw, `sha256=${"0".repeat(64)}`),
    await post(raw, signed(raw, randomBytes(32).toString("hex"))),
    await post(raw, signed(body("17841400000000009"))),
  ];
  expect(refused.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
  // Read, and not stored: a failure status, so Meta retries rather than dropping it as handled.
  const ok = await post(raw, signed(raw));
  expect([ok.status, await ok.json()]).toEqual([503, { received: 2, stored: 0 }]);
  // Another account's events, signed, are not ours.
  const other = body("17841400000000009");
  expect(await (await post(other, signed(other))).json()).toEqual({ received: 0, stored: 0 });
});

it("IGHOOK without Instagram configured every request is a 404, and no answer carries a token or a secret", async () => {
  state.config = configured({ instagram: undefined });
  const raw = body();
  expect((await post(raw, signed(raw))).status).toBe(404);
  expect((await check(VERIFY)).status).toBe(404);
  state.config = configured();
  const answers = [await (await post(raw, signed(raw))).text(), await (await check(VERIFY)).text(), await (await check("wrong")).text()].join("\n");
  for (const secret of [TOKEN, APP_SECRET, VERIFY]) expect(answers).not.toContain(secret);
});

it("IGHOOK a body over the cap is refused unread: a Content-Length past it, or a stream that runs past it, is a 404 even when signed", async () => {
  state.config = configured();
  const raw = body();
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
