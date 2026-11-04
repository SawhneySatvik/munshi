// The install offer: Safari on an iPhone makes no offer of its own, so the app says where Add to Home Screen is, on the
// product site and the signed-out pages as well as Home; never on a shop's own site, inside the installed app, or once
// dismissed.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LangProvider } from "../components/LangProvider";
import { setOffer } from "../components/pwa/install";
import { PwaClient } from "../components/pwa/PwaClient";
import { PWA } from "../lib/i18n-pwa";
import { fakeMatchMedia } from "./helpers/render";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", async (real) => ({ ...(await real<typeof import("next/navigation")>()), usePathname: () => nav.path }));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const ua = Object.getOwnPropertyDescriptor(Navigator.prototype, "userAgent");

const at = (path: string) => {
  nav.path = path;
  render(
    <LangProvider initial="en">
      <PwaClient version={null} />
    </LangProvider>,
  );
};

beforeEach(() => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => IPHONE });
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "userAgent");
  if (ua) Object.defineProperty(Navigator.prototype, "userAgent", ua);
});

it("on an iPhone, the product site, the demo picker and sign-in say where Add to Home Screen is", () => {
  for (const path of ["/", "/features", "/demo", "/demo/sharma-general-store", "/sign-in", "/how-it-works"]) {
    at(path);
    expect(screen.getByRole("complementary", { name: PWA.en.installTitle }).textContent).toContain(PWA.en.installIos);
    cleanup();
  }
});

it("a shop's own site and the app's pages carry no floating offer (Home has its own, inline)", () => {
  for (const path of ["/s/elite", "/app", "/app/stock", "/offline", "/platform"]) {
    at(path);
    expect(screen.queryByRole("complementary", { name: PWA.en.installTitle })).toBeNull();
    cleanup();
  }
});

it("not inside the installed app, and never again once dismissed", () => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(true));
  at("/");
  expect(screen.queryByRole("complementary", { name: PWA.en.installTitle })).toBeNull();
  cleanup();
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  at("/");
  fireEvent.click(screen.getByRole("button", { name: PWA.en.installDismiss }));
  expect(screen.queryByRole("complementary", { name: PWA.en.installTitle })).toBeNull();
  cleanup();
  at("/demo");
  expect(screen.queryByRole("complementary", { name: PWA.en.installTitle })).toBeNull();
});

it("floating, it is for phones: a laptop browser that offers to install is not interrupted on the site", () => {
  Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150.0 Safari/537.36" });
  at("/");
  act(() => setOffer(Object.assign(new Event("beforeinstallprompt"), { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" as const }) })));
  expect(screen.queryByRole("complementary", { name: PWA.en.installTitle })).toBeNull();
  act(() => setOffer(null));
});
