// The WhatsApp Cloud webhook. WhatsApp configured only (any deployment may hold
// the credentials; a message is stored only through a number a shop listed): elsewhere every request is a 404, as
// if the route did not exist, and opens no connection.
// - GET is Meta's subscription check: hub.mode=subscribe with our verify token answers its challenge, anything else 404.
// - POST checks X-Hub-Signature-256 over the raw body before anything is parsed (a missing, forged or other-secret
//   signature is a 404 too), then stores each inbound message and status as ops rows through core (receiveInbound,
//   recordProviderStatus on the public pool): never a book row, never a model call. A number no shop routes is dropped.
// Nothing from the body is logged; the answer carries counts only.
import { timingSafeEqual } from "node:crypto";
import { parseWhatsAppWebhook, verifyWhatsAppSignature } from "@munshi/adapters/channels";
import { receiveInbound, recordProviderStatus } from "@munshi/core";
import { config } from "../../../../lib/server/config.ts";
import { publicPool } from "../../../../lib/server/db.ts";
import { readCapped } from "../../../../lib/server/webhook-body.ts";

const notFound = () => new Response(null, { status: 404 });
const MAX_BODY = 1_000_000;

// The deployment's WhatsApp settings and the route key.
function wiring() {
  const c = config();
  if (!c.whatsapp || !c.phoneRouteSecret || !c.publicDatabaseUrl) return null;
  return { whatsapp: c.whatsapp, routeKey: Buffer.from(c.phoneRouteSecret, "utf8") };
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request): Promise<Response> {
  const w = wiring();
  if (!w) return notFound();
  const q = new URL(request.url).searchParams;
  const challenge = q.get("hub.challenge") ?? "";
  if (q.get("hub.mode") !== "subscribe" || !same(q.get("hub.verify_token") ?? "", w.whatsapp.verifyToken) || !/^[0-9A-Za-z_-]{1,128}$/.test(challenge)) {
    return notFound();
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const w = wiring();
  if (!w) return notFound();
  const raw = await readCapped(request, MAX_BODY); // a larger Content-Length is refused unread
  if (!raw || !verifyWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"), w.whatsapp.appSecret)) return notFound();
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return notFound();
  }
  const { messages, statuses } = parseWhatsAppWebhook(payload);
  const pool = await publicPool();
  let stored = 0;
  let moved = 0;
  // Only our own number's events: another number's (a misrouted subscription) are ignored.
  for (const m of messages.filter((x) => x.phoneNumberId === w.whatsapp.phoneNumberId)) {
    if (await receiveInbound(pool, w.routeKey, { providerMessageId: m.providerMessageId, from: m.from, kind: m.kind, text: m.text })) stored++;
  }
  for (const s of statuses.filter((x) => x.phoneNumberId === w.whatsapp.phoneNumberId)) {
    if (await recordProviderStatus(pool, w.routeKey, { providerMessageId: s.providerMessageId, status: s.status, recipient: s.recipient, errorCode: s.errorCode })) moved++;
  }
  return Response.json({ stored, moved });
}
