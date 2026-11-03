// One build serves one business, and its output carries no other business's material.
// Each business has its own site app (apps/elite, apps/prabhave: thin apps over the shared code here, `@business` fixed
// to that business's folder in the app's next.config.ts). Each is built (`next build` in its own folder) into a scratch
// folder; the output (server and client chunks, static assets, manifests; not Next's build cache), which must be newer
// than every source, is scanned for the other business's markers: its slug, its wordmark in both scripts, every
// distinctive string of its profile and every path of its drawings. Any hit fails. As a control, the build's own
// business's markers must be found, so a scan that reads nothing cannot pass. Red-proof: v2-sites-bundle-leak
// (db/test/v2/sabotage/apps-sites.ts) adds a page importing the other business's profile to the Elite app.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SITES = ["elite", "prabhave"] as const;
type Slug = (typeof SITES)[number];
const appOf = (slug: Slug) => path.join(ROOT, "..", slug);

function walk(dir: string, skip: Set<string> = new Set()): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (skip.has(name)) return [];
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full, skip) : [full];
  });
}

// The shared code and both site apps.
const sources = () => [
  ...walk(ROOT, new Set(["node_modules", ".next", "test", "scripts"])),
  ...SITES.flatMap((s) => walk(appOf(s), new Set(["node_modules", ".next", "next-env.d.ts"]))),
];

/** What only this business's folder says: its slug, wordmark, its profile's longer strings, its drawings' paths. */
function markers(slug: Slug): string[] {
  const dir = path.join(ROOT, "businesses", slug);
  const profile = readFileSync(path.join(dir, "profile.ts"), "utf8");
  const art = readFileSync(path.join(dir, "art.tsx"), "utf8");
  const strings = [...profile.matchAll(/"([^"\\]{16,})"/g)].map((m) => m[1] as string);
  const paths = [...art.matchAll(/\bd="([^"]{24,})"/g)].map((m) => m[1] as string);
  const wordmark = /wordmark: \{ en: "([^"]+)", hi: "([^"]+)"/.exec(profile);
  const elsewhere = sources()
    .filter((f) => !f.startsWith(dir + path.sep))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const own = [...new Set([...strings, ...paths])].filter((s) => !elsewhere.includes(s));
  return [slug, wordmark?.[1] ?? "", wordmark?.[2] ?? "", ...own].filter(Boolean);
}

function build(slug: Slug): string {
  const app = appOf(slug);
  const dist = `.next/bundle1-${slug}`;
  rmSync(path.join(app, dist), { recursive: true, force: true });
  const leak = path.join(app, "app", "[lang]", "planted-leak");
  if (slug === "elite" && sabotageIs("v2-sites-bundle-leak")) {
    mkdirSync(leak, { recursive: true });
    writeFileSync(
      path.join(leak, "page.tsx"),
      'import { profile } from "@munshi/sites/businesses/prabhave/profile.ts";\nexport default function Leak() {\n  return <p>{profile.wordmark.en} {profile.copy.heroLine?.en}</p>;\n}\n',
    );
  }
  try {
    // MUNSHI_SITES_DIST is this test's own knob (next.config.ts): a deploy builds into .next.
    const r = spawnSync(path.join(app, "node_modules", ".bin", "next"), ["build"], {
      cwd: app,
      env: { ...process.env, MUNSHI_SITES_DIST: dist, NEXT_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`next build for ${slug} failed (exit ${r.status}):\n${(r.stdout + r.stderr).slice(-2000)}`);
  } finally {
    rmSync(leak, { recursive: true, force: true });
  }
  return path.join(app, dist);
}

const escaped = (s: string) => JSON.stringify(s).slice(1, -1).replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function scan(dist: string, find: string[]): string[] {
  const hits: string[] = [];
  for (const file of walk(dist, new Set(["cache"]))) {
    const text = readFileSync(file, "latin1");
    const utf8 = readFileSync(file, "utf8");
    for (const m of find) {
      if (utf8.includes(m) || text.includes(escaped(m))) hits.push(`${path.relative(dist, file)}: ${m.slice(0, 60)}`);
    }
  }
  return hits;
}

test("a build for one business carries no other business's data or art, and is newer than every source", () => {
  for (const slug of SITES) {
    const other = SITES.find((s) => s !== slug) as Slug;
    const dist = build(slug);
    const built = statSync(path.join(dist, "BUILD_ID")).mtimeMs;
    expect(sources().filter((f) => statSync(f).mtimeMs > built)).toEqual([]);
    expect(scan(dist, markers(other)), `${slug} build`).toEqual([]);
    // The control: the scan reads the output it judges.
    expect(scan(dist, markers(slug)).length, `${slug} build carries its own markers`).toBeGreaterThan(0);
    rmSync(dist, { recursive: true, force: true });
  }
});
