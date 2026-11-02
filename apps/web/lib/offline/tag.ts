// The session tag: a cookie the page can read, a random id set beside the session cookie each time a session is opened
// and cleared at sign-out (lib/server/session.ts). It is never the session token and nothing is derived from it. The
// offline store keeps views under the tag they were read in, and drops them the moment the tag on this device differs:
// a switch of shop or person, a sign-out, or an expired session (the cookie goes with it).
export const TAG_COOKIE = "munshi_tag";

/** The tag in a cookie header (document.cookie); "" when there is none. */
export function tagIn(cookieHeader: string): string {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TAG_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}
