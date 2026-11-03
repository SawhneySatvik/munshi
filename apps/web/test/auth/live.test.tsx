// Real sign-in through the app, on a live-kind database with invented people (BLUEPRINT §6.2–§6.7): the password form
// and its one failure line; one shop straight in, several through the picker, none told to ask for an invite; an invite
// page that reads the same whether or not the email already has an account, and so does its failure (AUTH3, bytes
// compared); a reset link used once; sign-out; and the demo picker, its action and the sample shops answer 404 (F2).
import { randomBytes } from "node:crypto";
import { createInvite, issueReset } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { tx } from "../../../../db/test/v2/db.ts";
import { asOwner } from "../../../../db/test/v2/gates/lib.ts";
import { emailFor, IDENTITY_SECRET, join, liveShop, member, PASSWORD, portOf, RATE_SECRET, type Tenant } from "../../../../db/test/v2/core/auth/fixture.ts";
import { chooseShop, joinShop, setNewPassword, signInWithPassword, signOut } from "../../app/(auth)/actions";
import ChooseShopPage from "../../app/(auth)/choose-shop/page";
import InvitePage from "../../app/(auth)/invite/[slug]/[token]/page";
import ResetPage from "../../app/(auth)/reset/[slug]/[token]/page";
import { AUTH_WORDS } from "../../app/(auth)/words";
import { signIn } from "../../app/actions";
import DemoShopPage from "../../app/demo/[slug]/page";
import { makeSampleShop } from "../../app/demo/actions";
import DemoPage from "../../app/demo/page";
import SignUpPage from "../../app/(site)/sign-up/page";
import SignInPage from "../../app/sign-in/page";
import { ONBOARDING_WORDS } from "../../lib/i18n-onboard";
import type { Config } from "../../lib/server/config";
import { appPool } from "../../lib/server/db";
import { PICK_COOKIE, SESSION_COOKIE, sessionFrom, verifySession } from "../../lib/server/session";
import { state } from "../app-state";
import { openWebDb, urlAs, type WebDb } from "../home-db";
import { formOf, outcome, request } from "./request";

vi.mock("next/navigation", async () => (await import("./request")).navigation());
vi.mock("next/headers", async () => (await import("./request")).headersModule());

const w = AUTH_WORDS.en;
let db: WebDb;
let t: Tenant;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('live', true)`]);
  t = await liveShop(db);
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: t.tenant,
    identitySecret: IDENTITY_SECRET,
    rateSecret: RATE_SECRET,
    idpDatabaseUrl: urlAs(db, "munshi_idp"),
    publicDatabaseUrl: urlAs(db, "munshi_public"),
  } as Config;
});
afterAll(async () => {
  const held = globalThis as { munshiPool?: Promise<pg.Pool> | undefined; munshiIdpPool?: pg.Pool; munshiPublicPool?: pg.Pool };
  await (await appPool()).end();
  await held.munshiIdpPool?.end();
  await held.munshiPublicPool?.end();
  held.munshiPool = undefined;
  await db.close();
});
beforeEach(() => {
  state.cookies.clear();
  request.ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`; // each test its own IP, under the per-IP limit
});

const page = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const query = (q: Record<string, string> = {}) => Promise.resolve(q);
const claim = () => verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret);
const signInForm = (email: string, password: string) => formOf({ email, password });

describe("live", () => {
  test("AUTH1 on live the sign-in page is the password form, and the demo picker, its action and the sample shops answer 404 (F2)", async () => {
    const html = await page(SignInPage({ searchParams: query() }));
    expect(html).toContain('name="email"');
    expect(html).toContain('type="password"');
    expect(await outcome(DemoPage({ searchParams: query() }))).toBe("not found");
    // The site's Sign up on live is a real shop's (D-080): no sample-shop form, and no choice of one.
    const signUp = await page(SignUpPage({ searchParams: query() }));
    expect(signUp).toContain(ONBOARDING_WORDS.en.realTitle);
    expect(signUp).toContain('name="shopName"');
    expect(signUp).not.toContain('name="back"');
    expect(signUp).not.toContain(ONBOARDING_WORDS.en.sampleChoice);
    expect(await outcome(DemoShopPage({ params: Promise.resolve({ slug: t.slug }) }))).toBe("not found");
    expect(await outcome(signIn(formOf({ member: t.owner })))).toBe("not found");
    expect(await outcome(makeSampleShop(formOf({ businessType: "kirana", name: "X", slug: "auth-web-live", ownerName: "Y" })))).toBe("not found");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  test("IDP1 a wrong password and an unknown email give the one line; one shop opens straight in, several through the picker, none says to ask for an invite", async () => {
    const port = portOf(db);
    const staff = emailFor("web-staff");
    await join(db, port, t, t.staff, staff);
    expect(await outcome(signInWithPassword(signInForm(staff, "a wrong password")))).toBe("redirect /sign-in?failed=1");
    expect(await outcome(signInWithPassword(signInForm(emailFor("nobody"), "a wrong password")))).toBe("redirect /sign-in?failed=1");
    expect(await page(SignInPage({ searchParams: query({ failed: "1" }) }))).toContain(w.wrong);
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
    expect(await outcome(signInWithPassword(signInForm(staff, PASSWORD)))).toBe("redirect /app/counter");
    expect(claim()).toMatchObject({ tenantId: t.tenant, memberId: t.staff, via: "real" });
    expect(await sessionFrom({ get: (n) => (state.cookies.has(n) ? { value: state.cookies.get(n) as string } : undefined) })).toMatchObject({ via: "real" });

    // The manager also manages a second shop: the picker, then the shop chosen.
    const second = await liveShop(db);
    const manager = emailFor("web-manager");
    await join(db, port, t, t.manager, manager);
    await join(db, port, second, second.manager, manager);
    state.cookies.clear();
    expect(await outcome(signInWithPassword(signInForm(manager, PASSWORD)))).toBe("redirect /choose-shop");
    expect(state.cookies.has(PICK_COOKIE)).toBe(true);
    const picker = await page(ChooseShopPage());
    expect(picker).toContain(`Shop ${t.slug}`);
    expect(picker).toContain(`Shop ${second.slug}`);
    expect(await outcome(chooseShop(formOf({ tenant: second.tenant })))).toMatch(/^redirect \/app/);
    expect(claim()).toMatchObject({ tenantId: second.tenant, memberId: second.manager, via: "real" });

    // An identity whose only login was revoked: proved, but no shop to open.
    const third = await liveShop(db);
    const gone = emailFor("web-gone");
    await join(db, port, third, third.staff, gone);
    await tx(db.app, { tenant_id: third.tenant, actor_id: third.owner }, (c) =>
      c.query("update ops.login set revoked_at = now() where tenant_id = $1 and member_id = $2", [third.tenant, third.staff]),
    );
    state.cookies.clear();
    expect(await outcome(signInWithPassword(signInForm(gone, PASSWORD)))).toBe("redirect /sign-in?none=1");
    expect(await page(SignInPage({ searchParams: query({ none: "1" }) }))).toContain(w.noInvite);
  });

  test("AUTH3 the invite page reads the same for an email that has an account and one that does not, and so does its one failure line", async () => {
    const shop = await liveShop(db);
    const known = emailFor("web-known");
    await join(db, portOf(db), t, t.owner, known);
    const fresh = emailFor("web-fresh");
    const owner = await member(db, shop.tenant, shop.owner);
    const existing = await createInvite(db.app, owner, shop.manager, known);
    const newcomer = await createInvite(db.app, owner, shop.staff, fresh);
    const invitePage = (token: string, q: Record<string, string> = {}) =>
      page(InvitePage({ params: Promise.resolve({ slug: shop.slug, token }), searchParams: query(q) })).then((html) => html.replaceAll(token, "TOKEN"));
    const [a, b] = [await invitePage(existing.token), await invitePage(newcomer.token)];
    expect(a).toBe(b);
    expect(a).toContain(w.inviteLede);
    expect(a).not.toContain(known);
    // Every failure, either way: the same redirect, the same page.
    const join_ = (token: string, email: string, password: string) => outcome(joinShop(formOf({ slug: shop.slug, token, email, password })));
    const failedA = await join_(existing.token, known, "not the right password");
    const failedB = await join_(newcomer.token, fresh, "short");
    expect([failedA.replace(existing.token, "TOKEN"), failedB.replace(newcomer.token, "TOKEN")]).toEqual(Array(2).fill(`redirect /invite/${shop.slug}/TOKEN?failed=1`));
    const [fa, fb] = [await invitePage(existing.token, { failed: "1" }), await invitePage(newcomer.token, { failed: "1" })];
    expect(fa).toBe(fb);
    expect(fa).toContain(w.inviteFailed);
    // A mismatched email, or a link that names nothing, is 404.
    expect(await join_(newcomer.token, emailFor("web-other"), "a new password here")).toBe("not found");
    expect(await outcome(InvitePage({ params: Promise.resolve({ slug: shop.slug, token: "E".repeat(43) }), searchParams: query() }))).toBe("not found");
    // The right passwords: each is in, with a real session.
    expect(await join_(existing.token, known, PASSWORD)).toBe("redirect /app");
    expect(claim()).toMatchObject({ tenantId: shop.tenant, memberId: shop.manager, via: "real" });
    expect(await join_(newcomer.token, fresh, "a new password for this shop")).toBe("redirect /app/counter");
    expect(claim()).toMatchObject({ tenantId: shop.tenant, memberId: shop.staff, via: "real" });
  });

  test("RESET1 a reset link opens its page, sets the password once and signs the person in with a session that records the grant; then the link is 404", async () => {
    const shop = await liveShop(db);
    await join(db, portOf(db), shop, shop.staff, emailFor("web-reset"));
    const { grantId, token } = await issueReset(db.app, await member(db, shop.tenant, shop.owner), shop.staff);
    const resetPage = () => page(ResetPage({ params: Promise.resolve({ slug: shop.slug, token }), searchParams: query() }));
    expect(await resetPage()).toContain(w.resetLede);
    expect(await outcome(setNewPassword(formOf({ slug: shop.slug, token, password: "short" })))).toBe(`redirect /reset/${shop.slug}/${token}?failed=1`);
    expect(await outcome(setNewPassword(formOf({ slug: shop.slug, token, password: "a fresh password now" })))).toBe("redirect /app/counter");
    const c = claim();
    expect(c).toMatchObject({ tenantId: shop.tenant, memberId: shop.staff, via: "real" });
    const { rows } = await db.admin.query("select reset_grant_id from ops.login_session where id = $1", [c?.sessionId]);
    expect(rows).toEqual([{ reset_grant_id: grantId }]);
    expect(await outcome(resetPage())).toBe("not found");
  });

  test("F5 sign-out revokes this device's session row and clears its cookie", async () => {
    const shop = await liveShop(db);
    const email = emailFor("web-out");
    await join(db, portOf(db), shop, shop.staff, email);
    await outcome(signInWithPassword(signInForm(email, PASSWORD)));
    const before = claim();
    expect(before).not.toBeNull();
    expect(await outcome(signOut())).toBe("redirect /sign-in");
    expect(state.cookies.get(SESSION_COOKIE)).toBe("");
    const { rows } = await db.admin.query("select revoked_at is not null as revoked from ops.login_session where id = $1", [before?.sessionId]);
    expect(rows).toEqual([{ revoked: true }]);
  });
});
