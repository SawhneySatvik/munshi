// PayPal (sandbox) in the web app, with no database and no network: the webhook route is a 404 in recorded mode
// and refuses a notification PayPal does not verify (or one outside the transmission window) before anything is stored;
// the panel says "PayPal sandbox" (or recorded) and every digit it shows sits in a name or a time; the strings carry no
// digit and no Devanagari in English.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { POST } from "../app/api/webhooks/paypal/route";
import { LangProvider } from "../components/LangProvider";
import { PayPalLink } from "../components/PayPalLink";
import { fillText } from "../lib/i18n";
import { PAYPAL } from "../lib/i18n-paypal";
import type { PaypalPanel } from "../lib/server/paypal-panel";
import type { Lang } from "../lib/types";
import { fakeMatchMedia, unsourced } from "./helpers/render";

const KEYS = { PAYPAL_CLIENT_ID: "AcLientIdForTheRouteTest", PAYPAL_CLIENT_SECRET: "route-test-secret-value", PAYPAL_WEBHOOK_ID: "0NH55953DH663215D" };
const BODY = JSON.stringify({
  id: "WH-3F562076HD293871E-75F399086E414290U",
  event_type: "INVOICING.INVOICE.PAID",
  resource: { invoice: { id: "INV2-Z56S-5LLA-Q52L-CPZ5", status: "PAID", payments: { paid_amount: { currency_code: "INR", value: "450.50" } } } },
});
const post = (time = new Date().toISOString()) =>
  POST(
    new Request("http://localhost/api/webhooks/paypal", {
      method: "POST",
      body: BODY,
      headers: {
        "paypal-transmission-id": "db49fb10-1343-11ef-ac58-e32457403f67",
        "paypal-transmission-time": time,
        "paypal-transmission-sig": "ab2tJk1VCFm4EqdSuKqezr38rTdY3JeRQlw94V1xYAIQVgLScAFn2XLRAhtyo==",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
        "paypal-auth-algo": "SHA256withRSA",
      },
    }),
  );

beforeEach(() => vi.stubGlobal("matchMedia", fakeMatchMedia(false)));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("recorded mode (no keys): the webhook is a 404 and calls nothing", async () => {
  for (const name of Object.keys(KEYS)) vi.stubEnv(name, "");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await post()).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

test("with the sandbox keys, a notification PayPal answers FAILURE for, or one outside the window, is refused before anything is stored", async () => {
  for (const [name, value] of Object.entries(KEYS)) vi.stubEnv(name, value);
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(String(url));
      const body = String(url).endsWith("/v1/oauth2/token") ? { access_token: "A21AA-route-test", expires_in: 3600 } : { verification_status: "FAILURE" };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  expect((await post()).status).toBe(404);
  expect(asked).toEqual(["https://api-m.sandbox.paypal.com/v1/oauth2/token", "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature"]);
  asked.length = 0;
  expect((await post(new Date(Date.now() - 3_600_000).toISOString())).status).toBe(404); // an hour old: a replay
  expect(asked).toEqual([]);
});

const panel = (mode: PaypalPanel["mode"]): PaypalPanel => ({
  mode,
  canSend: true,
  canRecord: true,
  drafts: {},
  busy: ["c1"],
  open: null,
  more: true,
  snapshots: [],
  links: {
    c1: [
      {
        id: "l1",
        status: "sent",
        live: true,
        mode,
        paypalId: "INV2-Z56S-5LLA-Q52L-CPZ5",
        payerUrl: "https://www.sandbox.paypal.com/invoice/p/#Z56S5LLAQ52LCPZ5",
        at: "2026-11-02T05:19:23Z",
        events: [
          { id: "e1", at: "2026-11-02T06:00:00Z", recorded: false, matchesLink: false, sameCurrency: true },
          { id: "e2", at: "2026-11-02T06:10:00Z", recorded: false, matchesLink: false, sameCurrency: false },
        ],
      },
    ],
  },
});

test("the panel is labelled PayPal sandbox in both languages (recorded: nothing is sent), every digit is in a name or a time, and the strings hold no digit", () => {
  for (const lang of ["en", "hi"] as Lang[]) {
    for (const mode of ["sandbox", "recorded"] as const) {
      const p = panel(mode);
      render(
        <LangProvider initial={lang}>
          <PayPalLink panel={p} links={p.links.c1 ?? []} busy more customerId="c1" name="Credit customer" />
        </LangProvider>,
      );
      const t = PAYPAL[lang];
      const body = document.body.textContent ?? "";
      expect(body).toContain(mode === "sandbox" ? t.label : t.recordedLabel);
      // Recorded mode never claims a link was made on PayPal, nor offers its payer page.
      expect(body.includes(t.sent)).toBe(mode === "sandbox");
      expect(body.includes(t.sentRecorded)).toBe(mode === "recorded");
      expect(body.includes(t.openPayer)).toBe(mode === "sandbox");
      // A live link: no second Send, a Cancel instead; a differing amount and a foreign currency said so; the cap said.
      expect(screen.queryByRole("button", { name: fillText(t.sendLinkFor, { name: "Credit customer" }) })).toBeNull();
      expect(screen.getByRole("button", { name: t.cancelLink })).toBeTruthy();
      expect(body).toContain(t.amountDiffers);
      expect(body).toContain(t.currencyDiffers);
      expect(screen.getAllByRole("button", { name: t.recordPayment }).length).toBe(1); // the foreign-currency one offers none
      expect(body).toContain(t.more);
      expect(screen.getAllByText(/PayPal sandbox/).length).toBeGreaterThan(0);
      expect(unsourced(document.body)).toEqual([]);
      cleanup();
    }
  }
  for (const lang of ["en", "hi"] as Lang[]) for (const text of Object.values(PAYPAL[lang])) expect(text).not.toMatch(/[0-9०-९]/);
  for (const text of Object.values(PAYPAL.en)) expect(text).not.toMatch(/[ऀ-ॿ]/);
});

test("a body over the cap is refused before PayPal is asked or the body is used", async () => {
  for (const [name, value] of Object.entries(KEYS)) vi.stubEnv(name, value);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: "A21AA-route-test", expires_in: 3600, verification_status: "SUCCESS" }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  // Signed-looking headers, so only the cap stands between the body and PayPal's verify call.
  const signed = {
    "paypal-transmission-id": "db49fb10-1343-11ef-ac58-e32457403f67",
    "paypal-transmission-time": new Date().toISOString(),
    "paypal-transmission-sig": "ab2tJk1VCFm4EqdSuKqezr38rTdY3JeRQlw94V1xYAIQVgLScAFn2XLRAhtyo==",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
    "paypal-auth-algo": "SHA256withRSA",
  };
  const padded = JSON.stringify({ ...JSON.parse(BODY), pad: "x".repeat(300_000) });
  const big = new Request("http://localhost/api/webhooks/paypal", { method: "POST", body: padded, headers: { ...signed, "content-length": String(padded.length) } });
  expect((await POST(big)).status).toBe(404);
  // A body that lies about its length is cut off by the counted read.
  const sly = new Request("http://localhost/api/webhooks/paypal", { method: "POST", body: padded, headers: { ...signed, "content-length": "10" } });
  expect((await POST(sly)).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

test("a verified paid event with no readable amount is read back from PayPal; a payment that cannot be stored is never answered 200", async () => {
  for (const [name, value] of Object.entries(KEYS)) vi.stubEnv(name, value);
  const asked: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      asked.push(`${init?.method ?? "GET"} ${String(url)}`);
      const u = String(url);
      const body = u.endsWith("/v1/oauth2/token")
        ? { access_token: "A21AA-route-test", expires_in: 3600 }
        : u.endsWith("/verify-webhook-signature")
          ? { verification_status: "SUCCESS" }
          : { id: "INV2-Z56S-5LLA-Q52L-CPZ5", status: "PAID", payments: { paid_amount: { currency_code: "INR", value: "450.50" } } };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const noAmount = BODY.replace(',"payments":{"paid_amount":{"currency_code":"INR","value":"450.50"}}', "");
  expect(noAmount).not.toContain("paid_amount");
  const res = await POST(
    new Request("http://localhost/api/webhooks/paypal", {
      method: "POST",
      body: noAmount,
      headers: {
        "paypal-transmission-id": "db49fb10-1343-11ef-ac58-e32457403f67",
        "paypal-transmission-time": new Date().toISOString(),
        "paypal-transmission-sig": "ab2tJk1VCFm4EqdSuKqezr38rTdY3JeRQlw94V1xYAIQVgLScAFn2XLRAhtyo==",
        "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42",
        "paypal-auth-algo": "SHA256withRSA",
      },
    }),
  );
  expect(asked).toContain("GET https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z56S-5LLA-Q52L-CPZ5");
  // The store cannot be reached here (no database in this file): PayPal is told to retry, never 200.
  expect(res.status).toBe(503);
});
