// The signed-in person (server only). A demo sign-in picks a member of the demo shop; the server signs their tenant and
// member ids into an HMAC cookie with the secret under .run/. sessionFrom() is the ONE place the app gets a Session: it
// verifies the signature (timing-safe) and the expiry, then core's openSession checks that the member exists and is
// active. Anything else — no cookie, a forged or tampered one, an expired one, a member gone — is no session, and the
// page asks for a sign-in. Core's withTx then sets the acting member from this Session alone.
import { createHmac, timingSafeEqual } from "node:crypto";
import { openSession, type Session } from "@munshi/core";
import { config } from "./config";
import { appPool } from "./db";

export const SESSION_COOKIE = "munshi_session";
export const SESSION_SECONDS = 12 * 60 * 60;

/** What a session cookie carries: ids only, trusted once the signature checks. */
export type Claim = { tenantId: string; memberId: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// v1.<tenant>.<member>.<expires, unix seconds>.<signature, base64url>: no field can contain a dot, so it parses one way.
const COOKIE = new RegExp(`^v1\\.(${UUID})\\.(${UUID})\\.(\\d{1,12})\\.([A-Za-z0-9_-]{43})$`);

type CookieJar = { get(name: string): { value: string } | undefined };

const sign = (body: string, secret: Buffer) => createHmac("sha256", secret).update(body).digest();

export function signSession(claim: Claim, secret: Buffer, now = Date.now()): string {
  const body = `v1.${claim.tenantId}.${claim.memberId}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** The ids a cookie carries if its signature and expiry hold; null for anything else. Checks no database row. */
export function verifySession(value: string | undefined, secret: Buffer, now = Date.now()): Claim | null {
  const m = value ? COOKIE.exec(value) : null;
  if (!m) return null;
  const [, tenantId, memberId, expires, sig] = m as unknown as [string, string, string, string, string];
  const given = Buffer.from(sig, "base64url");
  const expected = sign(`v1.${tenantId}.${memberId}.${expires}`, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(expires) * 1000 <= now) return null;
  return { tenantId, memberId };
}

export async function sessionFrom(cookies: CookieJar): Promise<Session | null> {
  const claim = verifySession(cookies.get(SESSION_COOKIE)?.value, config().sessionSecret);
  return claim ? openSession(await appPool(), claim.tenantId, claim.memberId) : null;
}
