// The public API's responses (BLUEPRINT §5.3, §5.4). One error body for every error: the contract's code, its fixed
// message, the input paths at fault and the request id; never a database message, a value or model text. Every response
// carries Munshi-Api-Version: 1. A 404 is one response whatever its reason (an unknown route, slug, key, origin or
// order code, an unverified site, a malformed path parameter): same status, same headers, same body bytes for the same
// request id (S1, VERIFY1, Munim gotcha 16), and never a CORS header, which only a known site's origin could earn.
import { ERRORS, type ErrorCodeName } from "@munshi/contracts";

const REQUEST_ID = /^[A-Za-z0-9:_-]{1,128}$/;

/** The request id the request hook set (proxy.ts); a fresh one where none is (a direct call). */
export const requestIdOf = (req: Request): string => {
  const given = req.headers.get("x-request-id");
  return given && REQUEST_ID.test(given) ? given : crypto.randomUUID();
};

const base = (cache: string): Record<string, string> => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": cache,
  "munshi-api-version": "1",
  "x-content-type-options": "nosniff",
});

/** CORS for a known site's allowed origin; credentials never (§5.2). */
export const corsFor = (origin: string | null): Record<string, string> => (origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {});

export function json(status: number, body: unknown, opts: { cache: string; origin?: string | null; etag?: string }): Response {
  const headers = { ...base(opts.cache), ...corsFor(opts.origin ?? null), ...(opts.etag ? { etag: opts.etag } : {}) };
  return new Response(JSON.stringify(body), { status, headers });
}

export function apiError(code: ErrorCodeName, requestId: string, opts: { fields?: string[]; retryAfter?: number; origin?: string | null } = {}): Response {
  if (code === "not_found") return notFound(requestId);
  const { status, message } = ERRORS[code];
  const body = { error: { code, message, fields: (opts.fields ?? []).filter((f) => /^[A-Za-z0-9_.-]{1,100}$/.test(f)).slice(0, 20), requestId } };
  const headers: Record<string, string> = { ...base("no-store"), ...corsFor(opts.origin ?? null) };
  if (opts.retryAfter !== undefined) headers["retry-after"] = String(opts.retryAfter);
  return new Response(JSON.stringify(body), { status, headers });
}

export function notFound(requestId: string): Response {
  const body = { error: { code: "not_found", message: ERRORS.not_found.message, fields: [], requestId } };
  return new Response(JSON.stringify(body), { status: 404, headers: base("no-store") });
}

/** The preflight answers permissively; the real request is the one checked (§5.2). */
export function preflight(req: Request): Response {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: {
      "munshi-api-version": "1",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
      "access-control-allow-methods": "GET, POST, DELETE",
      "access-control-allow-headers": "authorization, content-type, idempotency-key, x-munshi-device, x-hold-token",
      "access-control-max-age": "600",
    },
  });
}
