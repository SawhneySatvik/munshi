// BP-WEB-1, the product site and its onboarding. The site's pages render in English and Hindi with the calls to action
// the demo needs (Try the demo → /demo, Sign up → /sign-up, Log in → /sign-in), the plain statement of what is simulated,
// and the promise; no digit shows outside the worked example, which says on screen that it is an example on synthetic
// data. The example's figures open their record and its draft only changes local state. The sign-up page, on the demo
// deployment, is the onboarding that posts to the real makeSampleShop: a new sample shop opens in /app, a taken or
// malformed address comes back to the sign-up with its line.
import { randomBytes } from "node:crypto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type pg from "pg";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import HowItWorksPage from "../app/(site)/how-it-works/page";
import SiteHomePage from "../app/(site)/page";
import SignUpPage from "../app/(site)/sign-up/page";
import { AUTH_WORDS } from "../app/(auth)/words";
import { makeSampleShop } from "../app/demo/actions";
import { LangProvider } from "../components/LangProvider";
import { ONBOARD_WORDS } from "../components/site/onboard-words";
import { suggestSlug } from "../components/site/Onboarding";
import { SiteFrame } from "../components/site/SiteFrame";
import { SITE_WORDS } from "../components/site/words";
import type { Config } from "../lib/server/config";
import { appPool } from "../lib/server/db";
import { SESSION_COOKIE, verifySession } from "../lib/server/session";
import type { Lang } from "../lib/types";
import { state } from "./app-state";
import { formOf, outcome } from "./auth/request";
import { openWebDb, urlAs, type WebDb } from "./home-db";

vi.mock("next/navigation", async () => ({ ...(await import("./auth/request")).navigation(), useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("next/headers", async () => (await import("./auth/request")).headersModule());

afterEach(cleanup);

const framed = (page: ReactElement, lang: Lang = "en") =>
  render(
    <LangProvider initial={lang}>
      <SiteFrame>{page}</SiteFrame>
    </LangProvider>,
  );

const hrefs = (root: HTMLElement, name: string) => within(root).getAllByRole("link", { name }).map((a) => a.getAttribute("href"));

/** Every text on the page that carries a digit (Latin or Devanagari) and is not inside the labelled example. */
function digitsOutsideExample(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (/[0-9०-९]/.test(n.textContent ?? "") && !n.parentElement?.closest("[data-example]")) found.push(n.textContent ?? "");
  }
  return found;
}

describe("the site's pages", () => {
  for (const lang of ["en", "hi"] as const) {
    const w = SITE_WORDS[lang];
    test(`the home (${lang}): the story, the promise, the shop types and the calls to action, every figure inside the labelled example`, () => {
      const { container } = framed(<SiteHomePage />, lang);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(w.heroTitle);
      expect(screen.getByRole("heading", { name: w.promiseTitle })).toBeTruthy();
      for (const shop of [w.shopKirana, w.shopSalon, w.shopBoutique]) expect(screen.getByRole("heading", { name: shop })).toBeTruthy();
      expect(hrefs(container, w.tryDemo).every((h) => h === "/demo")).toBe(true);
      expect(hrefs(container, w.tryDemo).length).toBeGreaterThanOrEqual(2);
      expect(hrefs(container, w.makeShop).every((h) => h === "/sign-up")).toBe(true);
      expect(hrefs(container, w.navSignUp)).toContain("/sign-up");
      expect(hrefs(container, w.navLogIn)).toContain("/sign-in");
      expect(hrefs(container, w.navHow)).toContain("/how-it-works");
      expect(container.textContent).toContain(w.fence);
      expect(container.textContent).toContain(w.cannotVerify);
      // The samples carry digits and say they are samples on synthetic data, and are the only places that do: the worked
      // example under its note, the hero's office under its caption.
      const samples = [...container.querySelectorAll<HTMLElement>("[data-example]")];
      const example = samples.find((el) => el.textContent?.includes(w.exampleNote)) as HTMLElement;
      expect(example.textContent).toMatch(/[0-9०-९]/);
      const office = container.querySelector(".s-hero-office") as HTMLElement;
      expect(office.hasAttribute("data-example")).toBe(true);
      expect(office.textContent).toContain(w.heroOffice);
      expect(digitsOutsideExample(container)).toEqual([]);
      // English shows no Devanagari anywhere: the example, the footer and the language switch included.
      if (lang === "en") expect(container.textContent).not.toMatch(/[\u0900-\u097F]/);
    });

    test(`how it works (${lang}): the steps, the promise and the calls to action, no digit`, () => {
      const { container } = framed(<HowItWorksPage />, lang);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(w.howTitle);
      for (const step of [w.howRecordTitle, w.howReadTitle, w.howDraftTitle, w.howTraceTitle, w.howFenceTitle]) expect(screen.getByRole("heading", { name: step })).toBeTruthy();
      expect(hrefs(container, w.tryDemo)).toContain("/demo");
      expect(container.textContent).toContain(w.fence);
      expect(container.querySelector("[data-example]")).toBeNull();
      expect(digitsOutsideExample(container)).toEqual([]);
    });
  }

  test("the site's words carry no digit outside the example (both languages)", () => {
    for (const words of [SITE_WORDS.en, SITE_WORDS.hi, ONBOARD_WORDS.en, ONBOARD_WORDS.hi]) {
      expect(Object.entries(words).filter(([, v]) => /[0-9०-९]/.test(v))).toEqual([]);
    }
  });

  test("the example: a figure opens its record in the side sheet; approving and Not now change only what the page shows", () => {
    const w = SITE_WORDS.en;
    framed(<SiteHomePage />);
    const sheet = screen.getByRole("complementary", { name: w.sheetLabel });
    expect(within(sheet).getByText("Credit book · over 30 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "₹750" }));
    expect(screen.getByRole("button", { name: "₹750" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(sheet).getByText("Day book · line 4 · 1:05 pm")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: w.sheetClose }));
    expect(within(sheet).getByText(w.sheetEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: w.approve }));
    expect(screen.getByRole("status").textContent).toContain(w.approvedTitle);
    fireEvent.click(screen.getByRole("button", { name: w.again }));
    fireEvent.click(screen.getByRole("button", { name: w.notNow }));
    expect(screen.getByRole("status").textContent).toContain(w.rejectedTitle);
  });

  test("a web address is suggested from the shop's name, in the form core accepts", () => {
    expect(suggestSlug("Kumar's Kirana & Sons")).toBe("kumar-s-kirana-sons");
    expect(suggestSlug("  42 Main Road Salon ")).toBe("main-road-salon");
    expect(suggestSlug("नमूना")).toBe("");
    expect(suggestSlug("a".repeat(60))).toHaveLength(40);
    for (const s of ["kumar-s-kirana-sons", "main-road-salon", "a".repeat(40)]) expect(s).toMatch(/^[a-z][a-z0-9-]{2,39}$/);
  });
});

describe("sign-up on the demo deployment", () => {
  let db: WebDb;
  beforeAll(async () => {
    db = await openWebDb();
    state.config = { databaseUrl: urlAs(db, "munshi_app"), agentDatabaseUrl: undefined, sessionSecret: randomBytes(32), demoTenantId: undefined } as unknown as Config;
  });
  afterAll(async () => {
    await (await appPool()).end();
    (globalThis as { munshiPool?: Promise<pg.Pool> | undefined }).munshiPool = undefined;
    await db.close();
  });
  beforeEach(() => state.cookies.clear());
  const page = async (el: Promise<ReactElement>) => renderToStaticMarkup(<LangProvider initial="en">{await el}</LangProvider>);
  const a = AUTH_WORDS.en;

  test("the onboarding: the three kinds of shop, the fields, a form that names this page to return to", async () => {
    const html = await page(SignUpPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(ONBOARD_WORDS.en.title);
    for (const t of ["kirana", "salon", "apparel"]) expect(html).toMatch(new RegExp(`<input type="radio" name="businessType"( checked="")? value="${t}"/>`));
    for (const f of ["name", "slug", "ownerName"]) expect(html).toContain(`name="${f}"`);
    expect(html).toContain('name="back" value="sign-up"');
    expect(html).toContain('href="/demo"');
    expect(html).toContain('href="/sign-in"');
    expect(html).not.toContain(a.sampleTaken);
    expect(await page(SignUpPage({ searchParams: Promise.resolve({ taken: "1" }) }))).toContain(a.sampleTaken);
    expect(await page(SignUpPage({ searchParams: Promise.resolve({ invalid: "1" }) }))).toContain(a.sampleInvalid);
  });

  test("SANDBOX1 through the site: a sample shop opens in /app; a taken or malformed address comes back to the sign-up", async () => {
    const fields = { back: "sign-up", businessType: "salon", name: "A judge's salon", slug: "site-judge-salon", ownerName: "A judge" };
    expect(await outcome(makeSampleShop(formOf(fields)))).toBe("redirect /app");
    expect(verifySession(state.cookies.get(SESSION_COOKIE), (state.config as Config).sessionSecret)).toMatchObject({ via: "sandbox" });
    const { rows } = await db.admin.query("select t.sandbox, t.data_class, t.business_type from ops.tenant t join ops.tenant_directory d using (tenant_id) where d.slug = $1", [fields.slug]);
    expect(rows).toEqual([{ sandbox: true, data_class: "synthetic", business_type: "salon" }]);
    state.cookies.clear();
    expect(await outcome(makeSampleShop(formOf(fields)))).toBe("redirect /sign-up?taken=1");
    expect(await outcome(makeSampleShop(formOf({ ...fields, slug: "Not A Slug!" })))).toBe("redirect /sign-up?invalid=1");
    // Any other `back` is the demo picker: the action never redirects to a place the form names.
    expect(await outcome(makeSampleShop(formOf({ ...fields, back: "https://example.invalid" })))).toBe("redirect /demo?taken=1");
    expect(state.cookies.has(SESSION_COOKIE)).toBe(false);
  });
});
