import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sabotagePlugin } from "../../db/test/v2/sabotage/index.ts";

// Three projects. `gates` (node): the bundle test builds each business and scans the output, and the import-closure scan.
// `elite` and `prabhave` (jsdom): every page rendered as the server renders it, `@business` aliased to that business,
// against the real API: apps/web's /api/v1 route handlers on a fresh v2 database with the two showcase tenants seeded
// as `pnpm dev` seeds them (db/test/v2's harness; the database is never mocked). The sabotage plugin applies a
// red-proof's source mutation as a module loads (db/test/redproof.ts).
const root = fileURLToPath(new URL("../..", import.meta.url));
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
// apps/web's lib/server and lib/api import "server-only", which throws outside a server build; the tests run them as the
// server does.
const serverOnly = { find: /^server-only$/, replacement: here("../web/node_modules/server-only/empty.js") };

const pages = (name: "elite" | "prabhave") => ({
  plugins: [sabotagePlugin(root)],
  // core reaches the tests only (the world's seed and its capability switch): never the site (test/closure.test.ts).
  // The core alias matches the bare name only, so its subpaths (@munshi/core/paypal) resolve through the package's exports.
  resolve: {
    alias: [
      { find: "@business", replacement: here(`./businesses/${name}/index.ts`) },
      { find: /^@munshi\/core$/, replacement: here("../../packages/core/src/index.ts") },
      serverOnly,
    ],
  },
  test: {
    name,
    environment: "../web/test/jsdom-ssr.ts",
    include: [`test/${name}.test.tsx`],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [sabotagePlugin(root)],
        resolve: { alias: [serverOnly] },
        test: { name: "gates", environment: "node", include: ["test/*.test.ts"], testTimeout: 900_000, hookTimeout: 900_000 },
      },
      pages("elite"),
      pages("prabhave"),
    ],
  },
});
