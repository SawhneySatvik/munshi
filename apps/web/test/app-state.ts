// What the mocked framework boundary reads and records (see setup.ts): the request's cookies, the paths revalidated,
// the client's path and where it navigated, and the app config pointing at the test file's database.
import type { Config } from "../lib/server/config";

export const state: {
  config: Config | undefined;
  cookies: Map<string, string>;
  cookieOptions: Map<string, Record<string, unknown>>;
  revalidated: string[];
  /** The page the client is on (usePathname) and where it was sent (useRouter().push). */
  path: string;
  pushed: string[];
  /** The tick's settings (lib/server/config's tickSettings), when a test runs the jobs. */
  tick?: { cronSecret: string; jobsDatabaseUrl: string | undefined } | undefined;
} = { config: undefined, cookies: new Map(), cookieOptions: new Map(), revalidated: [], path: "/", pushed: [] };

/** next/navigation's redirect() throws to end the request; the mock throws this, carrying the target. */
export class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect to ${to}`);
  }
}

/** next/navigation's notFound() throws to answer 404 (a switched-off capability's screen); the mock throws this. */
export class NotFound extends Error {
  constructor() {
    super("not found");
  }
}
