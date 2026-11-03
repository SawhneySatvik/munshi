# apps/prabhave

Prabhave's website (a synthetic boutique), served at `/s/prabhave`. A thin Next.js 16 app over the shared site code in
[`apps/sites`](../sites/README.md): every route under [`app/`](app) re-exports the shared page at the same path, and
[`proxy.ts`](proxy.ts) re-exports the shared proxy.

[`next.config.ts`](next.config.ts) fixes the business: `@business` resolves to `apps/sites/businesses/prabhave` alone,
the base path is `/s/prabhave`, and the build goes to `.next`. Nothing comes from the environment at build time.
Deployed, this app is the `prabhave` service of the one Vercel project ([`vercel.json`](../../vercel.json)); its server
reads the API at the `WEB_URL` its binding gives it.

```bash
pnpm --filter @munshi/prabhave build
```

`pnpm dev` at the repository root runs it at http://localhost:3151/s/prabhave. Its tests live with the shared code:
`pnpm --filter @munshi/sites test`.
