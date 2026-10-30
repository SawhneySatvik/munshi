// The superadmin console's session (server only; BLUEPRINT §6.5, gate CONSOLE1). An operator signs in with the identity
// adapter's password check, then a TOTP code through core's signInOperator, which opens a platform.operator_session row
// (2 hours). Its cookie, munshi_operator, is never the member cookie: it names only that row, is signed with HMAC as the
// member cookie is (under the same secret, with its own prefix), and is sent only to /platform. operatorOr404() is the
// ONE place a console page or action gets an operator: anything but a live operator session, or a console that is not
// configured (no platform pool or platform key), is notFound(), so /platform/* reveals nothing to anyone else.
import { createHmac, timingSafeEqual } from "node:crypto";
import { allowAttempt, endOperatorSession, type OperatorSession, openOperatorSession, signInOperator } from "@munshi/core";
import { notFound } from "next/navigation";
import { config } from "./config";
import { platformPool } from "./db";
import { liveAuth } from "./session";

export const OPERATOR_COOKIE = "munshi_operator";
const PATH = "/platform";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// op1.<operator session>.<expires, unix seconds>.<signature, base64url>
const COOKIE = new RegExp(`^op1\\.(${UUID})\\.(\\d{1,12})\\.([A-Za-z0-9_-]{43})$`);

type CookieJar = { get(name: string): { value: string } | undefined };
type CookieOptions = { httpOnly: boolean; sameSite: "strict"; secure: boolean; path: string; maxAge: number };
type WritableJar = CookieJar & { set(name: string, value: string, options: CookieOptions): unknown };

const sign = (body: string, secret: Buffer) => createHmac("sha256", secret).update(body).digest();

export function signOperatorCookie(sessionId: string, expiresAt: Date, secret: Buffer): string {
  const body = `op1.${sessionId}.${Math.floor(expiresAt.getTime() / 1000)}`;
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** The operator session id a cookie names, if its signature and expiry hold; null for anything else. */
export function verifyOperatorCookie(value: string | undefined, secret: Buffer, now = Date.now()): string | null {
  const m = value ? COOKIE.exec(value) : null;
  if (!m) return null;
  const [, sessionId, expires, sig] = m as unknown as [string, string, string, string];
  const given = Buffer.from(sig, "base64url");
  const expected = sign(`op1.${sessionId}.${expires}`, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (Number(expires) * 1000 <= now) return null;
  return sessionId;
}

const options = (maxAge: number): CookieOptions => ({ httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: PATH, maxAge });

/** The console's pool and key, or null when either is unset. */
function consoleConfig() {
  const pool = platformPool();
  const secret = config().platformSecret;
  return pool && secret ? { pool, secret } : null;
}

/** Whether this deployment has a console at all (its pool and its key). */
export const consoleConfigured = () => consoleConfig() !== null;

/** The live operator session the request's cookie names, or null. */
export async function operatorFrom(jar: CookieJar): Promise<OperatorSession | null> {
  const cc = consoleConfig();
  const id = cc ? verifyOperatorCookie(jar.get(OPERATOR_COOKIE)?.value, config().sessionSecret) : null;
  return cc && id ? openOperatorSession(cc.pool, id) : null;
}

/** The signed-in operator and the console's pool and key; otherwise the request is 404. */
export async function operatorOr404(jar: CookieJar) {
  const cc = consoleConfig();
  const session = cc ? await operatorFrom(jar) : null;
  if (!cc || !session) notFound();
  return { session, ...cc };
}

/** The console's sign-in: password (the identity port), then a TOTP code (core). Null for every failure, one shape. */
export async function signInConsole(jar: WritableJar, input: { email: string; password: string; code: string }, ip: string): Promise<OperatorSession | null> {
  const cc = consoleConfig();
  if (!cc) return null;
  const auth = liveAuth();
  const ipHash = auth.ipHashOf(ip);
  if (!(await allowAttempt(auth.publicPool, "sign-in", ipHash))) return null;
  const identity = await auth.port.signIn({ email: input.email, password: input.password }, { ipHash, botCheck: true });
  if (identity?.provider !== "password") return null;
  const session = await signInOperator(cc.pool, identity.subject, input.code.trim(), cc.secret);
  if (!session) return null;
  // The row's own life is 2 hours from its creation (platform.operator_session); the cookie's is the same.
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000 - 60_000);
  jar.set(OPERATOR_COOKIE, signOperatorCookie(session.sessionId, expiresAt, config().sessionSecret), options(Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
  return session;
}

/** Sign-out: the operator session revoked and the cookie cleared. */
export async function signOutConsole(jar: WritableJar): Promise<void> {
  const cc = consoleConfig();
  const session = cc ? await operatorFrom(jar) : null;
  if (cc && session) await endOperatorSession(cc.pool, session);
  jar.set(OPERATOR_COOKIE, "", options(0));
}
