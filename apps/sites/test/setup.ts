// The framework's boundary, mocked for the page tests: next/font (a compile-time transform under next build),
// next/navigation's notFound (it throws, as in Next), and apps/web's config module, which the /api/v1 handlers read,
// pointed at the test file's database (apps/web/test/app-state.ts holds it, as in the web tests).
import { vi } from "vitest";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "font", className: "font" }) }));

vi.mock("next/navigation", async () => {
  const { NotFound } = await import("./world.ts");
  return {
    notFound: () => {
      throw new NotFound();
    },
    useParams: () => ({ lang: "en" }),
  };
});

vi.mock("../../web/lib/server/config", async () => {
  const { state } = await import("../../web/test/app-state.ts");
  return {
    config: () => {
      if (!state.config) throw new Error("test: no API config (openSites first)");
      return state.config;
    },
    tickSettings: () => ({ cronSecret: "", jobsDatabaseUrl: undefined }),
  };
});
