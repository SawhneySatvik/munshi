// P-5 the console's model allow-list (/platform/models) on the demo kirana as `pnpm dev` seeds it: 404 without an
// operator; the latest row per (alias, role), each beside its change; a proposal (to switch one off, or a new pair this
// build serves) writes nothing until it is approved in a later request with the diff as shown, exactly like the
// defaults; an alias this build does not serve is refused before core sees it; once approved, the shop's chain drops it.
import { randomBytes } from "node:crypto";
import { allowList, modelCatalogue } from "@munshi/ai";
import { modelFor, withTx } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { codeOf, rewind, SECRETS } from "../../../db/test/v2/core/platform/fixture.ts";
import ChangePage from "../app/platform/(console)/changes/[id]/page";
import { proposeModelAllow } from "../app/platform/(console)/models/actions";
import ModelsPage from "../app/platform/(console)/models/page";
import { approvePlatformChange, signInToConsole } from "../app/platform/actions";
import type { Config } from "../lib/server/config";
import { state } from "./app-state";
import { formOf, outcome, request } from "./auth/request";
import { type Home, openHome, urlAs } from "./home-db";

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
const models = () => html(ModelsPage({ searchParams: q({}) }));
const digestIn = (page: string) => /name="digest" value="([0-9a-f]{64})"/.exec(page)?.[1] ?? "";
const changeIdIn = (to: string) => /^redirect \/platform\/changes\/([0-9a-f-]{36})\?proposed=1$/.exec(to)?.[1] ?? "";
const briefChain = () => withTx(h.db.app, { kind: "system", tenantId: h.k.tenantId }, (c) => modelFor(c, "brief", modelCatalogue()));
// The brief's chain on the demo list: its default, then every other narrate alias allowed, by name (the list
// offers the other providers too, behind Meta's own); `off` is one switched off.
const narrateChain = (off?: string) => ["spark-open", ...allowList().filter((p) => p.role === "narrate" && p.alias !== "spark-open" && p.alias !== off).map((p) => p.alias).sort()];

async function signIn(): Promise<void> {
  await rewind(h.db, h.operator);
  expect(await outcome(signInToConsole(formOf({ email: "asha@example.invalid", password: "a long test password", code: codeOf(h.operator) })))).toBe("redirect /platform");
}

test("CONSOLEMODELS1 the allow-list page is 404 without an operator session", async () => {
  expect(await outcome(ModelsPage({ searchParams: q({}) }))).toBe("not found");
  expect(await outcome(proposeModelAllow(formOf({ alias: "muse-spark", role: "narrate", enabled: "false" })))).toBe("not found");
});

test("CONSOLEMODELS2 a model switched off is proposed, changes nothing, and once approved in a later request the shop's chain drops it", async () => {
  await signIn();
  const page = await models();
  expect(page).toContain("muse-spark</span> · narrate");
  expect(page).toContain("spark-open</span> · narrate");
  expect(page).toMatch(/set by change <a class="pc-id" href="\/platform\/changes\/[0-9a-f-]{36}"/);
  expect(narrateChain()).toContain("muse-spark");
  expect(await briefChain()).toEqual(narrateChain());

  const to = await outcome(proposeModelAllow(formOf({ alias: "muse-spark", role: "narrate", enabled: "false" })));
  const id = changeIdIn(to);
  expect(id, to).not.toBe("");
  expect(await briefChain()).toEqual(narrateChain()); // proposed only
  const change = await html(ChangePage({ params: q({ id }), searchParams: q({ proposed: "1" }) }));
  expect(change).toMatch(/enabled<\/td><td>true<\/td><td>false<\/td>/);
  expect(await outcome(approvePlatformChange(formOf({ change: id, digest: digestIn(change) })))).toBe(`redirect /platform/changes/${id}?done=approved`);
  expect(await briefChain()).toEqual(narrateChain("muse-spark"));
  expect(await briefChain()).not.toContain("muse-spark");
  expect(await models()).toContain(`href="/platform/changes/${id}"`);
});

test("CONSOLEMODELS3 an alias this build does not serve, or not in that role, is refused before any change is written", async () => {
  await signIn();
  const count = async () => (await h.db.admin.query<{ n: number }>("select count(*)::int as n from platform.change where kind = 'model_allow'")).rows[0]?.n;
  const before = await count();
  expect(await outcome(proposeModelAllow(formOf({ alias: "gpt-unknown", role: "reason", enabled: "true" })))).toBe("redirect /platform/models?failed=invalid");
  expect(await outcome(proposeModelAllow(formOf({ pair: "sam|reason", enabled: "true" })))).toBe("redirect /platform/models?failed=invalid");
  expect(await count()).toBe(before);
  const to = await outcome(proposeModelAllow(formOf({ pair: "muse-spark|vision", enabled: "true" })));
  expect(changeIdIn(to)).not.toBe("");
  expect(await count()).toBe((before ?? 0) + 1);
});
