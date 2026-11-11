// The app's navigation by role, and where a sign-in lands. The owner (and a manager) have every section; counter staff
// have the counter, the credit book and stock. A desk's rail lists them under five hubs; a phone's bar holds three
// around the raised mic (the owner's reads Home · Counter · Mic · Stock · More), and More opens Jump to, which lists
// every section and hands a question no section matches to Ask. Also the typed-number parsers every entry sheet uses
// (rupees and quantities, never through a float).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { signIn } from "../app/actions";
import { AppNav } from "../components/shell/AppNav";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { type Extra, extrasFor, landing } from "../lib/nav";
import { qtyToMilli, rupeesToMinor } from "../lib/parse";
import type { Lang, Member } from "../lib/types";
import { Redirect } from "./helpers/app-state";
import { type Home, openHome } from "./helpers/home-db";

const at = vi.hoisted(() => ({ path: "/app", pushed: [] as string[] }));
vi.mock("next/navigation", async () => {
  const { Redirect } = await import("./helpers/app-state");
  return {
    usePathname: () => at.path,
    useRouter: () => ({ push: (to: string) => at.pushed.push(to) }),
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  };
});

afterEach(cleanup);

const nav = (role: Member["role"], path = "/app", lang: Lang = "en", extra: Extra[] = []) => {
  at.path = path;
  render(
    <LangProvider initial={lang}>
      <AskProvider who="test">
        <AppNav role={role} extra={extra} />
      </AskProvider>
    </LangProvider>,
  );
  return screen.getByRole("navigation");
};
const hrefs = (el: HTMLElement) => [...new Set([...el.querySelectorAll("a")].map((a) => a.getAttribute("href")))];

describe("sections by role", () => {
  // What a desk's rail lists, hub by hub; what a phone's bar holds, in order.
  const rail = (el: HTMLElement) => hrefs(el.querySelector(".nav-hubs") as HTMLElement);
  const bar = (el: HTMLElement) =>
    [...el.querySelectorAll(".nav-list > li:not(.nav-jump)")].map((li) => (li.classList.contains("nav-mic") ? "mic" : (li.querySelector("a")?.getAttribute("href") ?? "more")));

  test("the owner and a manager: all seven, under the hubs Today, Sell, Stock & buying, Money", () => {
    for (const role of ["owner", "manager"] as const) {
      const el = nav(role);
      expect(rail(el)).toEqual(["/app", "/app/counter", "/app/stock", "/app/bills", "/app/suppliers", "/app/credit", "/app/reports"]);
      expect([...el.querySelectorAll(".nav-hub-h")].map((h) => h.textContent)).toEqual(["Today", "Sell", "Stock & buying", "Money"]);
      cleanup();
    }
  });

  test("the phone bar: three sections around the raised mic, then More (owner Home · Counter · Mic · Stock · More)", () => {
    expect(bar(nav("owner"))).toEqual(["/app", "/app/counter", "mic", "/app/stock", "more"]);
    cleanup();
    expect(bar(nav("manager"))).toEqual(["/app", "/app/counter", "mic", "/app/stock", "more"]);
    cleanup();
    expect(bar(nav("staff", "/app/counter"))).toEqual(["/app/counter", "/app/stock", "mic", "/app/credit"]);
    const mic = screen.getByRole("button", { name: "Ask by voice: tap to speak" });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });

  test("counter staff: the counter, the credit book and stock, and no More (the bar holds them all)", () => {
    const el = nav("staff", "/app/counter");
    expect(rail(el)).toEqual(["/app/counter", "/app/stock", "/app/credit"]);
    expect(within(el).queryByRole("button", { name: "More" })).toBeNull();
  });

  test("the section you are in is marked as the current page (and More, when the bar does not hold it)", () => {
    let el = nav("owner", "/app/credit");
    const hubs = el.querySelector(".nav-hubs") as HTMLElement;
    expect(hubs.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(hubs).getByRole("link", { name: "Credit" }).getAttribute("aria-current")).toBe("page");
    expect(within(hubs).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    cleanup();
    el = nav("owner", "/app/reports");
    expect(within(el).getByRole("button", { name: "More" }).className).toContain("is-here");
    cleanup();
    el = nav("owner", "/app/stock");
    expect(within(el).getByRole("button", { name: "More" }).className).not.toContain("is-here");
  });

  test("the capability sections follow the role's base ones, and only those the shop can use", () => {
    expect(extrasFor("owner", new Set(["orders", "offers", "counter", "gst"]))).toEqual(["orders", "customers", "offers", "invoices", "office", "settlements", "growth", "settings"]);
    // Counter staff work the counter, the credit book and stock only: no extra section is theirs.
    expect(extrasFor("staff", new Set(["orders", "offers", "counter", "packages", "bookings"]))).toEqual([]);
    expect(extrasFor("manager", new Set())).toEqual(["office"]); // the office (the brief) needs no capability
    const el = nav("owner", "/app/staff/salary", "en", ["staff", "salary", "settings"]);
    expect(rail(el)).toEqual(["/app", "/app/counter", "/app/stock", "/app/bills", "/app/suppliers", "/app/credit", "/app/reports", "/app/staff", "/app/staff/salary"]);
    // Settings sits at the rail's foot, not in a hub.
    expect(hrefs(el.querySelector(".nav-foot") as HTMLElement)).toEqual(["/app/settings"]);
    // The longest section path holding the page is the one you are in: Salary, not Staff.
    const hubs = el.querySelector(".nav-hubs") as HTMLElement;
    expect(within(hubs).getByRole("link", { name: "Salary" }).getAttribute("aria-current")).toBe("page");
    expect(within(hubs).getByRole("link", { name: "Staff" }).getAttribute("aria-current")).toBeNull();
  });

  test("the PayPal desk: the office's, with the credit capability, under Money right after Credit", () => {
    expect(extrasFor("owner", new Set(["credit"]))).toEqual(["paypal", "office", "settings"]);
    expect(extrasFor("manager", new Set(["credit"]))).toEqual(["paypal", "office"]);
    expect(extrasFor("staff", new Set(["credit"]))).toEqual([]);
    const el = nav("owner", "/app/paypal", "en", ["paypal"]);
    const money = [...el.querySelectorAll(".nav-hub")].find((h) => h.querySelector(".nav-hub-h")?.textContent === "Money") as HTMLElement;
    expect(hrefs(money)).toEqual(["/app/credit", "/app/paypal", "/app/reports"]);
    expect(within(money).getByRole("link", { name: "PayPal desk" }).getAttribute("aria-current")).toBe("page");
  });

  test("Hindi labels, and no Devanagari in the English rail", () => {
    let el = nav("staff", "/app/stock", "hi");
    expect([...el.querySelectorAll(".nav-list .nav-a span")].map((s) => s.textContent)).toEqual(["काउंटर", "स्टॉक", "उधार"]);
    cleanup();
    el = nav("owner", "/app", "en", ["office", "settings"]);
    expect(el.textContent).not.toMatch(/[\u0900-\u097F]/);
  });
});

describe("jump to", () => {
  const jump = () => screen.getByRole("dialog", { hidden: true });
  const rows = () => [...jump().querySelectorAll(".jump-row")].map((b) => b.textContent);

  test("lists every section by hub; typing narrows by either language's label or another word for it", () => {
    nav("owner", "/app", "en", ["office", "settlements", "settings"]);
    expect(rows()).toEqual(["Home", "The office", "Counter", "Stock", "Bills", "Suppliers", "Credit", "Settlements", "Reports", "Settings"]);
    const input = within(jump()).getByRole("textbox", { hidden: true });
    fireEvent.change(input, { target: { value: "udhaar" } });
    expect(rows()).toEqual(["Credit", "Ask Munshi: “udhaar”"]);
    fireEvent.change(input, { target: { value: "उधार" } });
    expect(rows()[0]).toBe("Credit");
  });

  test("Enter opens the chosen section; arrows move the choice; a question no section matches goes to Ask", () => {
    at.pushed = [];
    nav("owner");
    const input = within(jump()).getByRole("textbox", { hidden: true });
    fireEvent.change(input, { target: { value: "s" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // "s": Counter (it answers to "sale"), then Stock, Bills, Suppliers, Credit ("dues"), Reports; one down is Stock.
    expect(rows()).toEqual(["Counter", "Stock", "Bills", "Suppliers", "Credit", "Reports", "Ask Munshi: “s”"]);
    fireEvent.submit(input.form as HTMLFormElement);
    expect(at.pushed).toEqual(["/app/stock"]);
    at.pushed = [];
    fireEvent.change(input, { target: { value: "how much did I sell yesterday" } });
    expect(rows()).toEqual(["Ask Munshi: “how much did I sell yesterday”"]);
    fireEvent.submit(input.form as HTMLFormElement);
    expect(at.pushed).toEqual(["/app/ask"]);
  });

  test("⌘K and Ctrl K open it from anywhere in the app", () => {
    nav("owner");
    const d = jump() as HTMLDialogElement;
    d.showModal = vi.fn();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.keyDown(window, { key: "K", ctrlKey: true });
    expect(d.showModal).toHaveBeenCalledTimes(1);
  });
});

describe("where a sign-in lands", () => {
  let h: Home;
  beforeAll(async () => {
    h = await openHome();
  });
  afterAll(() => h.close());
  const landed = async (memberId: string) => {
    const form = new FormData();
    form.set("member", memberId);
    try {
      await signIn(form);
    } catch (err) {
      if (err instanceof Redirect) return err.to;
      throw err;
    }
    return null;
  };

  test("counter staff on the counter; the owner and a manager on the home", async () => {
    expect(landing("staff")).toBe("/app/counter");
    expect(await landed((h.k.staff[0] as { memberId: string }).memberId)).toBe("/app/counter");
    expect(await landed(h.k.owner.memberId)).toBe("/app");
    expect(await landed(h.k.manager.memberId)).toBe("/app");
  });
});

describe("typed numbers are read as whole minor units, never through a float", () => {
  test("rupees", () => {
    expect(rupeesToMinor("0.29")).toBe(29); // parseFloat("0.29") * 100 is 28.999…
    expect(rupeesToMinor("1.1")).toBe(110);
    expect(rupeesToMinor("1,250.50")).toBe(125_050);
    expect(rupeesToMinor(" २५० ")).toBe(25_000);
    for (const bad of ["", "0", "0.00", "-5", "1.234", "1e3", "₹5", "abc", "100000001"]) expect(rupeesToMinor(bad)).toBeNull();
  });
  test("quantities by unit", () => {
    expect(qtyToMilli("2", "pack")).toBe(2000);
    expect(qtyToMilli("1.5", "pack")).toBeNull();
    expect(qtyToMilli("1.25", "kg")).toBe(1250);
    expect(qtyToMilli("0.001", "kg")).toBe(1);
    expect(qtyToMilli("1.0005", "kg")).toBeNull();
    expect(qtyToMilli("0", "pack")).toBeNull();
    expect(qtyToMilli("0", "pack", true)).toBe(0); // an empty shelf is a count
  });
});
