// The import closure: the shop sites read and write only through the public API. The shared code (apps/sites) imports
// only @munshi/sdk (types from @munshi/contracts at most), React and Next, and its own files; each site app (apps/elite,
// apps/prabhave) only the shared routes and proxy (@munshi/sites), React and Next, and its own files. Never core, db, pg, adapters,
// config or another app. Every source file outside test/ and scripts/ is scanned, and so is each package's dependency
// list. Red-proof: v2-sites-closure-core (db/test/v2/sabotage/apps-sites.ts) plants a source file that imports
// @munshi/core; the scan must name it.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const APPS = ["elite", "prabhave"].map((slug) => path.join(ROOT, "..", slug));
// Tests, scripts and the test config are not the site: they never reach a build.
const SKIP = new Set(["node_modules", ".next", "test", "scripts", "vitest.config.ts"]);
const NEXT_REACT = [/^react(\/jsx-runtime|-dom(\/.*)?)?$/, /^next(\/.*)?$/];
const SHARED = [/^@munshi\/sdk$/, ...NEXT_REACT, /^@business$/];
// A site app takes the shared routes and proxy only; its business comes through `@business`, never by path.
const APP = [/^@munshi\/sites\/(app\/.+|proxy\.ts)$/, ...NEXT_REACT];
const TYPES_ONLY = [/^@munshi\/contracts$/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx|mjs|js|css)$/.test(name) && name !== "next-env.d.ts" ? [full] : [];
  });
}

// Every module a file names: import/export … from, bare import, dynamic import(), require(), CSS @import.
const SPEC = /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)|@import\s+["']([^"']+)["']/g;

function violations(root: string, allowed: RegExp[]): string[] {
  const out: string[] = [];
  for (const file of files(root)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(SPEC)) {
      const typeOnly = m[2] !== undefined;
      const spec = m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
      const rel = path.relative(path.dirname(root), file);
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(root + path.sep)) out.push(`${rel}: ${spec} leaves ${path.basename(root)}`);
        continue;
      }
      if (spec.startsWith("node:") && /^(next\.config|vitest\.config)\.ts$/.test(path.relative(root, file))) continue;
      if (allowed.some((r) => r.test(spec))) continue;
      if (typeOnly && TYPES_ONLY.some((r) => r.test(spec))) continue;
      out.push(`${rel}: ${spec}`);
    }
  }
  return out;
}

const dependencies = (dir: string) => Object.keys((JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies).sort();

test("apps/sites imports only the SDK, contracts types, React, Next and its own files; no core, db or pg", () => {
  const planted = path.join(ROOT, "lib", "planted-closure.ts");
  if (sabotageIs("v2-sites-closure-core")) writeFileSync(planted, 'import { withTx } from "@munshi/core";\nexport const leak = withTx;\n');
  try {
    expect(violations(ROOT, SHARED)).toEqual([]);
    for (const app of APPS) expect(violations(app, APP), path.basename(app)).toEqual([]);
  } finally {
    rmSync(planted, { force: true });
  }
  expect(dependencies(ROOT)).toEqual(["@munshi/sdk", "next", "react", "react-dom"]);
  for (const app of APPS) expect(dependencies(app), path.basename(app)).toEqual(["@munshi/sites", "next", "react", "react-dom"]);
});
