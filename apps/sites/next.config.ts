import type { NextConfig } from "next";

// One business per build: the alias below is the only way a business reaches the bundle, so a
// build holds one business's profile, copy and art (checked by test/bundle.test.ts). No default: a missing slug must
// not build someone else. Its figures come only from the API (@munshi/sdk) at request time.
const SLUGS = ["elite", "prabhave"];
const site = process.env.MUNSHI_SITE ?? "";
if (!SLUGS.includes(site)) throw new Error(`MUNSHI_SITE must be one of ${SLUGS.join(", ")} (got "${site}")`);

const nextConfig: NextConfig = {
  // Each business builds into its own folder, so both can build and run side by side.
  distDir: process.env.MUNSHI_SITES_DIST ?? `.next/${site}`,
  basePath: process.env.MUNSHI_SITES_BASE_PATH ?? "",
  turbopack: { resolveAlias: { "@business": `./businesses/${site}/index.ts` } },
  cacheComponents: false,
  agentRules: false,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
