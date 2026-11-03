// ON1-EMAIL: a real shop's sign-up where Supabase Auth's email is set (D-080). Supabase is a scripted fetch that answers
// as its REST API does (the network is the only thing stood in for; the database is real). The form takes no password
// and asks Supabase for a link; the link's page spends nothing; its post checks the password, spends the token hash
// once, and makes the shop only for the email the browser asked for, with the identity stamped verified_via 'email',
// then clears the browser's sign-up cookie. The link returns to the configured public origin (MUNSHI_APP_URL) whatever
// Host or Origin a request forges. The password-at-once path is closed while the email service is set.
// Red-proofs: db/test/v2/sabotage/onboarding.ts.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { emailFor, IDENTITY_SECRET, PASSWORD, RATE_SECRET } from "../../../db/test/v2/core/auth/fixture.ts";
import { finishRealSignUp, signUpReal, startRealSignUp } from "../app/(site)/sign-up/actions";
import ConfirmPage from "../app/(site)/sign-up/confirm/page";
import SignUpPage from "../app/(site)/sign-up/page";
import { LangProvider } from "../components/LangProvider";
import { ONBOARDING_WORDS } from "../lib/i18n-onboard";
import type { Config } from "../lib/server/config";
import { appPool } from "../lib/server/db";
import { SESSION_COOKIE, verifySession } from "../lib/server/session";
import { SIGNUP_COOKIE } from "../lib/server/signup";
import { state } from "./app-state";
import { formOf, outcome, request } from "./auth/request";
import { openWebDb, urlAs, type WebDb } from "./home-db";

vi.mock("next/navigation", async () => (await import("./auth/request")).navigation());
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

const w = ONBOARDING_WORDS.en;
const SUPABASE = { url: "https://abcdefghijklmnop.supabase.co", publishableKey: "sb_publishable_test_key_0123456789abcdef" };
let db: WebDb;

// Supabase Auth as a script: /otp accepts; /verify confirms the email the next answer names, or refuses.
const calls: { path: string; redirect: string | null; body: Record<string, unknown> }[] = [];
const APP_URL = "https://munshi.example";
let confirms: (string | null)[] = [];

beforeAll(async () => {
  db = await openWebDb();
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: "019a0000-0000-7000-8000-000000000000",
    identitySecret: IDENTITY_SECRET,
    rateSecret: RATE_SECRET,
    idpDatabaseUrl: urlAs(db, "munshi_idp"),
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    supabase: SUPABASE,
    appUrl: APP_URL,
  } as Config;
  await db.sabotage();
});
afterAll(async () => {
  const held = globalThis as { munshiPool?: Promise<pg.Pool> | undefined; munshiIdpPool?: pg.Pool; munshiPublicPool?: pg.Pool };
  await (await appPool()).end();
  await held.munshiIdpPool?.end();
  await held.munshiPublicPool?.end();
  held.munshiIdpPool = undefined;
  held.munshiPublicPool = undefined;
  held.munshiPool = undefined;
  await db.close();
});
beforeEach(() => {
  state.cookies.clear();
  calls.length = 0;
  request.ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  request.headers = {};
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const at = new URL(url);
    const path = at.pathname;
    calls.push({ path, redirect: at.searchParams.get("redirect_to"), body: JSON.parse(init.body) });
    if (path === "/auth/v1/otp") return new Response("{}", { status: 200 });
    const email = confirms.shift() ?? null;
    return email
      ? Response.json({ access_token: "jwt", user: { email, email_confirmed_at: "2026-11-03T05:00:00Z" } })
      : Response.json({ error_code: "otp_expired" }, { status: 403 });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  request.headers = {};
});

const page = async (el: Promise<ReactElement>) => renderToStaticMarkup(<LangProvider initial="en">{await el}</LangProvider>);
const details = (label: string, email: string) => ({
  shopName: `${label} Stores`,
  businessType: "salon",
  city: "Pune",
  ownerName: "Kiran Rao",
  slug: `${label}-${randomBytes(3).toString("hex")}`,
  email,
});
const HASH = "pkce_0123456789abcdef0123456789abcdef";

test("ON1-EMAIL with Supabase set, the form emails a link, its page spends nothing, and its post makes the shop with the email verified", async () => {
  const email = emailFor("on1-email");
  const f = details("on1e", email);
  const form = await page(SignUpPage({ searchParams: Promise.resolve({ as: "real" }) }));
  expect(form).toContain(w.emailLede.replace(/'/g, "&#x27;"));
  expect(form).not.toContain('name="password"');
  // A forged Host and Origin: the link still returns to the configured origin.
  request.headers = { host: "evil.example", origin: "https://evil.example", "x-forwarded-proto": "https" };
  expect(await outcome(startRealSignUp(formOf(f)))).toBe("redirect /sign-up?as=real&sent=1");
  expect(calls).toEqual([{ path: "/auth/v1/otp", redirect: `${APP_URL}/sign-up/confirm`, body: { email, create_user: true } }]);
  expect(state.cookies.get(SIGNUP_COOKIE)).not.toContain(email);
  // The link's page: a form, and no call to Supabase.
  const confirm = await page(ConfirmPage({ searchParams: Promise.resolve({ token_hash: HASH }) }));
  expect(confirm).toContain(`value="${HASH}"`);
  expect(calls.length).toBe(1);
  confirms = [email];
  expect(await outcome(finishRealSignUp(formOf({ token_hash: HASH, password: PASSWORD })))).toBe("redirect /waiting");
  expect(calls[1]).toEqual({ path: "/auth/v1/verify", redirect: null, body: { type: "email", token_hash: HASH } });
  expect(state.cookies.get(SIGNUP_COOKIE)).toBe(""); // the finished sign-up's cookie is cleared
  const tenant = verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret)?.tenantId;
  const { rows } = await db.admin.query(
    `select t.data_class, i.verified_via from ops.tenant t join ops.login l using (tenant_id) join idp.identity i on i.subject::text = l.subject where t.tenant_id = $1`,
    [tenant],
  );
  expect(rows).toEqual([{ data_class: "live", verified_via: "email" }]);
  // The password-at-once path is closed while the email service is set.
  expect(await outcome(signUpReal(formOf({ ...f, slug: `${f.slug}-x`, password: PASSWORD })))).toBe("not found");
});

test("ON1-EMAIL a link confirming another email, or one Supabase refuses, makes nothing", async () => {
  const f = details("on1x", emailFor("on1-asked"));
  expect(await outcome(startRealSignUp(formOf(f)))).toBe("redirect /sign-up?as=real&sent=1");
  const before = (await db.admin.query("select count(*)::int as n from ops.tenant")).rows[0].n as number;
  confirms = [emailFor("someone-else")];
  expect(await outcome(finishRealSignUp(formOf({ token_hash: HASH, password: PASSWORD })))).toBe("redirect /sign-up?as=real&lost=1");
  confirms = [];
  expect(await outcome(finishRealSignUp(formOf({ token_hash: HASH, password: PASSWORD })))).toBe("redirect /sign-up?as=real&unconfirmed=1");
  // Without the browser's cookie the link's page offers no form, and says how to start again.
  state.cookies.delete(SIGNUP_COOKIE);
  const lost = await page(ConfirmPage({ searchParams: Promise.resolve({ token_hash: HASH }) }));
  expect(lost).not.toContain('name="password"');
  expect(lost).toContain(w.confirmNoCookie);
  expect(lost).toContain(w.confirmSameBrowser);
  expect((await db.admin.query("select count(*)::int as n from ops.tenant")).rows[0].n).toBe(before);
});

test("ON1-EMAIL-LIMIT the link's post counts against the email before Supabase is asked: past the limit it never verifies", async () => {
  const f = details("on1l", emailFor("on1-limit"));
  expect(await outcome(startRealSignUp(formOf(f)))).toBe("redirect /sign-up?as=real&sent=1"); // the email's first attempt
  const post = () => outcome(finishRealSignUp(formOf({ token_hash: HASH, password: "short" })));
  for (let i = 0; i < 2; i++) expect(await post()).toBe(`redirect /sign-up/confirm?token_hash=${HASH}&failed=1`);
  expect(await post()).toBe(`redirect /sign-up/confirm?token_hash=${HASH}&limit=1`);
  expect(calls.map((c) => c.path)).toEqual(["/auth/v1/otp"]);
});
