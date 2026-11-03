# apps/web

The Munshi web app (Next.js 16, React 19): the owner app, the product site, the demo sign-in, the superadmin console,
the public API, webhooks and the jobs tick, in one server process.

## Entry points

| Path | What |
|---|---|
| [`proxy.ts`](proxy.ts) | The request hook: request id, per-request CSP with a nonce, `noindex` on `/platform`, and a 503 until boot passes |
| [`app/app`](app/app) | The owner app (`/app`): home, office, Ask, counter, stock, bills, credit, settlements, reports and the rest |
| [`app/(site)`](app/(site)) | The product site, sign-up and the developer docs (`/developers`) |
| [`app/demo`](app/demo) | The demo picker: sample shops, no password (404 on a live deployment) |
| [`app/platform`](app/platform) | The superadmin console; 404 unless configured |
| [`app/api/v1`](app/api/v1) | The public API for shop sites, through [`lib/api/pipeline.ts`](lib/api/pipeline.ts) |
| [`app/api/webhooks`](app/api/webhooks) | WhatsApp, Instagram and PayPal, signature-checked before parsing |
| [`app/api/internal/tick`](app/api/internal/tick/route.ts) | The jobs tick, behind `CRON_SECRET` |
| [`lib/server/session.ts`](lib/server/session.ts) | `sessionFrom()`: the one place a request becomes a core `Session` |
| [`lib/server/db.ts`](lib/server/db.ts) | The pools and the boot check (each pool its own role, no superuser, the schema this build expects) |
| [`lib/server/agent-port.ts`](lib/server/agent-port.ts) | The agent's port, bound to one shop and one run |
| [`lib/cast.ts`](lib/cast.ts) | The seven agent names over the database's desks |
| [`public/sw.js`](public/sw.js) | The service worker: app shell and a read-only offline view |

## Boundaries

- Screens and server actions hold no domain rules; they call [`packages/core`](../../packages/core) and
  [`packages/agent`](../../packages/agent).
- The person always comes from `sessionFrom()`, never from a form field. Direct commands go through
  [`lib/server/act.ts`](lib/server/act.ts), which requires the form's idempotency key.
- Every figure renders from a snapshot cell, with its source a tap away
  ([`components/SourceDrawer.tsx`](components/SourceDrawer.tsx), [`components/WhyChain.tsx`](components/WhyChain.tsx)).
- Screens with simulated parts or recorded answers say so ([`components/Sticker.tsx`](components/Sticker.tsx),
  [`components/Recorded.tsx`](components/Recorded.tsx)).
- Configuration comes only from [`packages/config`](../../packages/config) through
  [`lib/server/config.ts`](lib/server/config.ts).

## Running and testing

Run the whole stack from the repository root with `pnpm dev`, which builds and seeds a local database first. On its
own, `pnpm --filter @munshi/web dev` needs every setting boot requires.

```bash
pnpm --filter @munshi/web test        # screens and actions, rendered from a seeded embedded PostgreSQL 17
pnpm --filter @munshi/web typecheck
pnpm kit                              # rebuild the developer docs bundle (lib/kit.gen.json) from docs/kit
```

Tests render screens as the server builds them, from the demo kirana seeded into a fresh database per file; only the
framework's request boundary (cookies, redirects, revalidation) is stubbed. Model calls replay fixtures in
[`fixtures`](fixtures).
