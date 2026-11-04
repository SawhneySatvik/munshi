// The site's one door to the books: Munshi's public API v1 through @munshi/sdk. Pages read the
// published release by the build's slug at request time; nothing here holds a figure of its own. Server-side reads send
// no Origin and no key; the browser's writes carry the site's publishable key (made for public pages) and the page's
// Origin, which the API checks against the site's own list.
import business from "@business";
import { type Client, createClient, MunshiError, type Site } from "@munshi/sdk";
import { notFound } from "next/navigation";
import { cache } from "react";
import { apiBase, publicApiBase } from "./api-base.ts";

export const SLUG = business.profile.slug;

/** What a client component needs to call the API from the browser. The key is a publishable key: public by design. */
export type BrowserApi = { base: string; key: string | null; slug: string };
export function browserApi(): BrowserApi {
  const siteKey = process.env[`MUNSHI_SITE_KEY_${SLUG.toUpperCase()}`];
  return { base: publicApiBase(), key: siteKey ?? process.env.MUNSHI_SITE_KEY ?? null, slug: SLUG };
}

const client = (): Client => createClient({ baseUrl: apiBase() });

/** The published site; an unknown, unverified or unpublished site is the one 404, and so is this page. */
export const getSite = cache(async (): Promise<Site> => {
  try {
    return await client().site(SLUG);
  } catch (err) {
    if (err instanceof MunshiError && err.status === 404) notFound();
    throw err;
  }
});

type Page<T> = { data: T[]; next: string | null };
// Every page of a cursor list, at most `pages` of 100: a shop's menu or catalogue fits well inside.
async function all<T>(read: (q: { limit: number; cursor?: string }) => Promise<Page<T>>, pages = 10): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const page = await read(cursor ? { limit: 100, cursor } : { limit: 100 });
    out.push(...page.data);
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

export const has = (site: Site, capability: string) => site.capabilities.includes(capability);

export const getCatalogue = cache(() => all((q) => client().catalogue(SLUG, q)));
export const getServices = cache(() => all((q) => client().services(SLUG, q)));
export const getPackages = cache(() => all((q) => client().packages(SLUG, q)));
export const getOffers = cache(() => all((q) => client().offers(SLUG, q)));
export const getStylists = cache(() => all((q) => client().stylists(SLUG, q)));

/** An order's status by its code; null when the API knows no such order (a bad code is the same 404). */
export async function getOrderStatus(code: string) {
  try {
    return await client().orderStatus(SLUG, code);
  } catch (err) {
    if (err instanceof MunshiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}
