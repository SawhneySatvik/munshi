// The superadmin console runs on the same site as the app, and nothing on the site
// links to it, while the console links back to the site. Scanned as source text, every shipped file of the product site,
// /app, /demo, /developers (its bundled content included, lib/kit.gen.json) and the shop sites (the shared code in
// apps/sites and the two site apps, apps/elite and apps/prabhave), with the web app's public files: no string, href,
// Link, redirect, sitemap, manifest or markdown link names /platform, on this origin or another. Outside the scan: the console's own files (app/platform, components/platform) and its session
// module, whose cookie is scoped to the path. A robots or sitemap file never names it either: listing it would advertise
// it (it asks not to be indexed by its X-Robots-Tag instead). Red-proofs: db/test/v2/sabotage/operator.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";
import { ConsoleFrame } from "../components/platform/Console";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
// Not shipped: tests and the build-time scripts (screenshot scripts may visit the console itself).
const SKIP = new Set(["node_modules", ".next", ".next-elite", ".next-prabhave", ".screenshots", "test", "scripts"]);
// Markdown outside public/ (a README) is never served, so it is no link a visitor can follow. The served developer
// docs are lib/kit.gen.json, and everything under public/ is served: both stay in the scan.
const unserved = (file: string) => /\.mdx?$/.test(file) && !/^apps\/(web|sites)\/public\//.test(file);
const CONSOLE_FILES = ["apps/web/app/platform/", "apps/web/components/platform/", "apps/web/lib/server/platform-session.ts"];
const TEXT = /\.(ts|tsx|mts|js|mjs|cjs|json|html|md|mdx|txt|xml|webmanifest|svg)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return SKIP.has(name) ? [] : walk(at);
    return TEXT.test(name) ? [at] : [];
  });
}

// A string, template or markdown link target that is /platform or a path under it, bare or after an origin.
const LINK = /["'`(](?:https?:\/\/[^\s"'`()]*)?\/platform(?=[/?#"'`)]|$)/m;

test("no page, layout, nav, footer, sitemap or manifest of the product site, /app, /demo, /developers or the shop sites links to /platform", () => {
  const srcs = ["web", "sites", "elite", "prabhave"].flatMap((app) => walk(path.join(ROOT, "apps", app))).map((file) => ({
    file: path.relative(ROOT, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));
  if (sabotageIs("v2-unlinked-planted")) {
    srcs.push({ file: "apps/web/components/Foot.tsx", text: '<Link href="/platform/sign-in">Operators</Link>' });
  }
  const scanned = srcs.filter((s) => !CONSOLE_FILES.some((c) => s.file.startsWith(c)) && !unserved(s.file));
  const files = new Set(scanned.map((s) => s.file));
  // The surfaces the ruling names are in the scan, so a miss in the walk cannot pass for clean.
  for (const f of [
    "apps/web/app/layout.tsx",
    "apps/web/app/(site)/layout.tsx",
    "apps/web/app/(site)/page.tsx",
    "apps/web/app/(site)/developers/layout.tsx",
    "apps/web/app/app/layout.tsx",
    "apps/web/app/demo/layout.tsx",
    "apps/web/app/manifest.ts",
    "apps/web/components/Foot.tsx",
    "apps/web/components/shell/AppNav.tsx",
    "apps/web/lib/kit.gen.json",
    "apps/web/public/sw.js",
    "apps/sites/app/[lang]/layout.tsx",
    "apps/elite/app/[lang]/layout.tsx",
    "apps/prabhave/app/[lang]/layout.tsx",
  ]) {
    expect(files, f).toContain(f);
  }
  const hits = scanned.flatMap((s) => {
    const m = LINK.exec(s.text);
    return m ? [`${s.file}: ${m[0]}`] : [];
  });
  expect(hits).toEqual([]);
  // A robots or sitemap file, wherever it is, does not name the console at all.
  const robots = scanned.filter((s) => /(^|\/)(robots|sitemap)\.[a-z]+$/.test(s.file) && /platform/i.test(s.text)).map((s) => s.file);
  expect(robots).toEqual([]);
});

test("the console's nav links out to the site's home and to /app", () => {
  const nav = renderToStaticMarkup(ConsoleFrame({ signedIn: true, children: null }));
  const out = [...nav.matchAll(/<a [^>]*data-out="site"[^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])?.[1]);
  expect(out).toEqual(["/", "/app"]);
  // Signed out (the sign-in page), the frame shows no nav at all.
  expect(renderToStaticMarkup(ConsoleFrame({ signedIn: false, children: null }))).not.toContain('data-out="site"');
});
