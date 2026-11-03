// The Instagram webhook (platform design §5; Meta's docs: developers.facebook.com/documentation/instagram-platform/
// webhooks/setup). Instagram configured only (INSTAGRAM_*): elsewhere every request is a 404, as if the route did not
// exist, and opens no connection.
// - GET is Meta's subscription check: hub.mode=subscribe with our verify token answers its challenge, anything else 404.
// - POST reads at most MAX_BODY bytes (a larger Content-Length is refused unread), checks X-Hub-Signature-256 over the
//   raw body under INSTAGRAM_APP_SECRET before anything is parsed (a missing, forged or other-secret signature is a
//   404 too), then reads the configured account's direct messages and comments. The setup guide says the app secret
//   signs; UNVERIFIED whether, under Instagram Login, that is the Instagram app secret shown on the Instagram product's
//   page or the Meta app's own (App settings > Basic): set the one Meta signs with, and a wrong one shows as every POST
//   refused.
// Nothing is stored yet: the public role cannot read which shop's grant names the account (platform.channel_grant), and
// the inbox routes by a phone's HMAC, which an Instagram-scoped id is not (the migrator's DDL). So a signed event is
// answered 503, not 200: a 200 tells Meta the event was handled and it is gone for good; a failure makes Meta retry for
// 36 hours. Meta may disable a webhook that keeps failing, so the founder subscribes this one only once inbound is
// stored; until then only the GET check is used. Nothing from the body is logged; the answer carries counts only.
import { timingSafeEqual } from "node:crypto";
import { parseInstagramWebhook, verifyMetaSignature } from "@munshi/adapters/channels";
import { config } from "../../../../lib/server/config.ts";
import { readCapped } from "../../../../lib/server/webhook-body.ts";

const notFound = () => new Response(null, { status: 404 });
const MAX_BODY = 1_000_000;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request): Promise<Response> {
  const ig = config().instagram;
  if (!ig) return notFound();
  const q = new URL(request.url).searchParams;
  const challenge = q.get("hub.challenge") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !same(q.get("hub.verify_token") ?? "", ig.verifyToken) || !/^[0-9A-Za-z_-]{1,128}$/.test(challenge)) {
    return notFound();
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const ig = config().instagram;
  if (!ig) return notFound();
  const raw = await readCapped(request, MAX_BODY);
  if (!raw || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), ig.appSecret)) return notFound();
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return notFound();
  }
  // Only our own account's events: another account's (a misrouted subscription) are ignored.
  const received = parseInstagramWebhook(payload).filter((x) => x.accountId === ig.businessAccountId).length;
  return Response.json({ received, stored: 0 }, { status: 503 });
}
