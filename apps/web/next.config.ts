import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off on purpose: in Munim, cached shells served dynamic-id routes with placeholder ids until a reload.
  cacheComponents: false,
  partialPrefetching: false,
  // `next dev` would otherwise write an AGENTS.md here; working rules live in CLAUDE.md.
  agentRules: false,
  poweredByHeader: false,
  // The dev-tools badge sits over the docked voice bar on a phone; the app runs in dev for the demo.
  devIndicators: false,
};

export default nextConfig;
