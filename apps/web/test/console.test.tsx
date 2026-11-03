// CONSOLE1 (BLUEPRINT §6.5, §6.10) through the app: the superadmin console at /platform answers 404 to everyone but a
// live operator session (no cookie, a member's cookie, a forged or revoked one); its sign-in is the identity adapter's
// password and then a TOTP code that counts once, into its own cookie; the operator's pool reaches no shop's books,
// approvals, snapshots or audit chain; a proposal changes nothing until a later request approves it with the digest of
// the diff it showed (and a fresh code for a channel grant), and the shops screen then shows the approving change's id;
// the change log reports the platform chain's verification. Against the demo shop as `pnpm dev` seeds it (openHome),
// never a mocked database.
import { randomBytes } from "node:crypto";
import { platformLimits } from "@munshi/core";
import type pg from "pg";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { codeOf, rewind, SECRETS, signIn } from "../../../db/test/v2/core/platform/fixture.ts";
import { tx } from "../../../db/test/v2/db.ts";
import { smallShop } from "../../../db/test/v2/core/shop.ts";
import { acceptTenant, plant } from "../../../db/test/v2/gates/lib.ts";
import { hotp, stepAt } from "../../../packages/core/src/platform-totp.ts";
import ChangePage from "../app/platform/(console)/changes/[id]/page";
import ChangesPage from "../app/platform/(console)/changes/page";
import DefaultsPage from "../app/platform/(console)/defaults/page";
import ConsoleLayout from "../app/platform/(console)/layout";
import ShopsPage from "../app/platform/(console)/page";
import ShopPage from "../app/platform/(console)/shops/[id]/page";
import { approvePlatformChange, proposePlatformChange, rejectPlatformChange, signInToConsole, signOutOfConsole } from "../app/platform/actions";
import SignInPage from "../app/platform/sign-in/page";
import { CHANNEL_REASON } from "../lib/i18n-app";
import type { Config } from "../lib/server/config";
import { platformPool } from "../lib/server/db";
import { OPERATOR_COOKIE, signOperatorCookie } from "../lib/server/platform-session";
import { SESSION_COOKIE } from "../lib/server/session";
import { state } from "./app-state";
import { formOf, outcome, request } from "./auth/request";
import { type Home, openHome, signInAs, urlAs } from "./home-db";

vi.mock("next/navigation", async () => (await import("./auth/request")).navigation());
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

const EMAIL = "asha@example.invalid"; // openHome's first operator (the platform fixture's seed)
const PASSWORD = "a long test password";

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
  request.ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`; // each test its own IP, under the per-IP limit
});
const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
const q = <T,>(v: T) => Promise.resolve(v);
const SOME_ID = "019a0000-0000-7000-8000-000000000000";

// Every console screen, each as the server renders it.
const screens = () => [
  ["layout", () => ConsoleLayout({ children: null })],
  ["/platform", () => ShopsPage()],
  ["/platform/shops/[id]", () => ShopPage({ params: q({ id: h.k.tenantId }), searchParams: q({}) })],
  ["/platform/defaults", () => DefaultsPage({ searchParams: q({}) })],
  ["/platform/changes", () => ChangesPage()],
  ["/platform/changes/[id]", () => ChangePage({ params: q({ id: SOME_ID }), searchParams: q({}) })],
] as const;

async function everyScreen(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, render] of screens()) out[name] = await outcome((render as () => Promise<unknown>)());
  return out;
}
const ALL_404 = Object.fromEntries(screens().map(([name]) => [name, "not found"]));

/** Signs the operator in through the console's own action, the code of the step after the last one used. */
async function signInOperator(code = codeOf(h.operator)): Promise<void> {
  await rewind(h.db, h.operator);
  const to = await outcome(signInToConsole(formOf({ email: EMAIL, password: PASSWORD, code })));
  expect(to).toBe("redirect /platform");
}

const digestIn = (page: string) => /name="digest" value="([0-9a-f]{64})"/.exec(page)?.[1] ?? "";
const changeIdIn = (to: string) => /^redirect \/platform\/changes\/([0-9a-f-]{36})\?proposed=1$/.exec(to)?.[1] ?? "";

describe("CONSOLE1", () => {
  test("CONSOLE1 every /platform screen is 404 with no session, a member's session, a forged cookie or a member cookie under the operator's name", async () => {
    expect(await everyScreen()).toEqual(ALL_404);
    signInAs(h.k.owner);
    expect(state.cookies.get(SESSION_COOKIE)).toBeTruthy();
    expect(await everyScreen()).toEqual(ALL_404);
    state.cookies.set(OPERATOR_COOKIE, state.cookies.get(SESSION_COOKIE) as string);
    expect(await everyScreen()).toEqual(ALL_404);
    // A live operator session (opened through core), named by a cookie signed with another key: refused.
    const live = await signIn(h.db, h.operator);
    state.cookies.set(OPERATOR_COOKIE, signOperatorCookie(live.sessionId, new Date(Date.now() + 60_000), randomBytes(32)));
    expect(await everyScreen()).toEqual(ALL_404);
    // The same session under the right key renders: the 404s above were the cookie's, not the page's.
    state.cookies.set(OPERATOR_COOKIE, signOperatorCookie(live.sessionId, new Date(Date.now() + 60_000), (state.config as Config).sessionSecret));
    expect(await outcome(ShopsPage())).toBe("rendered");
    state.cookies.delete(OPERATOR_COOKIE);
    // The sign-in page itself is the one console page that answers without a session.
    expect(await html(SignInPage({ searchParams: q({}) }))).toContain('name="code"');
  });

  test("CONSOLE1 sign-in is the password, then a TOTP code that counts once, into the operator's own cookie", async () => {
    await rewind(h.db, h.operator);
    const code = codeOf(h.operator);
    const failed = "redirect /platform/sign-in?failed=1";
    expect(await outcome(signInToConsole(formOf({ email: EMAIL, password: "not the password at all", code })))).toBe(failed);
    expect(await outcome(signInToConsole(formOf({ email: EMAIL, password: PASSWORD, code: code === "000000" ? "111111" : "000000" })))).toBe(failed);
    expect(state.cookies.has(OPERATOR_COOKIE)).toBe(false);
    expect(await outcome(signInToConsole(formOf({ email: EMAIL, password: PASSWORD, code })))).toBe("redirect /platform");
    expect(state.cookies.get(OPERATOR_COOKIE)).toMatch(/^op1\./);
    expect(state.cookieOptions.get(OPERATOR_COOKIE)).toMatchObject({ httpOnly: true, path: "/platform" });
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false); // never the member cookie
    expect(await outcome(ShopsPage())).toBe("rendered");
    // The same code again opens nothing.
    state.cookies.clear();
    expect(await outcome(signInToConsole(formOf({ email: EMAIL, password: PASSWORD, code })))).toBe(failed);
    expect(state.cookies.has(OPERATOR_COOKIE)).toBe(false);
  });

  test("CONSOLE1 sign-out revokes the operator session: the same cookie is then 404", async () => {
    await signInOperator();
    const cookie = state.cookies.get(OPERATOR_COOKIE) as string;
    expect(await outcome(ChangesPage())).toBe("rendered");
    expect(await outcome(signOutOfConsole())).toBe("redirect /platform/sign-in");
    state.cookies.set(OPERATOR_COOKIE, cookie);
    expect(await everyScreen()).toEqual(ALL_404);
  });

  test("CONSOLE1 the operator's pool reaches no shop's books, approvals, snapshots or audit chain, under the shop's own context", async () => {
    const pool = platformPool() as pg.Pool;
    const { rows } = await pool.query<{ role: string }>("select current_user as role");
    expect(rows[0]?.role).toBe("munshi_platform");
    const refused: Record<string, string> = {};
    for (const table of ["books.sale", "books.journal_entry", "approval.draft", "approval.decision", "snap.snapshot", "audit.audit_log", "ops.member"]) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('munshi.tenant_id', $1, true)`, [h.k.tenantId]);
        await c.query(`select 1 from ${table} limit 1`);
        refused[table] = "read";
      } catch (err) {
        refused[table] = (err as { code?: string }).code ?? "error";
      } finally {
        await c.query("rollback");
        c.release();
      }
    }
    expect(refused).toEqual({
      "books.sale": "42501",
      "books.journal_entry": "42501",
      "approval.draft": "42501",
      "approval.decision": "42501",
      "snap.snapshot": "42501",
      "audit.audit_log": "42501",
      "ops.member": "42501",
    });
  });
});

describe("changes", () => {
  test("a proposal changes nothing; approved in a later request it does, and the shops screen shows the approving change's id", async () => {
    await signInOperator();
    const before = await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => platformLimits(c, h.k.tenantId));
    expect(before).toMatchObject({ source: "default", aiEnabled: true });
    const to = await outcome(
      proposePlatformChange(formOf({ kind: "shop_config", tenant: h.k.tenantId, back: `/platform/shops/${h.k.tenantId}`, ai_enabled: "false", ai_daily_calls: "17", media_daily_calls: "3" })),
    );
    const id = changeIdIn(to);
    expect(id, to).not.toBe("");
    expect(await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => platformLimits(c, h.k.tenantId))).toEqual(before);

    const page = await html(ChangePage({ params: q({ id }), searchParams: q({ proposed: "1" }) }));
    expect(page).toContain("What will change");
    expect(page).toMatch(/ai_daily_calls<\/td><td>200<\/td><td>17<\/td>/);
    expect(page).not.toContain('name="code"'); // a cap change needs no fresh code
    const digest = digestIn(page);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    expect(await outcome(approvePlatformChange(formOf({ change: id, digest })))).toBe(`redirect /platform/changes/${id}?done=approved`);
    const after = await tx(h.db.app, { tenant_id: h.k.tenantId }, (c) => platformLimits(c, h.k.tenantId));
    expect(after).toMatchObject({ source: "shop", aiEnabled: false, aiDailyCalls: 17, mediaDailyCalls: 3, from: { table: "platform.shop_config", changeId: id } });

    const shops = await html(ShopsPage());
    expect(shops).toContain(h.k.tenantId);
    expect(shops).toContain(`href="/platform/changes/${id}"`);
    expect(shops).toMatch(/0 of 17/);
    expect(await html(ShopPage({ params: q({ id: h.k.tenantId }), searchParams: q({}) }))).toContain(`set by change <a class="pc-id" href="/platform/changes/${id}"`);
  });
});

test("LABEL3 the grant page says each channel's state now: a sample shop's channels are recorded, with the reason, even with credentials set and the send mode live", async () => {
  await signInOperator();
  const page = () => html(ShopPage({ params: q({ id: h.k.tenantId }), searchParams: q({}) }));
  const states = (p: string) => [...p.matchAll(/data-channel-state="([a-z_]+)"/g)].map((m) => m[1]);
  expect(states(await page())).toEqual(["sample_shop", "sample_shop"]);
  const was = state.config as Config;
  try {
    state.config = {
      ...was,
      sendMode: "live",
      whatsapp: { accessToken: "EAAG-unused", phoneNumberId: "1000000001", appSecret: "a".repeat(32), verifyToken: "v", templates: {}, templateLanguage: "en" },
      instagram: { accountRef: "founder_pro", businessAccountId: "17841400000000001", accessToken: "IGAA-unused", appSecret: "b".repeat(32), verifyToken: "v", graphHost: "graph.instagram.com" },
    };
    const shown = await page();
    expect(states(shown)).toEqual(["sample_shop", "sample_shop"]);
    expect(shown.split(`Not live now. ${CHANNEL_REASON.sample_shop?.en}`).length - 1).toBe(2);
    expect(shown).not.toContain("Live now.");
    for (const secret of ["EAAG-unused", "IGAA-unused", "a".repeat(32), "b".repeat(32)]) expect(shown).not.toContain(secret);
  } finally {
    state.config = was;
  }
});

test("approval is refused for a wrong or stale digest, and for a channel grant without a fresh, unused code; nothing is written until it holds", async () => {
    const startStep = stepAt(Date.now());
    const code = (offset = 0) => hotp(h.operator.secret, startStep + offset);
    // A channel is granted only to a real shop the operator accepted (D-080), never to the demo's sample shop.
    const real = (await smallShop(h.db.app, "Console grant", { accept: (t) => acceptTenant(h.db.admin, t) })).owner.tenantId;
    await signInOperator(code());
    const grants = async () => (await h.db.admin.query("select count(*)::int as n from platform.channel_grant where tenant_id = $1", [real])).rows[0].n as number;
    const to = await outcome(
      proposePlatformChange(formOf({ kind: "channel_grant", tenant: real, back: `/platform/shops/${real}`, channel: "whatsapp", granted: "true", max_test_recipients: "2", account_ref: "" })),
    );
    const id = changeIdIn(to);
    const page = await html(ChangePage({ params: q({ id }), searchParams: q({}) }));
    expect(page).toContain('name="code"'); // the approval asks for a fresh code
    const digest = digestIn(page);
    const back = `redirect /platform/changes/${id}?failed=`;

    expect(await outcome(approvePlatformChange(formOf({ change: id, digest: "0".repeat(64), code: code(1) })))).toBe(`${back}conflict`);
    expect(await outcome(approvePlatformChange(formOf({ change: id, digest })))).toBe(`${back}refused`); // no code: the cookie proves none
    expect(await outcome(approvePlatformChange(formOf({ change: id, digest, code: code() })))).toBe(`${back}refused`); // the sign-in's own code, replayed
    expect(await grants()).toBe(0);
    expect((await h.db.admin.query("select verdict from platform.change where id = $1", [id])).rows[0].verdict).toBeNull();

    expect(await outcome(approvePlatformChange(formOf({ change: id, digest, code: code(1) })))).toBe(`redirect /platform/changes/${id}?done=approved`);
    expect(await grants()).toBe(1);
    expect((await h.db.admin.query("select decided_totp_at is not null as fresh from platform.change where id = $1", [id])).rows[0].fresh).toBe(true);

    // Stale: shown, then something else moves the same settings first.
    await signInOperator();
    const propose = async (calls: string) =>
      changeIdIn(
        await outcome(proposePlatformChange(formOf({ kind: "shop_config", tenant: h.k.tenantId, back: "/platform", ai_enabled: "true", ai_daily_calls: calls, media_daily_calls: "4" }))),
      );
    const x = await propose("30");
    const shownX = digestIn(await html(ChangePage({ params: q({ id: x }), searchParams: q({}) })));
    const y = await propose("40");
    const shownY = digestIn(await html(ChangePage({ params: q({ id: y }), searchParams: q({}) })));
    expect(await outcome(approvePlatformChange(formOf({ change: y, digest: shownY })))).toBe(`redirect /platform/changes/${y}?done=approved`);
    expect(await outcome(approvePlatformChange(formOf({ change: x, digest: shownX })))).toBe(`redirect /platform/changes/${x}?failed=conflict`);
    expect(await outcome(rejectPlatformChange(formOf({ change: x })))).toBe(`redirect /platform/changes/${x}?done=rejected`);
    expect(await outcome(rejectPlatformChange(formOf({ change: x })))).toBe(`redirect /platform/changes/${x}?failed=not_proposed`);
});

describe("changes", () => {
  test("the demo defaults, a reserved slug and a site verification go through the same proposal and approval", async () => {
    await signInOperator();
    const approve = async (to: string) => {
      const id = changeIdIn(to);
      const digest = digestIn(await html(ChangePage({ params: q({ id }), searchParams: q({}) })));
      expect(await outcome(approvePlatformChange(formOf({ change: id, digest })))).toBe(`redirect /platform/changes/${id}?done=approved`);
      return id;
    };
    const slug = await approve(await outcome(proposePlatformChange(formOf({ kind: "reserved_slug", back: "/platform/defaults", slug: "munshi-help", note: "" }))));
    const dflt = await approve(
      await outcome(
        proposePlatformChange(
          formOf({ kind: "default_config", back: "/platform/defaults", ai_enabled: "true", ai_daily_calls: "150", media_daily_calls: "20", sandbox_media_daily_calls_total: "200" }),
        ),
      ),
    );
    const site = await approve(await outcome(proposePlatformChange(formOf({ kind: "site_verify", tenant: h.k.tenantId, back: "/platform", site_verified: "true" }))));
    const defaults = await html(DefaultsPage({ searchParams: q({}) }));
    expect(defaults).toContain("munshi-help");
    expect(defaults).toContain(`/platform/changes/${slug}`);
    expect(defaults).toContain(`/platform/changes/${dflt}`);
    expect(await html(ShopsPage())).toContain(`/platform/changes/${site}`);
    // Out of range: refused by core's schema for the kind, back on the form's page.
    expect(
      await outcome(
        proposePlatformChange(formOf({ kind: "default_config", back: "/platform/defaults", ai_enabled: "true", ai_daily_calls: "999999", media_daily_calls: "1", sandbox_media_daily_calls_total: "1" })),
      ),
    ).toBe("redirect /platform/defaults?failed=invalid&kind=default_config");
  });

  test("the change log shows that the platform chain verifies, and says so when it does not", async () => {
    await signInOperator();
    const log = await html(ChangesPage());
    expect(log).toContain("The platform chain verifies");
    expect(log).toContain("Approved");
    // Tampering, as the superuser with triggers off: an entry's payload edited after the fact.
    await plant(h.db.admin, `update platform.audit_log set payload = '{"x": "tampered"}' where seq = (select max(seq) from platform.audit_log)`);
    expect(await html(ChangesPage())).toContain("The platform chain does not verify");
  });
});
