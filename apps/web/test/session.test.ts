// The session is built in one place, sessionFrom(), from an HMAC-signed cookie naming an ops.login_session row. A forged
// or tampered cookie gets no session: the home redirects to the sign-in, and a decision posted with it changes nothing.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decideDraft, signIn } from "../app/actions";
import Page from "../app/page";
import { SESSION_COOKIE, sessionFrom, signSession, verifySession } from "../lib/server/session";
import { Redirect, state } from "./app-state";
import { type Home, openHome, rows, signInAs } from "./home-db";

let h: Home;
beforeAll(async () => {
  h = await openHome();
});
afterAll(() => h.close());

const secret = () => (state.config as { sessionSecret: Buffer }).sessionSecret;
const cookie = () => state.cookies.get(SESSION_COOKIE) as string;
const jar = (value: string) => ({ get: (name: string) => (name === SESSION_COOKIE ? { value } : undefined) });
const redirectOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) return err.to;
    throw err;
  }
  return null;
};
const later = (hours: number) => new Date(Date.now() + hours * 3600_000);

// Each way to tamper with a valid staff cookie, built from it.
function tampered(valid: string, ownerId: string): Record<string, string> {
  const [v, tenant, member, session, via, expires, sig] = valid.split(".") as [string, string, string, string, string, string, string];
  const flip = (s: string) => (s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`);
  return {
    "member swapped for the owner": [v, tenant, ownerId, session, via, expires, sig].join("."),
    "expiry pushed later": [v, tenant, member, session, via, String(Number(expires) + 86_400), sig].join("."),
    "via swapped for real": [v, tenant, member, session, "real", expires, sig].join("."),
    "signature altered": [v, tenant, member, session, via, expires, flip(sig)].join("."),
    "signed with another secret": signSession({ tenantId: tenant, memberId: member, sessionId: session, via: "demo" }, new Date(Number(expires) * 1000), randomBytes(32)),
    "signature dropped": [v, tenant, member, session, via, expires].join("."),
    "not a session": "hello",
  };
}

describe("a tampered cookie is refused", () => {
  test("a valid cookie is a session; every tampered form of it is none", async () => {
    const staff = h.k.staff[0] as Home["k"]["owner"];
    signInAs(staff);
    const valid = cookie();
    expect(verifySession(valid, secret())).toMatchObject({ tenantId: staff.tenantId, memberId: staff.memberId, via: "demo" });
    expect(await sessionFrom(jar(valid))).toMatchObject({ tenantId: staff.tenantId, memberId: staff.memberId, via: "demo" });
    const cases = tampered(valid, h.k.owner.memberId);
    for (const [why, value] of Object.entries(cases)) {
      expect(verifySession(value, secret()), why).toBeNull();
      expect(await sessionFrom(jar(value)), why).toBeNull();
    }
    expect(Object.keys(cases).length).toBe(7);
  });

  test("an expired cookie is none", () => {
    const old = signSession({ tenantId: h.k.tenantId, memberId: h.k.owner.memberId, sessionId: randomUUID(), via: "demo" }, later(-1), secret());
    expect(verifySession(old, secret())).toBeNull();
  });

  test("a signed cookie for a member who is not in the books is none", async () => {
    const ghost = signSession({ tenantId: h.k.tenantId, memberId: "00000000-0000-4000-8000-000000000000", sessionId: randomUUID(), via: "demo" }, later(1), secret());
    expect(verifySession(ghost, secret())).not.toBeNull();
    expect(await sessionFrom(jar(ghost))).toBeNull();
  });

  test("the home asks a tampered cookie to sign in, and serves a valid one", async () => {
    signInAs(h.k.staff[0] as Home["k"]["owner"]);
    const valid = cookie();
    state.cookies.set(SESSION_COOKIE, tampered(valid, h.k.owner.memberId)["member swapped for the owner"] as string);
    expect(await redirectOf(Page())).toBe("/sign-in");
    state.cookies.set(SESSION_COOKIE, valid);
    expect(await redirectOf(Page())).toBeNull();
  });

  test("a decision posted with a tampered cookie changes nothing", async () => {
    signInAs(h.k.staff[0] as Home["k"]["owner"]);
    state.cookies.set(SESSION_COOKIE, tampered(cookie(), h.k.owner.memberId)["member swapped for the owner"] as string);
    const form = new FormData();
    form.set("draft", h.draftId);
    form.set("verdict", "approved");
    expect(await decideDraft(null, form)).toEqual({ error: "signed_out" });
    const [d] = await rows<{ status: string }>(h, "select status from approval.draft where id = $1", [h.draftId]);
    expect(d?.status).toBe("proposed");
    expect(await rows(h, "select 1 from approval.decision")).toEqual([]);
  });
});

describe("demo sign-in", () => {
  test("signs only an active member of the demo shop, into an httpOnly SameSite cookie", async () => {
    state.cookies.clear();
    const stranger = new FormData();
    stranger.set("member", "00000000-0000-4000-8000-000000000000");
    expect(await redirectOf(signIn(stranger))).toBe("/sign-in");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);

    const owner = new FormData();
    owner.set("member", h.k.owner.memberId);
    expect(await redirectOf(signIn(owner))).toBe("/");
    const claim = verifySession(cookie(), secret());
    expect(claim).toMatchObject({ tenantId: h.k.tenantId, memberId: h.k.owner.memberId, via: "demo" });
    // The cookie names a fresh demo session row of 12 hours, and lives as long as it.
    const [row] = await rows<{ via: string; hours: number }>(h, "select via, round(extract(epoch from expires_at - created_at) / 3600)::int as hours from ops.login_session where id = $1", [
      claim?.sessionId,
    ]);
    expect(row).toEqual({ via: "demo", hours: 12 });
    expect(state.cookieOptions.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(Number(state.cookieOptions.get(SESSION_COOKIE)?.maxAge)).toBeGreaterThan(11.9 * 3600);
  });
});
