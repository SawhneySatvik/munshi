// jsdom's globals, with modules transformed as on the server. Vite's client transform rewrites
// `new URL("../migrations/", import.meta.url)` (the database harness) into an http asset URL; on the server it stays a
// file path. The components under test run the same either way.
import { builtinEnvironments, type Environment } from "vitest/runtime";

export default { ...builtinEnvironments.jsdom, name: "jsdom-ssr", viteEnvironment: "ssr" } satisfies Environment;
