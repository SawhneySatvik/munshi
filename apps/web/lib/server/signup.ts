// A real shop's email-verified sign-up, between its two posts (server only). The email service is Supabase Auth's
// (packages/adapters/identity/supabase-email.ts), wired from SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY through the
// config module; unset, there is none and the sign-up takes the password at once. Between the form and the link's page
// the shop's details wait in a cookie signed with the session secret, for an hour, beside a keyed hash of the email
// (never the email itself): the link's page is honoured only in the browser that asked for it, for the email Supabase
// then confirms.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { type EmailVerifier, foldEmail, supabaseEmail } from "@munshi/adapters/identity";
import { config } from "./config";

export const SIGNUP_COOKIE = "munshi_signup";
const SECONDS = 60 * 60;

export type ShopDetails = { shopName: string; businessType: string; city: string; ownerName: string; slug: string };

type Jar = { get(name: string): { value: string } | undefined };
type WritableJar = Jar & { set(name: string, value: string, options: Record<string, unknown>): unknown };

/** The deployment's email service, or null when Supabase Auth is not set. */
export function emailVerifier(): EmailVerifier | null {
  const s = config().supabase;
  return s ? supabaseEmail({ url: s.url, publishableKey: s.publishableKey }) : null;
}

const mac = (body: string) => createHmac("sha256", config().sessionSecret).update(`signup.${body}`).digest();
/** The email's keyed hash: what the cookie holds, and what the per-email limit counts by. */
export const emailKey = (email: string) => mac(`email.${foldEmail(email)}`).toString("base64url");
const COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/sign-up" } as const;

export function setPendingSignUp(jar: WritableJar, shop: ShopDetails, email: string, now = Date.now()): void {
  const body = Buffer.from(JSON.stringify({ shop, email: emailKey(email), exp: Math.floor(now / 1000) + SECONDS })).toString("base64url");
  jar.set(SIGNUP_COOKIE, `${body}.${mac(body).toString("base64url")}`, { ...COOKIE_OPTIONS, maxAge: SECONDS });
}

/** A finished sign-up's cookie goes. */
export function clearPendingSignUp(jar: WritableJar): void {
  jar.set(SIGNUP_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
}

/** The details a signed, unexpired cookie holds, and whether a confirmed email is the one they were asked for. */
export function pendingSignUp(jar: Jar, now = Date.now()): { shop: ShopDetails; emailKey: string; holds: (email: string) => boolean } | null {
  const [body, sig] = (jar.get(SIGNUP_COOKIE)?.value ?? "").split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url");
  const expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { shop: ShopDetails; email: string; exp: number };
    if (typeof p.exp !== "number" || p.exp * 1000 <= now) return null;
    return {
      shop: p.shop,
      emailKey: p.email,
      holds: (email) => {
        const a = Buffer.from(emailKey(email));
        const b = Buffer.from(p.email);
        return a.length === b.length && timingSafeEqual(a, b);
      },
    };
  } catch {
    return null;
  }
}
