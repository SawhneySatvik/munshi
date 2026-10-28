import type { NextConfig } from "next";

// One business per build (docs/MERCHANTS-DESIGN.md §5.6): the alias below is the only way a business reaches the bundle,
// so a build holds one business's profile, copy, fonts and art. No default: a missing slug must not build someone else.
const SLUGS = ["elite", "suit-shop"];
const site = process.env.MUNSHI_SITE ?? "";
if (!SLUGS.includes(site)) throw new Error(`MUNSHI_SITE must be one of ${SLUGS.join(", ")} (got "${site}")`);

const nextConfig: NextConfig = {
  // Each business builds into its own folder, so both can build and run side by side.
  distDir: `.next/${site}`,
  turbopack: { resolveAlias: { "@business": `./businesses/${site}/index.ts` } },
  cacheComponents: false,
  agentRules: false,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
