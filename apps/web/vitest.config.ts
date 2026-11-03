import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sabotagePlugin } from "../../db/test/v2/sabotage/index.ts";

// Component tests render the owner home as the server builds it: from the kirana seed in a fresh embedded-Postgres
// database per test file, cloned from the v2 schema template (db/test/v2's harness; the database is never mocked).
// setup.ts mocks only the framework's request boundary (cookies, revalidation, redirect) and points the app's config at
// the test database. The sabotage plugin applies a red-proof's source mutation as a module loads (test/redproof.ts).
export default defineConfig({
  plugins: [sabotagePlugin(fileURLToPath(new URL("../..", import.meta.url)))],
  // lib/server and lib/api import "server-only", which throws outside a server build; a test runs them as the server does.
  resolve: { alias: [{ find: /^server-only$/, replacement: fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)) }] },
  test: {
    environment: "./test/jsdom-ssr.ts",
    include: ["test/**/*.test.{ts,tsx}"],
    globalSetup: ["../../db/test/v2/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fsModuleCache: !process.env.MUNSHI_SABOTAGE,
  },
});
