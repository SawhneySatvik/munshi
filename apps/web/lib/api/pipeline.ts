// The common path of every /api/v1 route (the rules routes.ts's header names). In order:
// the IP's rate limit; the path parameters, where a failure is the one 404; the site the slug names, verified and
// published, else that 404; the Origin; for a write, the publishable key (a bad, revoked or other slug's key is that
// 404), the key's own limit, Idempotency-Key, JSON only, at most 4 KB, the strict body; then the handler, whose answer is
// parsed with the contract's response schema before it is sent. Errors are the contract's codes; anything else is
// `internal`, logged by code and request id only.
import "server-only";
import { type OperationId, routes } from "@munshi/contracts";
import { ApiRefusal, CoreError, hitRate, log, openSite, originAllowed, type SiteCtx, siteKeyId, withRequest } from "@munshi/core";
import type { z } from "zod";
import { type ApiDeps, apiDeps, keyed } from "./deps.ts";
import { apiError, json, notFound, requestIdOf } from "./http.ts";

export type RouteCtx = { params: Promise<Record<string, string | string[] | undefined>> };
export type Handler = (req: Request, ctx: RouteCtx) => Promise<Response>;

const MAX_BODY = 4096;

/** The request's IP as its first proxy hop reports it (as sign-in reads it); only its keyed hash goes further. */
export const requestIp = (h: Headers): string => h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

const fieldsOf = (err: z.ZodError) => err.issues.map((i) => i.path.join(".") || "(body)");

class Answer {
  constructor(readonly response: Response) {}
}

/** A refusal as its response; anything not the API's own is `internal`, logged with its code only. */
function failure(err: unknown, route: string, requestId: string, origin: string | null): Response {
  if (err instanceof Answer) return err.response;
  if (err instanceof ApiRefusal && err.code !== "internal") {
    return apiError(err.code, requestId, { fields: err.fields, origin, ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}) });
  }
  const code = err instanceof CoreError ? err.code : err instanceof ApiRefusal ? "internal" : "unexpected";
  withRequest({ requestId }, () => log("api.internal", { route, code, ...(err instanceof CoreError && err.sqlstate ? { sqlstate: err.sqlstate } : {}) }, "error"));
  return apiError("internal", requestId, { origin });
}

async function rateLimited(deps: ApiDeps, limit: "api.read.ip" | "api.write.ip" | "api.write.key", subject: Buffer | string, requestId: string, origin: string | null) {
  const hit = await hitRate(deps.pub, limit, subject);
  if (!hit.allowed) throw new Answer(apiError("rate_limited", requestId, { retryAfter: hit.retryAfter, origin }));
}

// Path parameters, raw: a catch-all segment or a missing one is no parameter at all.
async function rawParams(ctx: RouteCtx): Promise<Record<string, string>> {
  const p = await ctx.params;
  return Object.fromEntries(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === "string"));
}

async function siteOf(deps: ApiDeps, schema: z.ZodType | undefined, raw: Record<string, string>, requestId: string) {
  const parsed = schema?.safeParse(raw);
  if (!parsed?.success) throw new Answer(notFound(requestId));
  const params = parsed.data as Record<string, unknown> & { slug: string };
  const site = await openSite(deps.pub, params.slug);
  if (!site) throw new Answer(notFound(requestId));
  return { params, site };
}

function queryOf(req: Request, schema: z.ZodType | undefined, requestId: string, origin: string | null): unknown {
  const url = new URL(req.url);
  const keys = [...url.searchParams.keys()];
  if (!schema) {
    if (keys.length) throw new Answer(apiError("invalid", requestId, { fields: keys, origin }));
    return {};
  }
  if (new Set(keys).size !== keys.length) throw new Answer(apiError("invalid", requestId, { fields: keys, origin }));
  const r = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!r.success) throw new Answer(apiError("invalid", requestId, { fields: fieldsOf(r.error), origin }));
  return r.data;
}

function answer(name: OperationId, body: unknown, route: string, requestId: string): unknown {
  const schema = routes[name].response;
  if (typeof schema === "string") return body;
  const r = schema.safeParse(body);
  if (!r.success) {
    withRequest({ requestId }, () => log("api.contract", { route, code: "response_invalid" }, "error"));
    throw new Answer(apiError("internal", requestId));
  }
  return r.data;
}

export type ReadArgs = { req: Request; site: SiteCtx; params: Record<string, unknown>; query: Record<string, unknown>; deps: ApiDeps; requestId: string };

/** A GET: published reads by slug, no key; an Origin, when sent, must be one the site lists. */
export function readRoute(name: OperationId, route: string, run: (a: ReadArgs) => Promise<unknown>, opts: { etag?: (site: SiteCtx) => string } = {}): Handler {
  const def = routes[name];
  return async (req, ctx) => {
    const requestId = requestIdOf(req);
    const origin = req.headers.get("origin");
    try {
      const deps = apiDeps();
      await rateLimited(deps, "api.read.ip", keyed(deps.secret, "ip", requestIp(req.headers)), requestId, null);
      const { params, site } = await siteOf(deps, def.params, await rawParams(ctx), requestId);
      if (!originAllowed(site, origin, false)) return notFound(requestId);
      const query = queryOf(req, def.query, requestId, origin) as Record<string, unknown>;
      const body = answer(name, await run({ req, site, params, query, deps, requestId }), route, requestId);
      return json(def.status, body, { cache: def.cache, origin, ...(opts.etag ? { etag: opts.etag(site) } : {}) });
    } catch (err) {
      return failure(err, route, requestId, null);
    }
  };
}

export type WriteArgs = ReadArgs & { headers: Record<string, string>; body: Record<string, unknown>; key: string; ipHash: Buffer; botCheck: () => Promise<void> };

/**
 * A POST or DELETE: the publishable key, an allowed Origin (a write must send one), Idempotency-Key, and a JSON body of
 * at most 4 KB that its strict schema accepts. A filled honeypot (`website`) answers 202 and stores nothing.
 */
export function writeRoute(name: OperationId, route: string, run: (a: WriteArgs) => Promise<unknown>): Handler {
  const def = routes[name];
  return async (req, ctx) => {
    const requestId = requestIdOf(req);
    const origin = req.headers.get("origin");
    let cors: string | null = null;
    try {
      const deps = apiDeps();
      const ipHash = keyed(deps.secret, "ip", requestIp(req.headers));
      await rateLimited(deps, "api.write.ip", ipHash, requestId, null);
      const { params, site } = await siteOf(deps, def.params, await rawParams(ctx), requestId);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
      const keyId = await siteKeyId(deps.pub, site, bearer);
      if (!keyId || !originAllowed(site, origin, true)) return notFound(requestId);
      cors = origin;
      await rateLimited(deps, "api.write.key", keyId, requestId, cors);
      queryOf(req, def.query, requestId, cors);

      const shape = (def.headers as z.ZodObject | undefined)?.shape ?? {};
      const headers = Object.fromEntries(Object.keys(shape).flatMap((h) => (req.headers.has(h) ? [[h, req.headers.get(h) as string]] : [])));
      if (!("Idempotency-Key" in headers)) return apiError("idempotency_key_required", requestId, { fields: ["Idempotency-Key"], origin: cors });
      const h = (def.headers as z.ZodType).safeParse(headers);
      if (!h.success) return apiError("invalid", requestId, { fields: fieldsOf(h.error), origin: cors });

      let body: Record<string, unknown> = {};
      if (def.body) {
        if (!/^application\/json(\s*;.*)?$/i.test(req.headers.get("content-type") ?? "")) return apiError("unsupported_media_type", requestId, { origin: cors });
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (bytes.byteLength > MAX_BODY) return apiError("payload_too_large", requestId, { origin: cors });
        let raw: unknown;
        try {
          raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch {
          return apiError("invalid", requestId, { fields: ["(body)"], origin: cors });
        }
        const b = def.body.safeParse(raw);
        if (!b.success) return apiError("invalid", requestId, { fields: fieldsOf(b.error), origin: cors });
        body = b.data as Record<string, unknown>;
        // The honeypot: a person never sees the field, so a filled one is a bot. It is answered as a success would be.
        if (typeof body.website === "string" && body.website !== "") return json(202, { id: crypto.randomUUID(), received: true }, { cache: "no-store", origin: cors });
      }

      const token = typeof body.botToken === "string" ? body.botToken : null;
      const botCheck = async () => {
        if (token === null) return;
        const r = await deps.botCheck.verify({ token, origin: cors });
        const hosts = site.origins.map((o) => new URL(o).hostname);
        if (!r.success || r.hostname === null || !hosts.includes(r.hostname)) throw new ApiRefusal("bot_check");
      };
      const key = (h.data as Record<string, string>)["Idempotency-Key"] as string;
      const out = answer(name, await run({ req, site, params, query: {}, deps, requestId, headers: h.data as Record<string, string>, body, key, ipHash, botCheck }), route, requestId);
      return json(def.status, out, { cache: "no-store", origin: cors });
    } catch (err) {
      return failure(err, route, requestId, cors);
    }
  };
}

/** Every method a route file does not serve, and every unknown route: the one 404. */
export const unknownRoute: Handler = async (req) => notFound(requestIdOf(req));
