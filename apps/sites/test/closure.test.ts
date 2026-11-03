// The import closure: apps/sites reads and writes only through the public API, so its runtime code
// imports only @munshi/sdk (types from @munshi/contracts at most), React and Next, and its own files; never core, db,
// pg, adapters, config or another app. Every source file outside test/ and scripts/ is scanned, and so is the package's
// dependency list. Red-proof: v2-sites-closure-core (db/test/v2/sabotage/apps-sites.ts) plants a source file that
// imports @munshi/core; the scan must name it.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
// Tests, scripts and the test config are not the site: they never reach a build.
const SKIP = new Set(["node_modules", ".next", "test", "scripts", "vitest.config.ts"]);
const ALLOWED = [/^@munshi\/sdk$/, /^react(\/jsx-runtime|-dom(\/.*)?)?$/, /^next(\/.*)?$/, /^@business$/];
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

function violations(root: string): string[] {
  const out: string[] = [];
  for (const file of files(root)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(SPEC)) {
      const typeOnly = m[2] !== undefined;
      const spec = m[3] ?? m[4] ?? m[5] ?? m[6] ?? "";
      const rel = path.relative(root, file);
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(root + path.sep)) out.push(`${rel}: ${spec} leaves apps/sites`);
        continue;
      }
      if (spec.startsWith("node:") && /^(next\.config|vitest\.config)\.ts$/.test(rel)) continue;
      if (ALLOWED.some((r) => r.test(spec))) continue;
      if (typeOnly && TYPES_ONLY.some((r) => r.test(spec))) continue;
      out.push(`${rel}: ${spec}`);
    }
  }
  return out;
}

test("apps/sites imports only the SDK, contracts types, React, Next and its own files; no core, db or pg", () => {
  const planted = path.join(ROOT, "lib", "planted-closure.ts");
  if (sabotageIs("v2-sites-closure-core")) writeFileSync(planted, 'import { withTx } from "@munshi/core";\nexport const leak = withTx;\n');
  try {
    expect(violations(ROOT)).toEqual([]);
  } finally {
    rmSync(planted, { force: true });
  }
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  expect(Object.keys(pkg.dependencies).sort()).toEqual(["@munshi/sdk", "next", "react", "react-dom"]);
});
