import { type NextRequest, NextResponse } from "next/server";

// English is the unprefixed site; the app's pages live under /[lang]. Hindi URLs (/hi/…) and /en/… pass through.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/hi" || pathname.startsWith("/hi/") || pathname === "/en" || pathname.startsWith("/en/")) return;
  const url = request.nextUrl.clone();
  url.pathname = `/en${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/|favicon|icon|.*\\.).*)"] };
