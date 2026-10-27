// What the mocked framework boundary reads and records (see setup.ts): the request's cookies, the paths revalidated,
// and the app config pointing at the test file's database.
import type { Config } from "../lib/server/config";

export const state: {
  config: Config | undefined;
  cookies: Map<string, string>;
  cookieOptions: Map<string, Record<string, unknown>>;
  revalidated: string[];
} = { config: undefined, cookies: new Map(), cookieOptions: new Map(), revalidated: [] };

/** next/navigation's redirect() throws to end the request; the mock throws this, carrying the target. */
export class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect to ${to}`);
  }
}
