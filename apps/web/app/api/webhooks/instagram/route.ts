// The Instagram webhook (platform design §5; Meta's docs: developers.facebook.com/documentation/instagram-platform/
// webhooks/setup). Instagram configured only (INSTAGRAM_*): elsewhere every request is a 404, as if the route did not
// exist, and opens no connection.
// - GET is Meta's subscription check: hub.mode=subscribe with our verify token answers its challenge, anything else 404.
// - POST reads at most MAX_BODY bytes (a larger Content-Length is refused unread), checks X-Hub-Signature-256 over the
//   raw body under INSTAGRAM_APP_SECRET before anything is parsed (a missing, forged or other-secret signature is a
//   404 too), then stores each direct message to the configured account (INSTAGRAM_BUSINESS_ACCOUNT_ID) as an ops row
//   through core (receiveInstagram, on the public pool), its account_ref the alias the grant names
//   (INSTAGRAM_ACCOUNT_REF): only for the shop whose latest Instagram grant grants that account, once per Meta message
//   id. Never a book row, never a model call. An event for no granted shop, or for another account, stores nothing and
//   is still answered 200 with counts only: the answer never says which shops exist. A STOP is a message like any other
//   (IG1). Comments are read by the parser but not stored: the inbox has no way to mark one apart from a message.
//   The setup guide says the app secret signs; UNVERIFIED whether, under Instagram Login, that is the Instagram app
//   secret shown on the Instagram product's page or the Meta app's own (App settings > Basic): set the one Meta signs
//   with, and a wrong one shows as every POST refused.
// Nothing from the body is logged; the answer carries counts only. A store that fails (the database unreachable, or its
// refusal of a grant that moved meanwhile) answers an empty 500, never a 200, so Meta redelivers the event.
import { timingSafeEqual } from "node:crypto";
import { parseInstagramWebhook, verifyMetaSignature } from "@munshi/adapters/channels";
import { log, receiveInstagram } from "@munshi/core";
import { config } from "../../../../lib/server/config.ts";
import { publicPool } from "../../../../lib/server/db.ts";
import { readCapped } from "../../../../lib/server/webhook-body.ts";

const notFound = () => new Response(null, { status: 404 });
const MAX_BODY = 1_000_000;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Both methods need the public pool, so Meta's check never succeeds for a route whose events could not be stored.
export async function GET(request: Request): Promise<Response> {
  const c = config();
  const ig = c.publicDatabaseUrl ? c.instagram : undefined;
  if (!ig) return notFound();
  const q = new URL(request.url).searchParams;
  const challenge = q.get("hub.challenge") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !same(q.get("hub.verify_token") ?? "", ig.verifyToken) || !/^[0-9A-Za-z_-]{1,128}$/.test(challenge)) {
    return notFound();
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const c = config();
  const ig = c.instagram;
  if (!ig || !c.publicDatabaseUrl) return notFound();
  const raw = await readCapped(request, MAX_BODY);
  if (!raw || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), ig.appSecret)) return notFound();
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return notFound();
  }
  // Only our own account's direct messages: another account's (a misrouted subscription) are ignored.
  const messages = parseInstagramWebhook(payload).filter((x) => x.accountId === ig.businessAccountId && x.source === "message");
  let stored = 0;
  try {
    const pool = publicPool();
    for (const m of messages) {
      if (await receiveInstagram(pool, ig.accountRef, { providerMessageId: m.providerMessageId, from: m.from, kind: m.kind, text: m.text })) stored++;
    }
  } catch {
    log("webhook.instagram_failed", { code: "store_failed" }, "warn");
    return new Response(null, { status: 500 });
  }
  return Response.json({ received: messages.length, stored });
}
