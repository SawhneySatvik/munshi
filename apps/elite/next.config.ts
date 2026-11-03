import type { NextConfig } from "next";

// Elite's site, one business fixed here. The pages, components and businesses are the shared site code (apps/sites);
// `@business` points at Elite's folder alone, the only way a business reaches this build (apps/sites/test/bundle.test.ts).
// The site is served at /s/elite on the web app's domain (the root vercel.json routes that path here), so every page and
// asset lives under that base path. Its figures come only from the API, at request time.
const SITE = "elite";
const BASE_PATH = `/s/${SITE}`;

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  // The site's plain links (lib/i18n.ts) add the base path themselves.
  env: { NEXT_PUBLIC_MUNSHI_SITES_BASE_PATH: BASE_PATH },
  // Only the bundle test builds elsewhere; a deploy builds into .next, the folder Vercel packages.
  distDir: process.env.MUNSHI_SITES_DIST ?? ".next",
  transpilePackages: ["@munshi/sites"],
  turbopack: { resolveAlias: { "@business": `../sites/businesses/${SITE}/index.ts` } },
  cacheComponents: false,
  agentRules: false,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
