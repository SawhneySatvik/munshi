import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { OwnerHome as OwnerHomeView } from "../components/OwnerHome";
import { dayPart } from "../lib/time";
import type { Lang, OwnerHome } from "../lib/types";
import { type Home, homeFor, openHome } from "./helpers/home-db";
import { fakeMatchMedia, renderHome } from "./helpers/render";

let h: Home;
let data: OwnerHome;
beforeAll(async () => {
  h = await openHome();
  data = await homeFor(h.k.owner);
});
afterAll(() => h.close());
beforeEach(() => {
  vi.stubGlobal("matchMedia", fakeMatchMedia(false));
  // biome-ignore lint/suspicious/noDocumentCookie: clears the cookie this test asserts on.
  document.cookie = "munshi_lang=; max-age=0; path=/";
  document.documentElement.lang = "en";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("the EN/हिंदी toggle switches the strings, the chips and <html lang>, and keeps the choice in a cookie", () => {
  renderHome(data, "en");
  expect(screen.getByRole("heading", { name: "Morning brief" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(document.cookie).not.toContain("munshi_lang=hi");

  // In English the switch's other side reads HI: no Devanagari on an English page.
  expect(document.body.textContent).not.toMatch(/[\u0900-\u097F]/);
  fireEvent.click(screen.getByRole("radio", { name: "HI" }));
  expect(screen.getByRole("heading", { name: "सुबह का हाल" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "मंज़ूर करें" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.getByRole("button", { name: "₹60, स्रोत: Gupta Traders का बिल" })).toBeTruthy();
  expect(screen.getByText("सिंथेटिक डेटा")).toBeTruthy();
  expect(document.documentElement.lang).toBe("hi");
  expect(document.cookie).toContain("munshi_lang=hi");

  fireEvent.click(screen.getByRole("radio", { name: "EN" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  expect(document.documentElement.lang).toBe("en");
  expect(document.cookie).toContain("munshi_lang=en");
});

test("a page rendered for a Hindi cookie starts in Hindi", () => {
  renderHome(data, "hi");
  expect(screen.getByRole("radio", { name: "हिंदी" })).toHaveProperty("checked", true);
  expect(screen.getByRole("button", { name: "नामंज़ूर" })).toBeTruthy();
});

test("the greeting follows the shop's clock in both languages, and names no part of the day with no clock", () => {
  // Instants in UTC; the shop's day is Asia/Kolkata's (UTC+5:30).
  const at = { morning: "2026-11-03T02:00:00Z", afternoon: "2026-11-03T08:00:00Z", evening: "2026-11-03T11:30:00Z", night: "2026-11-03T16:04:00Z", small: "2026-11-03T21:00:00Z" };
  expect([dayPart(at.morning), dayPart(at.afternoon), dayPart(at.evening), dayPart(at.night), dayPart(at.small)]).toEqual(["morning", "afternoon", "evening", "night", "night"]);
  const want: Record<Lang, [string | undefined, string][]> = {
    en: [[at.morning, "Good morning, "], [at.afternoon, "Good afternoon, "], [at.evening, "Good evening, "], [at.night, "Good evening, "], [undefined, "Hello, "]],
    hi: [[at.morning, "सुप्रभात, "], [at.afternoon, "नमस्ते, "], [at.evening, "शुभ संध्या, "], [at.night, "शुभ संध्या, "], [undefined, "नमस्ते, "]],
  };
  for (const lang of ["en", "hi"] as Lang[]) {
    for (const [now, greeting] of want[lang]) {
      render(
        <LangProvider initial={lang}>
          <AskProvider who="test">
            <OwnerHomeView data={data} {...(now ? { now } : {})} />
          </AskProvider>
        </LangProvider>,
      );
      const lede = document.querySelector(".page-lede")?.textContent ?? "";
      expect(lede, `${lang} ${now}`).toContain(`${greeting}${data.member.name.split(" ")[0]}`);
      if (lang === "en" && now !== at.morning) expect(document.body.textContent, `${now}`).not.toContain("Good morning");
      cleanup();
    }
  }
});
