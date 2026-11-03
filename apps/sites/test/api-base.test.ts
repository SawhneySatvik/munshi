// Where a site finds the API (lib/api-base.ts). The server reads the web app at WEB_URL, the address the deployed
// binding hands the site's functions, else at MUNSHI_API_URL (local); with neither it refuses rather than guess. The
// browser calls /api/v1 on the page's own origin (the site shares the web app's domain), unless MUNSHI_PUBLIC_API_URL
// names another. Red-proofs: db/test/v2/sabotage/apps-sites.ts.
import { createClient } from "@munshi/sdk";
import { expect, test, vi } from "vitest";
import { apiBase, publicApiBase } from "../lib/api-base.ts";

const BOUND = "https://munshi-abc123.vercel.app";
const LOCAL = "http://localhost:3000";

test("the server reads the API at the binding's WEB_URL, else MUNSHI_API_URL, and refuses with neither", () => {
  expect(apiBase({ WEB_URL: BOUND, MUNSHI_API_URL: LOCAL })).toBe(BOUND);
  expect(apiBase({ MUNSHI_API_URL: LOCAL })).toBe(LOCAL);
  expect(apiBase({ WEB_URL: "", MUNSHI_API_URL: LOCAL })).toBe(LOCAL);
  expect(() => apiBase({})).toThrow(/WEB_URL .* or MUNSHI_API_URL/);
});

test("the browser calls /api/v1 on the page's own origin unless MUNSHI_PUBLIC_API_URL names another", async () => {
  expect(publicApiBase({ WEB_URL: BOUND, MUNSHI_API_URL: LOCAL })).toBe("");
  expect(publicApiBase({ MUNSHI_PUBLIC_API_URL: LOCAL })).toBe(LOCAL);
  // What the browser's client asks for with the default: a path on the page's origin.
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url);
    return new Response("{}", { status: 200 });
  });
  try {
    await createClient({ baseUrl: publicApiBase({}) })
      .site("elite")
      .catch(() => undefined);
  } finally {
    vi.unstubAllGlobals();
  }
  expect(asked).toEqual(["/api/v1/sites/elite"]);
});
