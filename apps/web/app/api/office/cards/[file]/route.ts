// GET /api/office/cards/{document}.jpg: a campaign's card for the office's own screen (the composer, and the approver
// deciding a post), before any public address serves it. Under /api so the request hook gives it a handler's CSP; the
// person is the session cookie's, as on the pages. Only the signed-in member's shop, only an owner or a manager
// (core's memberCard), only a card some campaign names, and only bytes whose sha256 is the document's own;
// anything else is the one empty 404. Never cached, never sniffed, never a page.
import { createHash } from "node:crypto";
import { memberCard } from "@munshi/core";
import { cookies } from "next/headers";
import { mediaStore } from "../../../../../lib/api/deps";
import { appPool } from "../../../../../lib/server/db";
import { UUID_TEXT } from "../../../../../lib/parse";
import { sessionFrom } from "../../../../../lib/server/session";

const FILE = new RegExp(`^(${UUID_TEXT})\\.jpg$`);
const PRIVATE = { "cache-control": "private, no-store" };
const notFound = () => new Response(null, { status: 404, headers: PRIVATE });

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const id = FILE.exec((await ctx.params).file)?.[1];
  const store = mediaStore();
  const session = await sessionFrom(await cookies());
  if (!id || !store || !session) return notFound();
  const card = await memberCard(await appPool(), session, id).catch(() => null);
  const bytes = card ? await store.read(card.storageKey) : null;
  if (!card || !bytes || !createHash("sha256").update(bytes).digest().equals(card.sha256)) return notFound();
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { ...PRIVATE, "content-type": "image/jpeg", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
