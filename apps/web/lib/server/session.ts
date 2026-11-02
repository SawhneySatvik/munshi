// The signed-in person (server only). A cookie names one ops.login_session row: the server signs its tenant, member,
// session id, via and expiry with HMAC under the session secret. sessionFrom() is the ONE place the app gets a Session:
// it verifies the signature (timing-safe) and the expiry, then core's resumeSession checks the row — not revoked, not
// expired, this member's and this via's, the member active, the via rule against the tenant and the deployment, and a
// real session's epoch (BLUEPRINT §6.7). Anything else is no session, and the page asks for a sign-in. Core's withTx
// then sets the acting member and the via from this Session alone. Sessions are opened only by core's sign-in paths
// (the demo picker, a sample shop, a password); this module only writes and reads their cookies.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { type Identity, type IdentityPort, passwordIdentity } from "@munshi/adapters/identity";
import { type Claim, endSession, ipHash, type Opened, resumeSession, type Session } from "@munshi/core";
import pg from "pg";
import { TAG_COOKIE } from "../offline/tag";
import { config } from "./config";
import { appPool } from "./db";

export const SESSION_COOKIE = "munshi_session";
// Between a password sign-in and the shop picker: the identity it verified, signed, for 10 minutes; never a form field.
export const PICK_COOKIE = "munshi_pick";
const PICK_SECONDS = 10 * 60;

export type { Claim };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// v2.<tenant>.<member>.<session>.<via>.<expires, unix seconds>.<signature, base64url>: no field can hold a dot.
const COOKIE = new RegExp(`^v2\\.(${UUID})\\.(${UUID})\\.(${UUID})\\.(demo|sandbox|real)\\.(\\d{1,12})\\.([A-Za-z0-9_-]{43})$`);
const PICK = new RegExp(`^p1\\.(password|supabase)\\.(${UUID})\\.(\\d{1,12})\\.([A-Za-z0-9_-]{43})$`);

type CookieJar = { get(name: string): { value: string } | undefined };
type CookieOptions = { httpOnly: boolean; sameSite: "lax"; secure: boolean; path: string; maxAge: number };
type WritableJar = CookieJar & { set(name: string, value: string, options: CookieOptions): unknown };

const sign = (body: string, secret: Buffer) => createHmac("sha256", secret).update(body).digest();
const signed = (body: string, secret: Buffer) => `${body}.${sign(body, secret).toString("base64url")}`;
const holds = (body: string, sig: string, secret: Buffer) => {
  const given = Buffer.from(sig, "base64url");
  const expected = sign(body, secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export function signSession(claim: Claim, expiresAt: Date, secret: Buffer): string {
  return signed(`v2.${claim.tenantId}.${claim.memberId}.${claim.sessionId}.${claim.via}.${Math.floor(expiresAt.getTime() / 1000)}`, secret);
}

/** What a cookie claims if its signature and expiry hold; null for anything else. Checks no database row. */
export function verifySession(value: string | undefined, secret: Buffer, now = Date.now()): Claim | null {
  const m = value ? COOKIE.exec(value) : null;
  if (!m) return null;
  const [, tenantId, memberId, sessionId, via, expires, sig] = m as unknown as [string, string, string, string, Claim["via"], string, string];
  if (!holds(`v2.${tenantId}.${memberId}.${sessionId}.${via}.${expires}`, sig, secret)) return null;
  if (Number(expires) * 1000 <= now) return null;
  return { tenantId, memberId, sessionId, via };
}

export async function sessionFrom(cookies: CookieJar): Promise<Session | null> {
  const claim = verifySession(cookies.get(SESSION_COOKIE)?.value, config().sessionSecret);
  return claim ? resumeSession(await appPool(), claim) : null;
}

const options = (maxAge: number): CookieOptions => ({ httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });

/** Writes the cookie of a session core has just opened, ending the one the browser held before (a switch of shop or person). */
export async function setSessionCookie(jar: WritableJar, opened: Opened): Promise<void> {
  const before = await sessionFrom(jar);
  if (before) await endSession(await appPool(), before);
  const { session, expiresAt } = opened;
  const claim = { tenantId: session.tenantId, memberId: session.memberId, sessionId: session.sessionId as string, via: session.via as Claim["via"] };
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
  jar.set(SESSION_COOKIE, signSession(claim, expiresAt, config().sessionSecret), options(maxAge));
  jar.set(TAG_COOKIE, randomUUID(), { ...options(maxAge), httpOnly: false });
}

/** Sign-out: the session row is revoked and the cookie cleared. */
export async function signOutCookie(jar: WritableJar): Promise<void> {
  const session = await sessionFrom(jar);
  if (session) await endSession(await appPool(), session);
  jar.set(SESSION_COOKIE, "", options(0));
  jar.set(TAG_COOKIE, "", { ...options(0), httpOnly: false });
}

export function setPickCookie(jar: WritableJar, identity: Identity, now = Date.now()): void {
  jar.set(PICK_COOKIE, signed(`p1.${identity.provider}.${identity.subject}.${Math.floor(now / 1000) + PICK_SECONDS}`, config().sessionSecret), options(PICK_SECONDS));
}

/** The identity a sign-in verified a moment ago, for the shop picker; null once it is stale, and for anything else. */
export function pickFrom(cookies: CookieJar, now = Date.now()): Identity | null {
  const m = PICK.exec(cookies.get(PICK_COOKIE)?.value ?? "");
  if (!m) return null;
  const [, provider, subject, expires, sig] = m as unknown as [string, Identity["provider"], string, string, string];
  if (!holds(`p1.${provider}.${subject}.${expires}`, sig, config().sessionSecret) || Number(expires) * 1000 <= now) return null;
  return { provider, subject };
}

/**
 * The request's IP as its first proxy hop reports it; only its keyed hash goes further. A client can write
 * x-forwarded-for itself unless the host overwrites it, and the lockout and the per-IP limits key on this: which header
 * the host sets is a deploy decision (BP-CORE-1), to be made before real sign-in goes live.
 */
export const requestIp = (headers: Headers) => headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";

// ---- Real sign-in's wiring (live only) ----

// What real sign-in needs: BLUEPRINT §4.3's MUNSHI_IDENTITY_SECRET and MUNSHI_RATE_SECRET (config() requires both on live)
// and the idp and public pools (munshi_idp, munshi_public; boot checks each pool's role).
export type LiveAuth = { port: IdentityPort; publicPool: pg.Pool; ipHashOf: (ip: string) => Buffer };

const held = globalThis as typeof globalThis & { munshiIdpPool?: pg.Pool; munshiPublicPool?: pg.Pool };
const liveConfig = config;

export function liveAuth(): LiveAuth {
  const c = liveConfig();
  if (!c.identitySecret || !c.rateSecret || !c.idpDatabaseUrl || !c.publicDatabaseUrl) {
    throw new Error("config: real sign-in needs MUNSHI_IDENTITY_SECRET, MUNSHI_RATE_SECRET, IDP_DATABASE_URL and PUBLIC_DATABASE_URL");
  }
  held.munshiIdpPool ??= new pg.Pool({ connectionString: c.idpDatabaseUrl, max: 4, application_name: "munshi_idp" });
  held.munshiPublicPool ??= new pg.Pool({ connectionString: c.publicDatabaseUrl, max: 4, application_name: "munshi_public" });
  const rateSecret = c.rateSecret;
  return {
    port: passwordIdentity({ pool: held.munshiIdpPool, identitySecret: c.identitySecret }),
    publicPool: held.munshiPublicPool,
    ipHashOf: (ip) => ipHash(ip, rateSecret),
  };
}

/** The sample-shop sign-up's per-IP limit where the public pool is configured; `pnpm dev` has none, so none applies there. */
export function signUpLimiter(): LiveAuth | null {
  const c = liveConfig();
  return c.identitySecret && c.rateSecret && c.idpDatabaseUrl && c.publicDatabaseUrl ? liveAuth() : null;
}
