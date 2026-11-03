// The request hook (Next 16's proxy, formerly middleware). Every request but the build's static files and public/'s
// (an icon, the service worker, the offline page, the order widget; next.config's headers still reach them) passes here:
// - it gets an x-request-id (Vercel's own id when well-formed, else a fresh uuid; never one a client chose), set on the
//   response and on the request the route sees;
// - it gets its CSP: a page a policy with a fresh nonce, which Next reads from the request's CSP to sign its own
//   scripts; a route handler or media `default-src 'none'`, so nothing it serves can run (an SVG among them);
// - nothing is served until boot passes: until then every route answers 503 with the refusal's code;
// - the superadmin console's paths (/platform, /platform/*) get `X-Robots-Tag: noindex, nofollow`, served or refused.
// next.config.ts adds the headers that do not vary by request.
import { development } from "@munshi/config";
import { log, withRequest } from "@munshi/core";
import { type NextRequest, NextResponse } from "next/server";
import { boot, refusal } from "./lib/server/db.ts";

const VERCEL_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const DATA = /^\/(api(\/.*)?|icon\.svg|favicon\.ico)$/;
const NOTHING = "default-src 'none'; frame-ancestors 'none'";
const CONSOLE = /^\/platform(\/|$)/;

// Inline style attributes are allowed: the app renders computed styles (bar heights, grid columns, photo boxes).
const pagePolicy = (nonce: string) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development() ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const vercel = request.headers.get("x-vercel-id");
  const requestId = vercel && VERCEL_ID.test(vercel) ? vercel : crypto.randomUUID();
  const csp = DATA.test(request.nextUrl.pathname) ? NOTHING : pagePolicy(Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64"));
  let response: NextResponse;
  try {
    await boot();
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    headers.set("content-security-policy", csp);
    response = NextResponse.next({ request: { headers } });
  } catch (err) {
    const why = refusal(err);
    withRequest({ requestId }, () => log("boot.refused", why, "error"));
    response = NextResponse.json({ ok: false, code: why.code }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  // The superadmin console shares the site but is never indexed or followed; robots.txt does not name it, which would
  // advertise it, and no page of the site links to it.
  if (CONSOLE.test(request.nextUrl.pathname)) response.headers.set("x-robots-tag", "noindex, nofollow");
  response.headers.set("x-request-id", requestId);
  response.headers.set("content-security-policy", csp);
  return response;
}

// A public file is a path, outside /api, ending in one of public/'s extensions. Not .svg: the app's own icon route
// (app/icon.svg) keeps its CSP.
export const config = { matcher: ["/((?!_next/static|_next/image|(?!api/).*\\.(?:png|jpe?g|webp|gif|ico|js|html|tgz)$).*)"] };
