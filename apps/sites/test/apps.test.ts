// The two site apps (apps/elite, apps/prabhave) are thin: each serves every shared route in apps/sites/app from a file
// at the same path that re-exports it, with the segment config Next reads from the route file itself written there
// ("use client", `dynamic`). Each app's proxy (the shared one, with the app's own matcher) sends a page address to its
// English page under the base path, the bare /s/<slug> included. Each app's next.config.ts fixes its business:
// `@business` resolves to that business's folder alone, and the app lives under /s/<slug>, which its plain links know
// too. Red-proofs:
// db/test/v2/sabotage/apps-sites.ts.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";
import elite from "../../elite/next.config.ts";
import * as eliteProxy from "../../elite/proxy.ts";
import prabhave from "../../prabhave/next.config.ts";
import * as prabhaveProxy from "../../prabhave/proxy.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SHARED = path.join(ROOT, "app");
const SITES = ["elite", "prabhave"] as const;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => (statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name)) : [path.join(dir, name)]));
const routes = (dir: string) => walk(dir).map((f) => path.relative(dir, f).split(path.sep).join("/")).sort();

test("each site app serves every shared route, re-exporting it with its segment config in place", () => {
  const planted = path.join(SHARED, "[lang]", "planted-route");
  if (sabotageIs("v2-sites-app-route-missing")) {
    mkdirSync(planted, { recursive: true });
    writeFileSync(path.join(planted, "page.tsx"), "export default function Planted() {\n  return null;\n}\n");
  }
  try {
    const shared = routes(SHARED);
    expect(shared).toContain("[lang]/page.tsx");
    for (const slug of SITES) {
      const dir = path.join(ROOT, "..", slug, "app");
      expect(routes(dir), slug).toEqual(shared);
      for (const rel of shared) {
        const source = readFileSync(path.join(SHARED, rel), "utf8");
        let thin = readFileSync(path.join(dir, rel), "utf8");
        if (slug === "prabhave" && rel === "[lang]/page.tsx" && sabotageIs("v2-sites-app-dynamic-dropped")) thin = thin.replace('export const dynamic = "force-dynamic";\n', "");
        expect(thin, `${slug}/${rel}`).toContain(`from "@munshi/sites/app/${rel}";`);
        expect(thin.startsWith('"use client";'), `${slug}/${rel} "use client"`).toBe(source.startsWith('"use client";'));
        const dynamic = /^export const dynamic = "force-dynamic";$/m;
        expect(dynamic.test(thin), `${slug}/${rel} dynamic`).toBe(dynamic.test(source));
      }
    }
  } finally {
    rmSync(planted, { recursive: true, force: true });
  }
});

// Next's own compiler for a proxy's matcher (internal, so typed here by hand).
type Matchers = (matcher: unknown, nextConfig: { basePath?: string }) => { regexp: string }[];

test("each site's proxy sends every page address, the bare home included, to its English page under the base path", async () => {
  const { getMiddlewareMatchers } = (await import("next/dist/build/analysis/get-page-static-info.js")) as unknown as { getMiddlewareMatchers: Matchers };
  for (const [slug, app] of [["elite", eliteProxy], ["prabhave", prabhaveProxy]] as const) {
    const base = `/s/${slug}`;
    const matchers = getMiddlewareMatchers(app.config.matcher, { basePath: base }).map((m) => new RegExp(m.regexp));
    const runs = (p: string) => matchers.some((r) => r.test(p));
    for (const p of [base, `${base}/services`, `${base}/hi`, `${base}/catalogue/abc`]) expect(runs(p), `${slug} runs on ${p}`).toBe(true);
    for (const p of [`${base}/_next/static/chunks/a.js`, `${base}/robots.txt`, "/", "/app"]) expect(runs(p), `${slug} skips ${p}`).toBe(false);
    const rewrite = (p: string) => app.proxy(new NextRequest(`http://shop.test${p}`, { nextConfig: { basePath: base } }))?.headers.get("x-middleware-rewrite") ?? null;
    expect(rewrite(base)).toBe(`http://shop.test${base}/en`);
    expect(rewrite(`${base}/services`)).toBe(`http://shop.test${base}/en/services`);
    expect(rewrite(`${base}/hi/services`)).toBeNull();
    expect(rewrite(`${base}/en/book`)).toBeNull();
  }
});

test("each site app's config fixes its business, at /s/<slug>, building into .next", () => {
  for (const [slug, config] of [["elite", elite], ["prabhave", prabhave]] as const) {
    const base = `/s/${slug}`;
    expect(config.basePath, slug).toBe(base);
    expect(config.env, slug).toEqual({ NEXT_PUBLIC_MUNSHI_SITES_BASE_PATH: base });
    expect(config.turbopack?.resolveAlias, slug).toEqual({ "@business": `../sites/businesses/${slug}/index.ts` });
    expect(config.transpilePackages, slug).toEqual(["@munshi/sites"]);
    // Vercel packages .next alone; only the bundle test moves it.
    expect(config.distDir, slug).toBe(".next");
  }
});
