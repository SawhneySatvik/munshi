// UNLINKED1 (founder's ruling, 3 Nov): the superadmin console runs on the same site as the app, and nothing on the site
// links to it, while the console links back to the site. Scanned as source text, every shipped file of the product site,
// /app, /demo, /developers (its bundled content included, lib/kit.gen.json) and the shop sites (apps/sites), with the
// web app's public files: no string, href, Link, redirect, sitemap, manifest or markdown link names /platform, on this
// origin or another. Outside the scan: the console's own files (app/platform, components/platform) and its session
// module, whose cookie is scoped to the path. A robots or sitemap file never names it either: listing it would advertise
// it (it asks not to be indexed by its X-Robots-Tag instead, ROBOTS1). Red-proofs: db/test/v2/sabotage/operator.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";
import { ConsoleFrame } from "../components/platform/Console";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
// Not shipped: tests and the build-time scripts (one, scripts/shots-console.mjs, screenshots the console itself).
const SKIP = new Set(["node_modules", ".next", ".next-elite", ".next-prabhave", ".screenshots", "test", "scripts"]);
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

test("UNLINKED1 no page, layout, nav, footer, sitemap or manifest of the product site, /app, /demo, /developers or the shop sites links to /platform", () => {
  const srcs = [...walk(path.join(ROOT, "apps", "web")), ...walk(path.join(ROOT, "apps", "sites"))].map((file) => ({
    file: path.relative(ROOT, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));
  if (sabotageIs("v2-unlinked-planted")) {
    srcs.push({ file: "apps/web/components/Foot.tsx", text: '<Link href="/platform/sign-in">Operators</Link>' });
  }
  const scanned = srcs.filter((s) => !CONSOLE_FILES.some((c) => s.file.startsWith(c)));
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

test("UNLINKED1 the console's nav links out to the site's home and to /app", () => {
  const nav = renderToStaticMarkup(ConsoleFrame({ signedIn: true, children: null }));
  const out = [...nav.matchAll(/<a [^>]*data-out="site"[^>]*>/g)].map((m) => /href="([^"]+)"/.exec(m[0])?.[1]);
  expect(out).toEqual(["/", "/app"]);
  // Signed out (the sign-in page), the frame shows no nav at all.
  expect(renderToStaticMarkup(ConsoleFrame({ signedIn: false, children: null }))).not.toContain('data-out="site"');
});
