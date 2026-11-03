// The demo deployment through the app: the sign-in page sends to the demo picker, and real sign-in,
// invites, resets and the shop picker answer 404; the picker lists the sample shops and opens one's people, a
// sandbox or an unknown slug being not found; a person signs in with a demo session; and a visitor's own sample shop opens
// as a 7-day sandbox session, a taken or malformed address coming back with its line.
import { randomBytes } from "node:crypto";
import { createSandbox } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { signUp, type Tenant } from "../../../../db/test/v2/gates/fixture.ts";
import { chooseShop, joinShop, setNewPassword, signInWithPassword } from "../../app/(auth)/actions";
import ChooseShopPage from "../../app/(auth)/choose-shop/page";
import InvitePage from "../../app/(auth)/invite/[slug]/[token]/page";
import ResetPage from "../../app/(auth)/reset/[slug]/[token]/page";
import { AUTH_WORDS } from "../../app/(auth)/words";
import { signIn } from "../../app/actions";
import DemoShopPage from "../../app/demo/[slug]/page";
import { makeSampleShop } from "../../app/demo/actions";
import DemoPage from "../../app/demo/page";
import SignInPage from "../../app/sign-in/page";
import { LangProvider } from "../../components/LangProvider";
import type { Config } from "../../lib/server/config";
import { appPool } from "../../lib/server/db";
import { SESSION_COOKIE, verifySession } from "../../lib/server/session";
import { state } from "../helpers/app-state";
import { openWebDb, urlAs, type WebDb } from "../helpers/home-db";
import { formOf, outcome } from "./request";

vi.mock("next/navigation", async () => (await import("./request")).navigation());
vi.mock("next/headers", async () => (await import("./request")).headersModule());

const w = AUTH_WORDS.en;
let db: WebDb;
let shop: Tenant;

beforeAll(async () => {
  db = await openWebDb();
  shop = await signUp(db, "auth-web-demo");
  state.config = { databaseUrl: urlAs(db, "munshi_app"), agentDatabaseUrl: undefined, sessionSecret: randomBytes(32), demoTenantId: shop.tenant } satisfies Config;
});
afterAll(async () => {
  await (await appPool()).end();
  (globalThis as { munshiPool?: Promise<pg.Pool> | undefined }).munshiPool = undefined;
  await db.close();
});
beforeEach(() => state.cookies.clear());

const page = async (el: Promise<ReactElement>) => renderToStaticMarkup(<LangProvider initial="en">{await el}</LangProvider>);
const query = (q: Record<string, string> = {}) => Promise.resolve(q);
const claim = () => verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret);
const TOKEN = "F".repeat(43);

describe("demo", () => {
  test("on the demo the sign-in page sends to the picker, and real sign-in, invites, resets and the shop picker answer 404", async () => {
    expect(await outcome(SignInPage({ searchParams: query() }))).toBe("redirect /demo");
    const credentials = formOf({ email: "someone@example.invalid", password: "a long enough password" });
    expect(await outcome(signInWithPassword(credentials))).toBe("not found");
    expect(await outcome(chooseShop(formOf({ tenant: shop.tenant })))).toBe("not found");
    expect(await outcome(joinShop(formOf({ slug: shop.slug, token: TOKEN, email: "someone@example.invalid", password: "a long enough password" })))).toBe("not found");
    expect(await outcome(setNewPassword(formOf({ slug: shop.slug, token: TOKEN, password: "a long enough password" })))).toBe("not found");
    expect(await outcome(InvitePage({ params: Promise.resolve({ slug: shop.slug, token: TOKEN }), searchParams: query() }))).toBe("not found");
    expect(await outcome(ResetPage({ params: Promise.resolve({ slug: shop.slug, token: TOKEN }), searchParams: query() }))).toBe("not found");
    expect(await outcome(ChooseShopPage())).toBe("not found");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  test("the picker lists the sample shops and opens one's people, who sign in with a demo session; a sandbox or an unknown slug is not found", async () => {
    const sandbox = await createSandbox(db.app, { businessType: "kirana", name: "A visitor's sample", slug: "auth-web-visitor", ownerName: "Visitor" });
    const picker = await page(DemoPage({ searchParams: query() }));
    expect(picker).toContain(`Shop ${shop.slug}`);
    expect(picker).toContain(`href="/demo/${shop.slug}"`);
    expect(picker).not.toContain("auth-web-visitor");
    expect(picker).toContain(w.sampleTitle);
    const people = await page(DemoShopPage({ params: Promise.resolve({ slug: shop.slug }) }));
    for (const id of [shop.owner, shop.manager, shop.staff]) expect(people).toContain(`value="${id}"`);
    expect(await outcome(DemoShopPage({ params: Promise.resolve({ slug: "auth-web-visitor" }) }))).toBe("not found");
    expect(await outcome(DemoShopPage({ params: Promise.resolve({ slug: "no-such-shop" }) }))).toBe("not found");
    // A sandbox's owner is not a demo person: the picker's action signs nobody in as them.
    expect(await outcome(signIn(formOf({ member: sandbox.session.memberId })))).toBe("redirect /sign-in");
    expect(await outcome(signIn(formOf({ member: shop.manager })))).toBe("redirect /app");
    expect(claim()).toMatchObject({ tenantId: shop.tenant, memberId: shop.manager, via: "demo" });
  });

  test("a visitor's sample shop opens as a 7-day sandbox session; a taken or malformed address comes back with its line", async () => {
    const fields = { businessType: "apparel", name: "Visitor's boutique", slug: "auth-web-boutique", ownerName: "A visitor" };
    expect(await outcome(makeSampleShop(formOf(fields)))).toBe("redirect /app");
    expect(claim()).toMatchObject({ via: "sandbox" });
    expect(Number(state.cookieOptions.get(SESSION_COOKIE)?.maxAge)).toBeGreaterThan(6.9 * 86_400);
    const { rows } = await db.admin.query("select t.sandbox, t.data_class from ops.tenant t join ops.tenant_directory d using (tenant_id) where d.slug = $1", [fields.slug]);
    expect(rows).toEqual([{ sandbox: true, data_class: "synthetic" }]);
    expect(await outcome(makeSampleShop(formOf(fields)))).toBe("redirect /demo?taken=1");
    expect(await outcome(makeSampleShop(formOf({ ...fields, slug: "Not A Slug!" })))).toBe("redirect /demo?invalid=1");
    expect(await outcome(makeSampleShop(formOf({ ...fields, slug: "auth-web-other", name: "" })))).toBe("redirect /demo?invalid=1");
    expect(await page(DemoPage({ searchParams: query({ taken: "1" }) }))).toContain(w.sampleTaken);
  });
});
