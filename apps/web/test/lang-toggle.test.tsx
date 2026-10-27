import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { OwnerHome } from "../lib/types";
import { type Home, homeFor, openHome } from "./home-db";
import { fakeMatchMedia, renderHome } from "./render";

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

  fireEvent.click(screen.getByRole("radio", { name: "हिंदी" }));
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
