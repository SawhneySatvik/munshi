// A real shop's way in, through the app, on a demo deployment that sets real sign-in up (D-079, D-080): ON1 the real
// sign-up makes a pending real shop whose owner sees only the waiting page, every /app page sending them on to it; ON3 a
// non-owner of a pending shop, and the owner of an expired one, are refused with a line, never a 500; ON2 the console's
// accept (a tenant_accept change proposed, then approved in a later request) opens /app, with Getting started on Home;
// ON6 the sign-up's limits per network and per email; ON7 the sample shop's sign-up beside it. The words carry no digit
// and the English none of Devanagari. Never a mocked database: the identity adapter, the guards and the console's
// two-step rule are under test. Red-proofs: db/test/v2/sabotage/onboarding.ts.
import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { passwordIdentity } from "@munshi/adapters/identity";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { emailFor, FAST, IDENTITY_SECRET, PASSWORD, RATE_SECRET } from "../../../db/test/v2/core/auth/fixture.ts";
import { firstOperator, type Operator, SECRETS, signIn } from "../../../db/test/v2/core/platform/fixture.ts";
import { plant } from "../../../db/test/v2/gates/lib.ts";
import { signInWithPassword } from "../app/(auth)/actions";
import WaitingPage from "../app/(auth)/waiting/page";
import { makeSampleShop } from "../app/demo/actions";
import HomePage from "../app/app/page";
import { approvePlatformChange, proposePlatformChange } from "../app/platform/actions";
import ChangePage from "../app/platform/(console)/changes/[id]/page";
import ChangesPage from "../app/platform/(console)/changes/page";
import ShopsPage from "../app/platform/(console)/page";
import { signUpReal } from "../app/(site)/sign-up/actions";
import SignUpPage from "../app/(site)/sign-up/page";
import SignInPage from "../app/sign-in/page";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { ONBOARDING_WORDS } from "../lib/i18n-onboard";
import type { Config } from "../lib/server/config";
import { appPool } from "../lib/server/db";
import { OPERATOR_COOKIE, signOperatorCookie } from "../lib/server/platform-session";
import { SESSION_COOKIE, verifySession } from "../lib/server/session";
import { state } from "./app-state";
import { formOf, outcome, request } from "./auth/request";
import { openWebDb, urlAs, type WebDb } from "./home-db";

vi.mock("next/navigation", async () => (await import("./auth/request")).navigation());
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

const w = ONBOARDING_WORDS.en;
let db: WebDb;
let operator: Operator;

beforeAll(async () => {
  db = await openWebDb(); // no deployment row: the demo
  operator = await firstOperator(db);
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: "019a0000-0000-7000-8000-000000000000",
    identitySecret: IDENTITY_SECRET,
    rateSecret: RATE_SECRET,
    idpDatabaseUrl: urlAs(db, "munshi_idp"),
    publicDatabaseUrl: urlAs(db, "munshi_public"),
    platformDatabaseUrl: urlAs(db, "munshi_platform"),
    platformSecret: SECRETS.platformSecret,
  } as Config;
  await db.sabotage();
}, 120_000);
afterAll(async () => {
  const held = globalThis as { munshiPool?: Promise<pg.Pool> | undefined; munshiIdpPool?: pg.Pool; munshiPublicPool?: pg.Pool; munshiPlatformPool?: pg.Pool };
  await (await appPool()).end();
  for (const k of ["munshiIdpPool", "munshiPublicPool", "munshiPlatformPool"] as const) {
    await held[k]?.end();
    held[k] = undefined;
  }
  held.munshiPool = undefined;
  await db.close();
});
beforeEach(() => {
  state.cookies.clear();
  request.ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`; // each test its own network, under the limits
});

const page = async (el: Promise<ReactElement>) =>
  renderToStaticMarkup(
    <LangProvider initial="en">
      <AskProvider who="test">{await el}</AskProvider>
    </LangProvider>,
  );
const claim = () => verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret);
const fields = (label: string, over: Record<string, string> = {}) => ({
  shopName: `${label} Stores`,
  businessType: "kirana",
  city: "Indore",
  ownerName: "Meera Joshi",
  slug: `${label}-${randomBytes(3).toString("hex")}`,
  email: emailFor(label),
  password: PASSWORD,
  ...over,
});

async function signUpShop(label: string): Promise<{ tenant: string; slug: string; email: string }> {
  const f = fields(label);
  expect(await outcome(signUpReal(formOf(f)))).toBe("redirect /waiting");
  return { tenant: claim()?.tenantId as string, slug: f.slug, email: f.email };
}

// Every page under app/app, called as the server would with a cookie and nothing else.
function appPages(): string[] {
  const root = path.join(import.meta.dirname, "..", "app", "app");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const at = path.join(dir, n);
      return statSync(at).isDirectory() ? walk(at) : n === "page.tsx" ? [at] : [];
    });
  return walk(root);
}

async function asOperator(): Promise<void> {
  const s = await signIn(db, operator);
  state.cookies.set(OPERATOR_COOKIE, signOperatorCookie(s.sessionId, new Date(Date.now() + 600_000), (state.config as Config).sessionSecret));
}

test("ON1 a real sign-up makes a pending real shop; its owner sees only the waiting page, and every /app page sends them there", async () => {
  const f = fields("on1");
  expect(await outcome(signUpReal(formOf(f)))).toBe("redirect /waiting");
  const c = claim();
  expect(c).toMatchObject({ via: "real" });
  const tenant = c?.tenantId as string;
  const { rows } = await db.admin.query(
    `select t.data_class, t.sandbox, d.live, s.area, (select count(*)::int from platform.tenant_acceptance a where a.tenant_id = t.tenant_id) as accepted,
            (select i.verified_via from idp.identity i join ops.login l on l.subject = i.subject::text where l.tenant_id = t.tenant_id) as via
       from ops.tenant t join ops.tenant_directory d using (tenant_id) join ops.shop s using (tenant_id) where t.tenant_id = $1`,
    [tenant],
  );
  expect(rows).toEqual([{ data_class: "live", sandbox: false, live: true, area: "Indore", accepted: 0, via: "invite" }]);
  const waiting = await page(WaitingPage());
  expect(waiting).toContain(f.shopName);
  expect(waiting).toContain(w.pending);
  expect(waiting).toContain(w.two_weeks);
  expect(waiting).toContain("Meera Joshi");
  expect(waiting).not.toMatch(/data-figure|<td/);
  // Every /app page treats a pending shop's cookie as no session, and sign-in sends it on to the waiting page.
  const pages = appPages();
  expect(pages.length).toBeGreaterThan(20);
  const props = { params: Promise.resolve({ id: "019a0000-0000-7000-8000-000000000000", slug: "x" }), searchParams: Promise.resolve({}) };
  for (const file of pages) {
    const mod = (await import(file)) as { default: (p: typeof props) => Promise<unknown> };
    expect(`${path.relative(import.meta.dirname, file)} ${await outcome(mod.default(props))}`).toBe(`${path.relative(import.meta.dirname, file)} redirect /sign-in`);
  }
  expect(await outcome(SignInPage({ searchParams: Promise.resolve({}) }))).toBe("redirect /waiting");
  // Signed in again by password, the owner lands on the waiting page, not in the app.
  state.cookies.clear();
  expect(await outcome(signInWithPassword(formOf({ email: f.email, password: PASSWORD })))).toBe("redirect /waiting");
  // The page offers both choices, and says the email is not verified here (no email service set).
  const signUp = await page(SignUpPage({ searchParams: Promise.resolve({ as: "real" }) }));
  for (const line of [w.sampleChoice, w.realChoice, w.unverified]) expect(signUp).toContain(line.replace(/'/g, "&#x27;"));
});

test("ON3 a non-owner of a pending shop is refused with the sign-in's line, and so is the owner of an expired one: never a 500", async () => {
  const shop = await signUpShop("on3");
  // A manager planted past the guards (a pending shop takes no member and no login), with an identity of their own.
  const port = passwordIdentity({ pool: db.as("munshi_idp"), identitySecret: IDENTITY_SECRET, params: FAST });
  const email = emailFor("on3-manager");
  const made = await port.signUpOwner({ email, password: PASSWORD, avoid: [] }, { ipHash: randomBytes(32), botCheck: true }, "invite");
  const manager = "019a0000-0000-7000-8000-0000000000aa";
  await plant(db.admin, `insert into ops.member (tenant_id, id, display_name, role, created_at) values ($1, $2, 'Manager', 'manager', now())`, [shop.tenant, manager]);
  await plant(db.admin, `insert into ops.login (provider, subject, tenant_id, member_id, invite_id, created_txid) values ('password', $1, $2, $3, $4, 0)`, [
    made?.identity.subject,
    shop.tenant,
    manager,
    "019a0000-0000-7000-8000-0000000000ab",
  ]);
  await plant(db.admin, `insert into ops.subject_summary (provider, subject, memberships, highest_role) values ('password', $1, 1, 'manager') on conflict do nothing`, [made?.identity.subject]);
  state.cookies.clear();
  expect(await outcome(signInWithPassword(formOf({ email, password: PASSWORD })))).toBe("redirect /sign-in?failed=1");
  expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
  // Fifteen days on, unaccepted: the owner's sign-in says the sign-up expired.
  await plant(db.admin, `update ops.tenant set created_at = now() - interval '15 days' where tenant_id = $1`, [shop.tenant]);
  expect(await outcome(signInWithPassword(formOf({ email: shop.email, password: PASSWORD })))).toBe("redirect /sign-in?expired=1");
  expect(await page(SignInPage({ searchParams: Promise.resolve({ expired: "1" }) }))).toContain(w.realExpired);
});

test("ON2 the console lists the shop waiting; accept is proposed, approved in a later request, audited, and opens /app with Getting started", async () => {
  const shop = await signUpShop("on2");
  const owner = state.cookies.get(SESSION_COOKIE) as string;
  await asOperator();
  const listed = await page(ShopsPage());
  expect(listed).toContain(`data-waiting="${shop.tenant}"`);
  expect(listed).toContain("on2 Stores");
  expect(listed).toContain("Kirana store");
  expect(listed).toContain("Signed up today");
  const to = await outcome(proposePlatformChange(formOf({ kind: "tenant_accept", tenant: shop.tenant, back: "/platform" })));
  const id = /^redirect \/platform\/changes\/([0-9a-f-]{36})\?proposed=1$/.exec(to)?.[1] as string;
  expect(id).toBeTruthy();
  // Proposed, nothing has changed: the owner still waits.
  state.cookies.set(SESSION_COOKIE, owner);
  expect(await outcome(HomePage())).toBe("redirect /sign-in");
  const shown = await page(ChangePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
  const digest = /name="digest" value="([0-9a-f]{64})"/.exec(shown)?.[1] ?? "";
  expect(await outcome(approvePlatformChange(formOf({ change: id, digest })))).toBe(`redirect /platform/changes/${id}?done=approved`);
  const { rows } = await db.admin.query("select change_id::text from platform.tenant_acceptance where tenant_id = $1", [shop.tenant]);
  expect(rows).toEqual([{ change_id: id }]);
  expect(await page(ChangesPage())).toContain(id);
  expect(await page(ShopsPage())).not.toContain(`data-waiting="${shop.tenant}"`);
  // The owner's next visit: the app, with Getting started on Home; the waiting page now says accepted.
  const home = await page(HomePage());
  expect(home).toContain(w.startTitle);
  expect(home).toContain('data-step="items"');
  expect(await page(WaitingPage())).toContain(w.accepted);
});

test("ON2-EXPIRED a sign-up past its two weeks is counted expired, never listed to accept, and an acceptance of it is refused at proposal", async () => {
  const shop = await signUpShop("on2x");
  await plant(db.admin, `update ops.tenant set created_at = now() - interval '15 days' where tenant_id = $1`, [shop.tenant]);
  await asOperator();
  const listed = await page(ShopsPage());
  expect(listed).not.toContain(`data-waiting="${shop.tenant}"`);
  expect(Number(/([0-9]+) expired/.exec(listed)?.[1] ?? 0)).toBeGreaterThan(0);
  expect(await outcome(proposePlatformChange(formOf({ kind: "tenant_accept", tenant: shop.tenant, back: "/platform" })))).toBe("redirect /platform?failed=refused");
  expect((await db.admin.query("select count(*)::int as n from platform.change where tenant_id = $1", [shop.tenant])).rows).toEqual([{ n: 0 }]);
});

test("ON6 a real sign-up is limited per network and per email, counted before any password is hashed", async () => {
  const email = emailFor("on6");
  const bad = (over: Record<string, string>) => outcome(signUpReal(formOf(fields("on6", { slug: "Not A Slug", ...over }))));
  // Per email: three a day, from any network.
  for (let i = 0; i < 3; i++) {
    request.ip = `198.51.100.${10 + i}`;
    expect(await bad({ email })).toBe("redirect /sign-up?as=real&invalid=1");
  }
  request.ip = "198.51.100.20";
  expect(await bad({ email })).toBe("redirect /sign-up?as=real&limit=1");
  // Per network: five a day, whatever the email.
  request.ip = "198.51.100.30";
  for (let i = 0; i < 5; i++) expect(await bad({})).toBe("redirect /sign-up?as=real&invalid=1");
  expect(await bad({})).toBe("redirect /sign-up?as=real&limit=1");
  request.ip = "198.51.100.31";
  expect(await bad({})).toBe("redirect /sign-up?as=real&invalid=1");
  expect(await page(SignUpPage({ searchParams: Promise.resolve({ as: "real", limit: "1" }) }))).toContain(w.realLimit);
});

test("ON7 the sample shop's sign-up still opens a sandbox on the demo, beside the real one", async () => {
  const f = { back: "sign-up", businessType: "salon", name: "A judge's salon", slug: `on7-${randomBytes(3).toString("hex")}`, ownerName: "A judge" };
  expect(await outcome(makeSampleShop(formOf(f)))).toBe("redirect /app");
  expect(claim()).toMatchObject({ via: "sandbox" });
  const { rows } = await db.admin.query("select t.sandbox, t.data_class from ops.tenant t join ops.tenant_directory d using (tenant_id) where d.slug = $1", [f.slug]);
  expect(rows).toEqual([{ sandbox: true, data_class: "synthetic" }]);
});

test("ON-WORDS the onboarding words carry no digit, and the English no Devanagari", () => {
  for (const [lang, words] of Object.entries(ONBOARDING_WORDS)) {
    for (const [k, v] of Object.entries(words)) {
      expect(/[0-9०-९]/.test(v), `${lang}.${k}`).toBe(false);
      if (lang === "en") expect(/[ऀ-ॿ]/.test(v), `en.${k}`).toBe(false);
    }
  }
});
