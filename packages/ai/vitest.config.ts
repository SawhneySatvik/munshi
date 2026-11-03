import { defineConfig } from "vitest/config";

// packages/ai may import nothing outside itself, its vitest config included: no sabotage plugin here. A
// red-proof that breaks a file of packages/ai runs the tests that guard it from their own package (the agent's or the
// app's, under the sabotage plugin).
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
