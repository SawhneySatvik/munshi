import { existsSync } from "node:fs";
import type { NextConfig } from "next";
import { readSchema } from "../../db/src/schema-files.ts";

// The edition card links a screen only if its page exists (components/EditionSurfaces.tsx).
const editionRoutes = ["/app/settlements", "/app/teammate", "/app/growth"].filter((r) => existsSync(`${import.meta.dirname}/app${r}/page.tsx`));

const nextConfig: NextConfig = {
  // Off on purpose: in Munim, cached shells served dynamic-id routes with placeholder ids until a reload.
  cacheComponents: false,
  partialPrefetching: false,
  // `next dev` would otherwise write an AGENTS.md here; working rules live in CLAUDE.md.
  agentRules: false,
  poweredByHeader: false,
  env: { MUNSHI_EDITION_ROUTES: JSON.stringify(editionRoutes) },
  // The dev-tools badge sits over the docked voice bar on a phone; the app runs in dev for the demo.
  devIndicators: false,
  // Shelf and bill photos and voice recordings reach their server actions whole (lib/hero-types.ts's limits).
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // The sha256 of the checked-out db/schema, written into the server bundles in place of the identifier
  // (packages/config's buildSchemaSha256): boot refuses a database built from other files, and since the value is
  // compiled in, no environment variable can stand in for it. Server only: it never reaches the browser.
  compiler: { defineServer: { MUNSHI_BUILD_SCHEMA_SHA256: readSchema().sha256 } },
  // The headers that do not vary by request, on every response (BLUEPRINT §4.5). The CSP varies (a nonce per page), so
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
