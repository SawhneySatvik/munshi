// The app's navigation by role, and where a sign-in lands. The owner (and a manager) have every section; counter staff
// have the counter, the credit book and stock. A phone bar holds four slots around the raised mic in its middle,
// so the owner's bar reads Home · Counter · Mic · Credit · More and the last four sit behind "More". Also the typed-number
// parsers every entry sheet uses (rupees and quantities, never through a float).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { signIn } from "../app/actions";
import { AppNav } from "../components/shell/AppNav";
import { AskProvider } from "../components/AskProvider";
import { LangProvider } from "../components/LangProvider";
import { type Extra, extrasFor, landing } from "../lib/nav";
import { qtyToMilli, rupeesToMinor } from "../lib/parse";
import type { Lang, Member } from "../lib/types";
import { Redirect } from "./app-state";
import { type Home, openHome } from "./home-db";

const at = vi.hoisted(() => ({ path: "/app" }));
vi.mock("next/navigation", async () => {
  const { Redirect } = await import("./app-state");
  return {
    usePathname: () => at.path,
    useRouter: () => ({ push: () => {} }),
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
  test("the owner and a manager: all seven, the last four also in the More popover", () => {
    for (const role of ["owner", "manager"] as const) {
      const el = nav(role);
      expect(hrefs(el)).toEqual(["/app", "/app/counter", "/app/credit", "/app/stock", "/app/bills", "/app/suppliers", "/app/reports"]);
      const more = el.querySelector("#nav-more") as HTMLElement;
      expect(more.getAttribute("popover")).toBe("auto");
      expect(hrefs(more)).toEqual(["/app/stock", "/app/bills", "/app/suppliers", "/app/reports"]);
      expect(within(el).getByRole("button", { name: "More" }).getAttribute("popovertarget")).toBe("nav-more");
      cleanup();
    }
  });

  test("the phone bar: the raised mic in the middle, on every role's bar (owner Home · Counter · Mic · Credit · More)", () => {
    // What a phone shows: the list's items not folded into More (.nav-x), in order.
    const bar = (el: HTMLElement) =>
      [...el.querySelectorAll(".nav-list > li:not(.nav-x)")].map((li) => (li.classList.contains("nav-mic") ? "mic" : (li.querySelector("a")?.getAttribute("href") ?? "more")));
    expect(bar(nav("owner"))).toEqual(["/app", "/app/counter", "mic", "/app/credit", "more"]);
    cleanup();
    expect(bar(nav("manager"))).toEqual(["/app", "/app/counter", "mic", "/app/credit", "more"]);
    cleanup();
    expect(bar(nav("staff", "/app/counter"))).toEqual(["/app/counter", "/app/credit", "mic", "/app/stock"]);
    const mic = screen.getByRole("button", { name: "Ask by voice: tap to speak" });
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });

  test("counter staff: the counter, the credit book and stock, and no More", () => {
    const el = nav("staff", "/app/counter");
    expect(hrefs(el)).toEqual(["/app/counter", "/app/credit", "/app/stock"]);
    expect(within(el).queryByRole("button", { name: "More" })).toBeNull();
  });

  test("the section you are in is marked as the current page (and More, when it holds it)", () => {
    let el = nav("owner", "/app/credit");
    expect(el.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(within(el).getAllByRole("link", { name: "Credit" })[0]?.getAttribute("aria-current")).toBe("page");
    expect(within(el).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    cleanup();
    el = nav("owner", "/app/reports");
    expect(within(el).getByRole("button", { name: "More" }).className).toContain("is-here");
  });

  test("the capability sections follow the role's base ones, and only those the shop can use (BP-APP)", () => {
    expect(extrasFor("owner", new Set(["orders", "offers", "counter", "gst"]))).toEqual(["orders", "customers", "offers", "invoices", "office", "settlements", "growth", "settings"]);
    expect(extrasFor("staff", new Set(["orders", "offers", "counter", "packages"]))).toEqual(["orders", "customers", "packages"]);
    expect(extrasFor("manager", new Set())).toEqual(["office"]); // the office (the brief) needs no capability
    const el = nav("owner", "/app/staff/salary", "en", ["staff", "salary"]);
    expect(hrefs(el)).toEqual(["/app", "/app/counter", "/app/credit", "/app/stock", "/app/bills", "/app/suppliers", "/app/reports", "/app/staff", "/app/staff/salary"]);
    // The longest section path holding the page is the one you are in: Salary, not Staff.
    expect(within(el).getAllByRole("link", { name: "Salary" })[0]?.getAttribute("aria-current")).toBe("page");
    expect(within(el).getAllByRole("link", { name: "Staff" })[0]?.getAttribute("aria-current")).toBeNull();
  });

  test("Hindi labels", () => {
    const el = nav("staff", "/app/stock", "hi");
    expect([...el.querySelectorAll(".nav-a span")].map((s) => s.textContent)).toEqual(["काउंटर", "उधार", "स्टॉक"]);
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
