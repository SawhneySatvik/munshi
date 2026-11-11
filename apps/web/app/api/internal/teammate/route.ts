// One chat message, from the relay (apps/teammate), which sends `Authorization: Bearer <MUNSHI_TEAMMATE_SECRET>`.
// Anything else is a 404, as if the route did not exist, and opens no database connection. An unset or empty secret
// admits no one. The relay vouches only for which chat account sent the message; what that account may do is decided
// from its link and the member's role, never from this body.
import { createHash, timingSafeEqual } from "node:crypto";
import { teammateSettings } from "@munshi/config";
import { tenantOf } from "@munshi/core";
import { z } from "zod";
import { appPool } from "../../../../lib/server/db.ts";
import { answerTurn } from "../../../../lib/server/teammate.ts";

const Body = z.strictObject({
  shop: z.string().min(1).max(40),
  channel: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  sender: z.string().min(1).max(200),
  text: z.string().max(4000),
});

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(request: Request): boolean {
  const { secret } = teammateSettings();
  const given = request.headers.get("authorization") ?? "";
  return secret !== "" && timingSafeEqual(digest(given), digest(`Bearer ${secret}`));
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid" }, { status: 400 });
  const { shop, ...turn } = body.data;
  const tenantId = await tenantOf(await appPool(), shop);
  if (!tenantId) return Response.json({ error: "unknown_shop" }, { status: 404 });
  return Response.json({ reply: await answerTurn(tenantId, turn) });
}
