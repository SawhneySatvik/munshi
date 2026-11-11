// The request hook skips public/'s files (an icon, the service worker, the offline page, the order widget, the SDK
// tarball, the schedule board's Bryntum build and its fonts) and runs on everything else: every page, every API route
// (a card picture under /api included), and the app's own icon route. The header tests
// (db/test/v2/core/boot/headers.test.ts) hold the headers on what it runs on.
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import nextConfig from "../next.config";
import { config } from "../proxy";
import { unstable_doesMiddlewareMatch } from "./hosting/next";

const runs = (at: string) => unstable_doesMiddlewareMatch({ config, nextConfig, url: `http://localhost${at}` });

const PUBLIC = path.join(import.meta.dirname, "..", "public");
const publicFiles = readdirSync(PUBLIC, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => `/${path.relative(PUBLIC, path.join(e.parentPath, e.name)).split(path.sep).join("/")}`);

const ID = "0198a0b0-0000-7000-8000-000000000001";

describe("the request hook's matcher", () => {
  test("public/'s files are served without the hook", () => {
    expect(publicFiles).toEqual(expect.arrayContaining(["/sw.js", "/offline.html", "/icons/icon-192.png", "/widgets/munshi-order.js"]));
    for (const at of publicFiles) expect(runs(at), at).toBe(false);
  });

  test("pages, API routes (a .jpg one too) and the app's icon route run through it", () => {
    for (const at of ["/", "/app", "/app/stock", `/app/bills/${ID}`, "/sign-in", "/offline", "/platform", "/no-such-page", "/icon.svg"]) expect(runs(at), at).toBe(true);
    for (const at of ["/api/health", "/api/v1/sites/x", `/api/office/cards/${ID}.jpg`, `/api/cards/${ID}/${ID}.jpg`, "/api/widget.js"]) expect(runs(at), at).toBe(true);
  });
});
