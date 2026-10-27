// The framework's request boundary, mocked for every test file: next/headers' cookies() is a jar the test fills,
// revalidatePath records, redirect throws. The app's config module returns the test database's settings.
import { vi } from "vitest";

vi.mock("next/headers", async () => {
  const { state } = await import("./app-state");
  return {
    cookies: async () => ({
      get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) as string } : undefined),
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        state.cookies.set(name, value);
        state.cookieOptions.set(name, options);
      },
    }),
  };
});

vi.mock("next/cache", async () => {
  const { state } = await import("./app-state");
  return { revalidatePath: (path: string) => void state.revalidated.push(path) };
});

vi.mock("next/navigation", async () => {
  const { Redirect } = await import("./app-state");
  return {
    redirect: (to: string) => {
      throw new Redirect(to);
    },
  };
});

vi.mock("../lib/server/config", async () => {
  const { state } = await import("./app-state");
  return {
    config: () => {
      if (!state.config) throw new Error("test: no app config (call openHome first)");
      return state.config;
    },
  };
});
