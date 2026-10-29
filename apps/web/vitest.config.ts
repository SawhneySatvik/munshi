import { defineConfig } from "vitest/config";

// Component tests render the owner home as the server builds it: from the kirana seed in a fresh embedded-Postgres
// database per test file, cloned from the v2 schema template (db/test/v2's harness; the database is never mocked).
// setup.ts mocks only the framework's request boundary (cookies, revalidation, redirect) and points the app's config at
// the test database.
export default defineConfig({
  test: {
    environment: "./test/jsdom-ssr.ts",
    include: ["test/**/*.test.{ts,tsx}"],
    globalSetup: ["../../db/test/v2/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
