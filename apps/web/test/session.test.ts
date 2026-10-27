// The session is built in one place, sessionFrom(), from an HMAC-signed cookie. A forged or tampered cookie gets no
// session: the home redirects to the sign-in, and a decision posted with it changes nothing.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decideDraft, signIn } from "../app/actions";
import Page from "../app/page";
import { type Claim, SESSION_COOKIE, sessionFrom, signSession, verifySession } from "../lib/server/session";
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

// Each way to tamper with a valid staff cookie, built from it.
function tampered(valid: string, ownerId: string): Record<string, string> {
  const [v, tenant, member, expires, sig] = valid.split(".") as [string, string, string, string, string];
  const flip = (s: string) => (s[0] === "A" ? `B${s.slice(1)}` : `A${s.slice(1)}`);
  return {
    "member swapped for the owner": [v, tenant, ownerId, expires, sig].join("."),
    "expiry pushed later": [v, tenant, member, String(Number(expires) + 86_400), sig].join("."),
    "signature altered": [v, tenant, member, expires, flip(sig)].join("."),
    "signed with another secret": signSession({ tenantId: tenant, memberId: member }, randomBytes(32)),
    "signature dropped": [v, tenant, member, expires].join("."),
    "not a session": "hello",
  };
}

describe("a tampered cookie is refused", () => {
  test("a valid cookie is a session; every tampered form of it is none", async () => {
    signInAs(h.k.staff[0] as Claim);
    const valid = cookie();
    expect(verifySession(valid, secret())).toEqual(h.k.staff[0]);
    expect(await sessionFrom(jar(valid))).toEqual(h.k.staff[0]);
    const cases = tampered(valid, h.k.owner.memberId);
    for (const [why, value] of Object.entries(cases)) {
      expect(verifySession(value, secret()), why).toBeNull();
      expect(await sessionFrom(jar(value)), why).toBeNull();
    }
    expect(Object.keys(cases).length).toBe(6);
  });

  test("an expired cookie is none", () => {
    const old = signSession(h.k.owner, secret(), Date.now() - 13 * 60 * 60 * 1000);
    expect(verifySession(old, secret())).toBeNull();
  });

  test("a signed cookie for a member who is not in the books is none", async () => {
    const ghost = signSession({ tenantId: h.k.tenantId, memberId: "00000000-0000-4000-8000-000000000000" }, secret());
    expect(verifySession(ghost, secret())).not.toBeNull();
    expect(await sessionFrom(jar(ghost))).toBeNull();
  });

  test("the home asks a tampered cookie to sign in, and serves a valid one", async () => {
    signInAs(h.k.staff[0] as Claim);
    const valid = cookie();
    state.cookies.set(SESSION_COOKIE, tampered(valid, h.k.owner.memberId)["member swapped for the owner"] as string);
    expect(await redirectOf(Page())).toBe("/sign-in");
    state.cookies.set(SESSION_COOKIE, valid);
    expect(await redirectOf(Page())).toBeNull();
  });

  test("a decision posted with a tampered cookie changes nothing", async () => {
    signInAs(h.k.staff[0] as Claim);
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
    expect(verifySession(cookie(), secret())).toEqual(h.k.owner);
    expect(state.cookieOptions.get(SESSION_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
