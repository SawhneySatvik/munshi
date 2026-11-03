// The request boundary for the sign-in suites, mocked as setup.ts mocks it (cookies in the shared jar, redirect throws)
// plus what sign-in needs: notFound() throws its own error, and headers() carries the request's IP.
import { Redirect, state } from "../helpers/app-state";

export class NotFound extends Error {
  constructor() {
    super("not found");
  }
}

// `headers`: any other request header a test sends (a forged Host, an Origin).
export const request: { ip: string; headers: Record<string, string> } = { ip: "203.0.113.50", headers: {} };

export const navigation = () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound();
  },
  usePathname: () => state.path,
  useRouter: () => ({ push: (to: string) => void state.pushed.push(to) }),
});

export const headersModule = () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) as string } : undefined),
    set: (name: string, value: string, options: Record<string, unknown> = {}) => {
      state.cookies.set(name, value);
      state.cookieOptions.set(name, options);
    },
  }),
  headers: async () => new Headers({ ...request.headers, "x-forwarded-for": request.ip }),
});

/** Where an action or a page ended: a redirect's target, "not found", or "rendered". */
export async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof Redirect) return `redirect ${err.to}`;
    if (err instanceof NotFound) return "not found";
    throw err;
  }
  return "rendered";
}

export const formOf = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
