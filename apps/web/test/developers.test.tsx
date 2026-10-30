// BP-DEV-1, the developer portal (BLUEPRINT §5.7). Built at build time by `pnpm kit`, which reads no database:
//   DEV1-FRESH the bundle the pages import (lib/kit.gen.json) is exactly a fresh build from docs/kit, the recorded
//              examples, openapi.json and the SDK tarball;
//   DEV1-REF   the reference lists every route of the contracts' route table, by operation, method and path, each with
//              its auth, its success status and its error codes; every published JSON read shows its recorded example;
//   DEV1-PAGES every portal page renders with its title and the site's frame; an unknown page is a 404; the error
//              table lists every code of the contracts; the SDK page offers the tarball at the sha256 kit.test.ts checks.
// The examples and the tarball themselves are checked against a fresh showcase in kit.test.ts.
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ERRORS, routes } from "@munshi/contracts";
import type { ReactElement } from "react";
import { afterEach, expect, test } from "vitest";
import KitPage, { generateStaticParams } from "../app/(site)/developers/[page]/page";
import DevelopersLayout from "../app/(site)/developers/layout";
import DevelopersHome from "../app/(site)/developers/page";
import ReferencePage from "../app/(site)/developers/reference/page";
import SdkPage from "../app/(site)/developers/sdk/page";
import { DEV_LINKS } from "../components/dev/DevNav";
import { LangProvider } from "../components/LangProvider";
import { SiteFrame } from "../components/site/SiteFrame";
import { KIT } from "../lib/kit";
import { buildKit } from "../scripts/kit";
import { NotFound, state } from "./app-state";

afterEach(cleanup);

const show = (el: ReactElement, path: string) => {
  state.path = path;
  return render(
    <LangProvider initial="en">
      <SiteFrame>
        <DevelopersLayout>{el}</DevelopersLayout>
      </SiteFrame>
    </LangProvider>,
  );
};
const params = (page: string) => ({ params: Promise.resolve({ page }) });

test("DEV1-FRESH the bundle the portal imports is a fresh build of docs/kit, the examples, openapi.json and the SDK tarball", () => {
  expect(readFileSync(new URL("../lib/kit.gen.json", import.meta.url), "utf8")).toBe(buildKit());
});

test("DEV1-REF every route of the route table is on the reference with its method, path, auth, status and errors; every published read shows its example", () => {
  const { container } = show(<ReferencePage />, "/developers/reference");
  const ops = Object.entries(routes);
  expect(container.querySelectorAll(".d-route").length).toBe(ops.length);
  for (const [op, r] of ops) {
    const section = container.querySelector(`section[data-op="${op}"]`) as HTMLElement | null;
    expect(section, op).not.toBeNull();
    const s = within(section as HTMLElement);
    expect(s.getByRole("heading", { level: 2 }).textContent).toBe(`${r.method} /api/v1${r.path}`);
    expect(s.getByText({ none: "No key", publishable: "Publishable key", secret: "Secret key" }[r.auth])).toBeTruthy();
    expect(s.getByText(String(r.status))).toBeTruthy();
    const errs = [...(section as HTMLElement).querySelectorAll(".d-err")].map((e) => e.textContent);
    expect([op, [...errs].sort()]).toEqual([op, [...new Set(r.errors)].sort()]);
    const json = r.method === "GET" && !r.deferred && typeof r.response !== "string";
    expect([op, Boolean(section?.querySelector(".d-example"))]).toEqual([op, json]);
    if (r.deferred) expect(s.getByText(/Not open yet/)).toBeTruthy();
  }
  // The search narrows the list.
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "orders" } });
  const left = [...container.querySelectorAll(".d-route")].map((e) => e.getAttribute("data-op"));
  expect(left.sort()).toEqual(["order", "orderStatus"]);
});

test("DEV1-PAGES every portal page renders in the site's frame with its title; an unknown one is a 404; errors and the SDK as the contracts and the tarball say", async () => {
  const titles = new Map(KIT.pages.map((p) => [p.slug, p.title]));
  expect(generateStaticParams().map((p) => p.page)).toEqual(["getting-started", "auth-and-errors", "figures", "guides", "sandbox"]);
  for (const [href] of DEV_LINKS) {
    const slug = href.split("/")[2] ?? "overview";
    const el = slug === "overview" ? <DevelopersHome /> : slug === "reference" ? <ReferencePage /> : slug === "sdk" ? <SdkPage /> : await KitPage(params(slug));
    const { container } = show(el, href);
    expect([href, container.querySelector("h1")?.textContent]).toEqual([href, slug === "reference" ? "Reference" : titles.get(slug)]);
    expect(container.querySelector(".s-top"), "the site's nav").not.toBeNull();
    expect(screen.getByRole("link", { name: (DEV_LINKS.find(([h]) => h === href) as readonly [string, string])[1] }).getAttribute("aria-current")).toBe("page");
    if (slug === "auth-and-errors") {
      const codes = [...container.querySelectorAll("tr[id^='error-']")].map((tr) => tr.id.slice("error-".length));
      expect(codes).toEqual(Object.keys(ERRORS));
    }
    if (slug === "sdk") {
      expect(container.querySelector(`a[href="${KIT.sdk.href}"]`)).not.toBeNull();
      expect(container.querySelector(".d-sha")?.textContent).toBe(KIT.sdk.sha256);
    }
    cleanup();
  }
  await expect(KitPage(params("overview"))).rejects.toBeInstanceOf(NotFound);
  await expect(KitPage(params("no-such-page"))).rejects.toBeInstanceOf(NotFound);
});
