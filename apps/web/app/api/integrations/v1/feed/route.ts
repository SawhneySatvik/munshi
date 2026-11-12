// The integration feed (Zapier, Postman; docs/zapier.md), for a server that sends `Authorization: Bearer
// <MUNSHI_INTEGRATION_SECRET>`: one shop's PayPal links, the PayPal payments its books do not show yet, and its findings.
// Read only: core's readIntegrationFeed reads in a READ ONLY transaction, with the shop's context and no actor, and mints
// nothing. A wrong or missing key, an unset or short secret, a malformed or unknown shop and a real shop all get the same
// bare 404, as if the route did not exist; a refused key opens no database connection.
import { createHash, timingSafeEqual } from "node:crypto";
import { integrationSettings } from "@munshi/config";
import { readIntegrationFeed } from "@munshi/core/integration";
import { appPool } from "../../../../../lib/server/db.ts";

const SLUG = /^[a-z][a-z0-9-]{2,39}$/;

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(request: Request): boolean {
  const { secret } = integrationSettings();
  const given = request.headers.get("authorization") ?? "";
  return secret !== "" && timingSafeEqual(digest(given), digest(`Bearer ${secret}`));
}

const nothing = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return nothing();
  const shop = new URL(request.url).searchParams.get("shop") ?? "";
  if (!SLUG.test(shop)) return nothing();
  const feed = await readIntegrationFeed(await appPool(), shop);
  if (!feed) return nothing();
  return Response.json(feed, { headers: { "cache-control": "no-store" } });
}
