import { randomBytes } from "node:crypto";
import type { NextConfig } from "next";
import { readSchema } from "../../db/src/schema-files.ts";

// One id per build: Next's own build id and the service worker's version (components/pwa/Pwa.tsx), compiled into the
// server bundles through `env`, so a deployment (Vercel's functions carry no .next/BUILD_ID) registers this build's worker.
const BUILD_ID = process.env.VERCEL_DEPLOYMENT_ID || `b${randomBytes(9).toString("base64url")}`;

const nextConfig: NextConfig = {
  // Off on purpose: cached shells can serve dynamic-id routes with placeholder ids until a reload.
  cacheComponents: false,
  partialPrefetching: false,
  // Off so `next dev` does not write a generated AGENTS.md into the source tree: no generated file lands beside the
  // app's own code.
  agentRules: false,
  poweredByHeader: false,
  env: { MUNSHI_BUILD_ID: BUILD_ID },
  generateBuildId: () => BUILD_ID,
  // The dev-tools badge sits over the docked voice bar on a phone; the app runs in dev for the demo.
  devIndicators: false,
  // Shelf and bill photos and voice recordings reach their server actions whole (lib/hero-types.ts's limits).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // The sha256 of the checked-out db/schema, written into the server bundles in place of the identifier
  // (packages/config's buildSchemaSha256): boot refuses a database built from other files, and since the value is
  // compiled in, no environment variable can stand in for it. Server only: it never reaches the browser.
  compiler: { defineServer: { MUNSHI_BUILD_SCHEMA_SHA256: readSchema().sha256 } },
  // The headers that do not vary by request, on every response. The CSP varies (a nonce per page), so
  // the request hook (proxy.ts) sets it: a second policy here would be enforced beside it.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
