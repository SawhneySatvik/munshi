// The superadmin's router per shop on the console and the shop's AI budget, on the demo kirana as
// `pnpm dev` seeds it. A change to a shop's models, features or budget is proposed from the shop's page, changes
// nothing while it waits, and takes effect only once a later request approves it with the diff as shown; an alias this
// build does not serve in the role is refused before any change is written. The shop's page shows the effective state
// and whose list governs each role (the shop's or the deployment's), and the shops list shows this month's spend by
// shop. Red-proofs: db/test/v2/sabotage/router.ts.
import { randomBytes } from "node:crypto";
import { modelCatalogue } from "@munshi/ai";
import { modelFor, withTx } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { codeOf, rewind, SECRETS } from "../../../db/test/v2/core/platform/fixture.ts";
import ConsoleShopsPage from "../app/platform/(console)/page";
import ChangePage from "../app/platform/(console)/changes/[id]/page";
import ShopPage from "../app/platform/(console)/shops/[id]/page";
import { approvePlatformChange, proposePlatformChange, signInToConsole } from "../app/platform/actions";
import type { Config } from "../lib/server/config";
import { state } from "./helpers/app-state";
import { formOf, outcome, request } from "./auth/request";
import { type Home, openHome, rows, urlAs } from "./helpers/home-db";

vi.mock("next/navigation", async () => (await import("./auth/request")).navigation());
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

let h: Home;
beforeAll(async () => {
  h = await openHome();
  state.config = {
    ...(state.config as Config),
    identitySecret: SECRETS.identitySecret,
    rateSecret: randomBytes(32).toString("hex"),
    idpDatabaseUrl: urlAs(h.db, "munshi_idp"),
    publicDatabaseUrl: urlAs(h.db, "munshi_public"),
    platformDatabaseUrl: urlAs(h.db, "munshi_platform"),
    platformSecret: SECRETS.platformSecret,
  };
}, 180_000);
afterAll(async () => {
  const held = globalThis as { munshiPlatformPool?: pg.Pool | undefined; munshiIdpPool?: pg.Pool | undefined; munshiPublicPool?: pg.Pool | undefined };
  for (const k of ["munshiPlatformPool", "munshiIdpPool", "munshiPublicPool"] as const) {
    await held[k]?.end();
    held[k] = undefined;
  }
  await h.close();
});
beforeEach(() => {
  state.cookies.clear();
  request.ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
});

const q = <T,>(v: T) => Promise.resolve(v);
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const shopPage = () => html(ShopPage({ params: q({ id: h.k.tenantId }), searchParams: q({}) }));
const digestIn = (page: string) => /name="digest" value="([0-9a-f]{64})"/.exec(page)?.[1] ?? "";
const changeIdIn = (to: string) => /^redirect \/platform\/changes\/([0-9a-f-]{36})\?proposed=1$/.exec(to)?.[1] ?? "";
const back = () => `/platform/shops/${h.k.tenantId}`;
const features = async () =>
  Object.fromEntries((await rows<{ feature: string; enabled: boolean }>(h, "select feature, enabled from ai.shop_features()")).map((r) => [r.feature, r.enabled]));
const chainOf = (agent: string) => withTx(h.db.app, { kind: "system", tenantId: h.k.tenantId }, (c) => modelFor(c, agent, modelCatalogue()));
const budgetNow = async () => (await rows<{ budget_minor: string | null; state: string }>(h, "select budget_minor::text, state from ai.spend_month()"))[0];

async function signIn(): Promise<void> {
  await rewind(h.db, h.operator);
  expect(await outcome(signInToConsole(formOf({ email: "asha@example.invalid", password: "a long test password", code: codeOf(h.operator) })))).toBe("redirect /platform");
}

// Proposes from the shop's page, then approves in a later request with the diff its page shows: `between` runs while the
// change only waits.
async function proposeThenApprove(fields: Record<string, string>, between: () => Promise<void>): Promise<string> {
  const to = await outcome(proposePlatformChange(formOf({ tenant: h.k.tenantId, back: back(), ...fields })));
  const id = changeIdIn(to);
  expect(id, to).not.toBe("");
  await between();
  const change = await html(ChangePage({ params: q({ id }), searchParams: q({ proposed: "1" }) }));
  expect(await outcome(approvePlatformChange(formOf({ change: id, digest: digestIn(change) })))).toBe(`redirect /platform/changes/${id}?done=approved`);
  return id;
}

test("a shop's feature, model list and budget change only once a later request approves the change; each shows beside its change", async () => {
  await signIn();
  const before = await shopPage();
  expect(before).toContain('data-slot="shop-models"');
  expect(before).toMatch(/data-role="narrate" data-source="deployment"/);
  expect(before).toMatch(/data-feature="narration" data-enabled="on"/);

  // A feature switched off.
  const off = await proposeThenApprove({ kind: "shop_features", feature: "narration", enabled: "false" }, async () => {
    expect((await features()).narration).toBe(true); // proposed only
  });
  expect((await features()).narration).toBe(false);
  const page = await shopPage();
  expect(page).toMatch(/data-feature="narration" data-enabled="off"/);
  expect(page).toContain(`href="/platform/changes/${off}"`);

  // The shop's own list for narrate: one alias, its default. Until approval the deployment's list governs.
  const chain = await chainOf("brief");
  expect(chain.length).toBeGreaterThan(1);
  await proposeThenApprove({ kind: "shop_models", alias: "muse-spark", role: "narrate", allowed: "true", is_default: "true" }, async () => {
    expect(await chainOf("brief")).toEqual(chain);
  });
  expect(await chainOf("brief")).toEqual(["muse-spark"]);
  const listed = await shopPage();
  expect(listed).toMatch(/data-role="narrate" data-source="shop"/);
  // The panel's usable aliases and default are ai.shop_models()'s, the rule modelFor reads: on narrate's card, muse-spark
  // alone is usable, and it is the shop's default; spark-open, which the deployment enables, is off for this shop.
  const narrate = listed.slice(listed.indexOf('data-role="narrate"')).split("data-role=")[1] ?? "";
  expect(narrate).toContain("default muse-spark");
  expect(narrate).toMatch(/data-alias="muse-spark" data-usable="yes"/);
  expect(narrate).toMatch(/data-alias="spark-open" data-usable="no"/);

  // A monthly budget.
  await proposeThenApprove({ kind: "ai_budget", monthly_minor: "500" }, async () => {
    expect((await budgetNow())?.budget_minor).toBeNull();
  });
  expect(await budgetNow()).toEqual({ budget_minor: "500", state: "under" });
  // The budget's form says the cap counts priced calls only and shows the unpriced share; the Models panel says PDF bills
  // are not governed by any list here.
  const withBudget = await shopPage();
  expect(withBudget).toContain("The cap counts priced calls only");
  expect(withBudget).toMatch(/data-slot="unpriced-share">This month: (<!-- -->)?\d+(<!-- -->)? of (<!-- -->)?\d+(<!-- -->)? calls have no price/);
  expect(withBudget).toMatch(/data-slot="pdf-bills">PDF bills always use the document reader (<!-- -->)?sarvam-vision(<!-- -->)?; this list does not govern them/);
  // The shops list: this month's spend by shop, beside the change that set the budget.
  const shops = await html(ConsoleShopsPage({ searchParams: q({}) }));
  expect(shops).toContain("AI spend this month");
  expect(shops).toContain("US$0.00 of US$5.00");
});

test("an alias this build does not serve in the role, or a feature that does not exist, is refused before any change is written", async () => {
  await signIn();
  const count = async () => (await h.db.admin.query<{ n: number }>("select count(*)::int as n from platform.change where kind in ('shop_models', 'shop_features')")).rows[0]?.n;
  const n = await count();
  expect(await outcome(proposePlatformChange(formOf({ kind: "shop_models", tenant: h.k.tenantId, back: back(), alias: "gpt-unknown", role: "reason", allowed: "true", is_default: "false" })))).toBe(
    `redirect ${back()}?failed=invalid`,
  );
  expect(await outcome(proposePlatformChange(formOf({ kind: "shop_models", tenant: h.k.tenantId, back: back(), alias: "sam", role: "reason", allowed: "true", is_default: "false" })))).toBe(
    `redirect ${back()}?failed=invalid`,
  );
  expect(await outcome(proposePlatformChange(formOf({ kind: "shop_features", tenant: h.k.tenantId, back: back(), feature: "teleport", enabled: "false" })))).toMatch(
    /failed=invalid/,
  );
  // A default that is not allowed is refused by core's schema for the kind.
  expect(await outcome(proposePlatformChange(formOf({ kind: "shop_models", tenant: h.k.tenantId, back: back(), alias: "muse-spark", role: "reason", allowed: "false", is_default: "true" })))).toMatch(
    /failed=invalid/,
  );
  expect(await count()).toBe(n);
});
