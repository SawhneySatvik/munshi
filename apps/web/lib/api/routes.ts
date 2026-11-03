// The handlers of API v1, one per operation of packages/contracts' route table. The app/api/v1 route
// files export these. The deferred operations (findings, drafts, proposeDraft) have none: they answer the one 404.
// Every figure is built by core's site API from the latest release's cells; the writes are ops rows only.
import { createHash } from "node:crypto";
import { ApiRefusal, siteApi } from "@munshi/core";
import { keyed } from "./deps.ts";
import { notFound, requestIdOf } from "./http.ts";
import { type Handler, readRoute, type RouteCtx, writeRoute } from "./pipeline.ts";

type Q = Record<string, string | number | undefined>;
const page = (q: Q) => ({ cursor: q.cursor as string | undefined, limit: q.limit as number | undefined });

export const site = readRoute("site", "/api/v1/sites/[slug]", ({ deps, site }) => siteApi.siteView(deps.pub, site), { etag: (s) => `"${s.release.id}"` });

export const catalogue = readRoute("catalogue", "/api/v1/sites/[slug]/catalogue", ({ deps, site, query }) =>
  siteApi.catalogueView(deps.pub, site, { ...page(query as Q), category: (query as Q).category as string | undefined }),
);

export const services = readRoute("services", "/api/v1/sites/[slug]/services", ({ deps, site, query }) => siteApi.servicesView(deps.pub, site, page(query as Q)));

export const packages = readRoute("packages", "/api/v1/sites/[slug]/packages", ({ deps, site, query }) => siteApi.packagesView(deps.pub, site, page(query as Q)));

export const offers = readRoute("offers", "/api/v1/sites/[slug]/offers", ({ deps, site, query }) => siteApi.offersView(deps.pub, site, page(query as Q)));

export const stylists = readRoute("stylists", "/api/v1/sites/[slug]/stylists", ({ deps, site, query }) =>
  siteApi.stylistsView(deps.pub, site, { ...page(query as Q), shop: (query as Q).shop as string | undefined }),
);

export const slots = readRoute("slots", "/api/v1/sites/[slug]/slots", ({ deps, site, query }) => {
  const q = query as { shop: string; service: string; date: string; stylist?: string };
  return siteApi.slotsView(deps.pub, site, q);
});

export const ref = readRoute("ref", "/api/v1/sites/[slug]/refs/[snapshot]/[row]/[col]", ({ deps, site, params }) =>
  siteApi.refView(deps.pub, site, params as { snapshot: string; row: number; col: string }),
);

// The code is the capability: an unknown code answers the one 404, as a malformed one does.
export const orderStatus = readRoute("orderStatus", "/api/v1/sites/[slug]/orders/[code]", async ({ deps, site, params }) => {
  const view = await siteApi.orderStatusView(deps.pub, site, params.code as string);
  if (!view) throw new ApiRefusal("not_found");
  return view;
});

// GET /sites/{slug}/media/{id}.jpg|.svg: one route file serves both; `file` is `<id>.<ext>`.
const FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|svg)$/;
export const media: Handler = async (req, ctx: RouteCtx) => {
  const p = await ctx.params;
  const m = typeof p.file === "string" ? FILE.exec(p.file) : null;
  if (!m) return notFound(requestIdOf(req));
  const [, id, ext] = m as unknown as [string, string, "jpg" | "svg"];
  const routeName = ext === "jpg" ? "mediaJpg" : "mediaSvg";
  let bytes: Buffer | null = null;
  let mime = "";
  const found = await readRoute(routeName, "/api/v1/sites/[slug]/media/[file]", async ({ deps, site }) => {
    const doc = await siteApi.mediaDocument(deps.pub, site, id, ext);
    const read = doc ? await deps.media.read(doc.storageKey) : null;
    // The bytes must be the document's own (its stored sha256), or nothing is served.
    if (!doc || !read || !createHash("sha256").update(read).digest().equals(doc.sha256)) throw new ApiRefusal("not_found");
    bytes = read;
    mime = doc.mime;
    return null;
  })(req, { params: Promise.resolve({ slug: p.slug, id }) });
  if (found.status !== 200 || !bytes) return found;
  const headers = new Headers(found.headers);
  headers.set("content-type", mime);
  headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return new Response(new Uint8Array(bytes as Buffer), { status: 200, headers });
};

// ---- Writes ----

const holdToken = (secret: Buffer, siteId: string, key: string) => keyed(secret, "hold", `${siteId}:${key}`).toString("base64url");
type Body<T> = T & { botToken?: string; website?: string };
const strip = <T extends Record<string, unknown>>(b: T) => {
  const { botToken: _t, website: _w, ...rest } = b;
  return rest;
};

export const hold = writeRoute("hold", "/api/v1/sites/[slug]/holds", async ({ deps, site, body, headers, key, ipHash, botCheck }) => {
  const r = await siteApi.placeSiteHold(deps.pub, site, strip(body) as unknown as siteApi.HoldBody, {
    key,
    ipHash,
    deviceHash: keyed(deps.secret, "device", headers["X-Munshi-Device"] as string),
    holdToken: holdToken(deps.secret, site.siteId, key),
    before: botCheck,
  });
  return r.answer;
});

export const releaseHold = writeRoute("releaseHold", "/api/v1/sites/[slug]/holds/[id]", async ({ deps, site, params, headers, key }) => {
  const r = await siteApi.releaseSiteHold(deps.pub, site, params.id as string, { key, holdToken: headers["X-Hold-Token"] as string });
  return r.answer;
});

export const book = writeRoute("book", "/api/v1/sites/[slug]/bookings", async ({ deps, site, body, key, ipHash, botCheck }) => {
  const r = await siteApi.bookSite(deps.pub, site, strip(body as Body<siteApi.BookingBody>), { key, ipHash, before: botCheck });
  return r.answer;
});

export const requestBooking = writeRoute("requestBooking", "/api/v1/sites/[slug]/booking-requests", async ({ deps, site, body, key, ipHash, botCheck }) => {
  const r = await siteApi.requestSiteBooking(deps.pub, site, strip(body as Body<siteApi.BookingRequestBody>), { key, ipHash, before: botCheck });
  return r.answer;
});

export const enquire = writeRoute("enquire", "/api/v1/sites/[slug]/enquiries", async ({ deps, site, body, key, ipHash, botCheck }) => {
  const r = await siteApi.enquireSite(deps.pub, site, strip(body as Body<siteApi.EnquiryBody>), { key, ipHash, before: botCheck });
  return r.answer;
});

export const reserve = writeRoute("reserve", "/api/v1/sites/[slug]/reservations", async ({ deps, site, body, key, ipHash, botCheck }) => {
  const r = await siteApi.reserveSite(deps.pub, site, strip(body as Body<siteApi.ReservationBody>), { key, ipHash, before: botCheck });
  return r.answer;
});

export const order = writeRoute("order", "/api/v1/sites/[slug]/orders", async ({ deps, site, body, key, ipHash }) => {
  const r = await siteApi.orderSite(deps.pub, site, body as unknown as siteApi.OrderBody, { key, ipHash });
  return r.answer;
});
