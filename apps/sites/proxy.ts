import { type NextRequest, NextResponse } from "next/server";

// English is the unprefixed site; the app's pages live under /[lang]. Hindi URLs (/hi/…) and /en/… pass through. Each
// site app's own proxy.ts re-exports this, with its matcher (Next reads that from the app's file).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/hi" || pathname.startsWith("/hi/") || pathname === "/en" || pathname.startsWith("/en/")) return;
  const url = request.nextUrl.clone();
  // The URL's pathname is below the app's base path (/s/<slug>), which the URL adds back itself.
  url.pathname = `/en${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}
