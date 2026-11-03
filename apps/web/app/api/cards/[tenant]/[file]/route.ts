// GET /api/cards/{tenant}/{document}.jpg: an Instagram post's picture, where Meta fetches it (it takes a public URL,
// with no cookie; channels.ts's mediaUrlFor gives this address). Only a card an approved or sent Instagram campaign of
// that shop names is served (core's publicCard, under the public role's policies), and only bytes whose sha256 is the
// document's own; anything else, a malformed path, an unwired media store or public pool among them, is the one empty
// 404. Before any card is looked up, the caller's IP is counted against /api/v1's read limit (the same helper and
// bucket, hitRate's api.read.ip, on a keyed hash of the IP): past it, an empty 429 with Retry-After. The answer is the
// JPEG alone: no shop name, no campaign, no id beyond the path asked for.
import { createHash } from "node:crypto";
import { hitRate, publicCard } from "@munshi/core";
import { apiDeps, keyed, mediaStore } from "../../../../../lib/api/deps.ts";
import { requestIp } from "../../../../../lib/api/pipeline.ts";
import { config } from "../../../../../lib/server/config.ts";
import { UUID, UUID_TEXT } from "../../../../../lib/parse.ts";

const FILE = new RegExp(`^(${UUID_TEXT})\\.jpg$`);
const NO_STORE = { "cache-control": "no-store" };
const notFound = () => new Response(null, { status: 404, headers: NO_STORE });

export async function GET(request: Request, ctx: { params: Promise<{ tenant: string; file: string }> }): Promise<Response> {
  const { tenant, file } = await ctx.params;
  const id = FILE.exec(file)?.[1];
  const store = mediaStore();
  if (!UUID.test(tenant) || !id || !store || !config().publicDatabaseUrl) return notFound();
  const deps = apiDeps();
  const hit = await hitRate(deps.pub, "api.read.ip", keyed(deps.secret, "ip", requestIp(request.headers)));
  if (!hit.allowed) return new Response(null, { status: 429, headers: { ...NO_STORE, "retry-after": String(hit.retryAfter) } });
  const card = await publicCard(deps.pub, tenant, id);
  const bytes = card ? await store.read(card.storageKey) : null;
  if (!card || !bytes || !createHash("sha256").update(bytes).digest().equals(card.sha256)) return notFound();
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { ...NO_STORE, "content-type": "image/jpeg", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
