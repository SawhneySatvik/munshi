// Where the site finds the API, on the server and in the browser.

/**
 * Where the server reads the API. Deployed, the site is a service of the same Vercel project as the web app, and its
 * binding hands the web app's address to the site's functions as WEB_URL (at request time only: never during a build or
 * in the proxy). Locally, MUNSHI_API_URL names it.
 */
export function apiBase(env: Record<string, string | undefined> = process.env): string {
  const base = env.WEB_URL || env.MUNSHI_API_URL;
  if (!base) throw new Error("apps/sites: no API address: WEB_URL (the deployed binding) or MUNSHI_API_URL (local) must name the Munshi app");
  return base;
}

/**
 * Where the browser calls the API. Deployed, the site shares the web app's domain, so the API is /api/v1 on the page's
 * own origin (an empty base). MUNSHI_PUBLIC_API_URL overrides it: locally each site runs on its own port.
 */
export const publicApiBase = (env: Record<string, string | undefined> = process.env): string => env.MUNSHI_PUBLIC_API_URL || "";
