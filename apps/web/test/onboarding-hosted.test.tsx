// ON5 and ON7 on a hosted demo database (D-080): there the app may make only a real shop or a sandbox, so the demo's
// sample shops are the operator's. seed:hosted's kirana, provisioned through the owner role's connection (the build's
// own, as on Supabase), seeds Sharma; its people open from /demo/sharma-general-store with demo sessions and Home renders.
// The app's own sign-up path is refused for it there (MS010), which is why. A judge's sample shop (a sandbox) still signs
// up from the site, and so does a real shop. Never a mocked database. Red-proofs: db/test/v2/sabotage/onboarding.ts.
import { randomBytes } from "node:crypto";
import { CoreError } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { type Kirana, seedKirana } from "../../../db/seed/kirana.ts";
import { asOwner } from "../../../db/test/v2/gates/lib.ts";
import { signIn } from "../app/actions";
import DemoShopPage from "../app/demo/[slug]/page";
import { makeSampleShop } from "../app/demo/actions";
import DemoPage from "../app/demo/page";
import HomePage from "../app/app/page";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import type { Config } from "../lib/server/config";
import { appPool } from "../lib/server/db";
import { SESSION_COOKIE, verifySession } from "../lib/server/session";
import { state } from "./app-state";
import { formOf, outcome, request } from "./auth/request";
import { AS_OF, openWebDb, urlAs, type WebDb } from "./home-db";

vi.mock("next/navigation", async () => (await import("./auth/request")).navigation());
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

let db: WebDb;

beforeAll(async () => {
  db = await openWebDb();
  await asOwner(db.admin, [`insert into ops.deployment (kind, hosted) values ('demo', true)`]);
  await db.sabotage();
  // The seed runs inside ON5 (a refused seed then fails that test, not the file's setup); until then no demo tenant.
  state.config = {
    databaseUrl: urlAs(db, "munshi_app"),
    agentDatabaseUrl: undefined,
    sessionSecret: randomBytes(32),
    demoTenantId: "019a0000-0000-7000-8000-000000000000",
  } as Config;
});
afterAll(async () => {
  await (await appPool()).end();
  (globalThis as { munshiPool?: Promise<pg.Pool> | undefined }).munshiPool = undefined;
  await db.close();
});

const page = async (el: Promise<ReactElement>) =>
  renderToStaticMarkup(
    <LangProvider initial="en">
      <AskProvider who="test">{await el}</AskProvider>
    </LangProvider>,
  );
const claim = () => verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret);

test("ON5 seed:hosted's kirana seeds Sharma on a hosted demo database through the owner role, and /demo/sharma-general-store opens its people", async () => {
  // The app's own sign-up path for a listed sample shop: refused on a hosted database.
  const refusal = await seedKirana(db.app, { asOf: AS_OF, slug: "sharma-app-path" }).then(
    () => null,
    (err: unknown) => err,
  );
  const owner = await db.migrator();
  let k: Kirana;
  try {
    k = await seedKirana(db.app, { asOf: AS_OF, owner });
  } finally {
    await owner.end();
  }
  (state.config as Config).demoTenantId = k.tenantId;
  expect(refusal).toBeInstanceOf(CoreError);
  expect([(refusal as CoreError).code, (refusal as CoreError).sqlstate]).toEqual(["refused", "MS010"]);
  const { rows } = await db.admin.query("select t.data_class, t.sandbox, d.live from ops.tenant t join ops.tenant_directory d using (tenant_id) where d.slug = 'sharma-general-store'");
  expect(rows).toEqual([{ data_class: "synthetic", sandbox: false, live: false }]);
  expect(k.counts.sales).toBeGreaterThan(0);
  expect(await page(DemoPage({ searchParams: Promise.resolve({}) }))).toContain('href="/demo/sharma-general-store"');
  const people = await page(DemoShopPage({ params: Promise.resolve({ slug: "sharma-general-store" }) }));
  for (const m of [k.owner, k.manager]) expect(people).toContain(`value="${m.memberId}"`);
  state.cookies.clear();
  expect(await outcome(signIn(formOf({ member: k.owner.memberId })))).toBe("redirect /app");
  expect(claim()).toMatchObject({ tenantId: k.tenantId, via: "demo" });
  expect(await page(HomePage())).toContain("Sharma General Store");
}, 240_000);

test("ON7 a judge's sample shop signs up on the hosted demo as a sandbox", async () => {
  state.cookies.clear();
  request.ip = "198.18.7.7";
  const f = { back: "sign-up", businessType: "kirana", name: "A judge's kirana", slug: `on7h-${randomBytes(3).toString("hex")}`, ownerName: "A judge" };
  expect(await outcome(makeSampleShop(formOf(f)))).toBe("redirect /app");
  expect(claim()).toMatchObject({ via: "sandbox" });
  const { rows } = await db.admin.query("select t.sandbox, t.data_class from ops.tenant t join ops.tenant_directory d using (tenant_id) where d.slug = $1", [f.slug]);
  expect(rows).toEqual([{ sandbox: true, data_class: "synthetic" }]);
});
