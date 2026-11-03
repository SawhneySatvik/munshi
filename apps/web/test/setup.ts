// The framework's request boundary, mocked for every test file: next/headers' cookies() is a jar the test fills,
// revalidatePath records, redirect throws, the client router records where it was sent. The app's config module returns the test database's settings.
import { vi } from "vitest";

vi.mock("next/headers", async () => {
  const { state } = await import("./helpers/app-state");
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
  const { state } = await import("./helpers/app-state");
  return { revalidatePath: (path: string) => void state.revalidated.push(path) };
});

vi.mock("next/navigation", async () => {
  const { NotFound, Redirect, state } = await import("./helpers/app-state");
  return {
    redirect: (to: string) => {
      throw new Redirect(to);
    },
    notFound: () => {
      throw new NotFound();
    },
    usePathname: () => state.path,
    useRouter: () => ({ push: (to: string) => void state.pushed.push(to) }),
  };
});

vi.mock("../lib/server/config", async () => {
  const { state } = await import("./helpers/app-state");
  return {
    config: () => {
      if (!state.config) throw new Error("test: no app config (call openHome first)");
      return state.config;
    },
    // No jobs pool unless a test names one: an approval's outbox flush then does nothing.
    tickSettings: () => state.tick ?? { cronSecret: "", jobsDatabaseUrl: undefined },
  };
});
