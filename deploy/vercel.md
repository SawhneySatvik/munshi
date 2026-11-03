# Vercel deployment — one project with three services

The intended deployment is one Vercel project named `munshi`, in `bom1`, from the `paytm` production branch. Its root
`vercel.json` defines the web app and two public-site builds. All three services share the project's environment set.
The Vercel builder uses filtered pnpm 11 installs so the embedded PostgreSQL development packages stay off the build
machine. Set `ENABLE_EXPERIMENTAL_COREPACK=1` in the project settings.

## Services and routes

| Service | Root | Install | Build | Public route |
|---|---|---|---|---|
| `web` | `apps/web` | `pnpm install --frozen-lockfile --filter @munshi/web...` | `pnpm build` | catch-all after the site rewrites |
| `elite` | `apps/sites` | `pnpm install --frozen-lockfile --filter @munshi/sites...` | `MUNSHI_SITE=elite`, base path `/s/elite`, build `.next-elite`, stage as `.next` | `/s/elite` and descendants |
| `prabhave` | `apps/sites` | `pnpm install --frozen-lockfile --filter @munshi/sites...` | `MUNSHI_SITE=prabhave`, base path `/s/prabhave`, build `.next-prabhave`, stage as `.next` | `/s/prabhave` and descendants |

The rewrites for both sites come before `/(.*) → web`. `apps/sites/next.config.ts` compiles one business per service;
`lib/i18n.ts` prefixes internal links, Next prefixes generated assets, and `proxy.ts` keeps the English locale rewrite
inside the configured base path. A standalone site project can build either slug for local development.

`db/test/v2/deploy/vercel.test.ts` checks the root service map, route order, roots, filtered installs, one daily GET cron,
`bom1`, and the absence of environment values in the file. Vercel's service build and path behavior remain unverified
until the probe completes. See the result recorded below and the P9a report in `docs/HANDOFF-CLOUD.md`.

### Probe result

The first two CLI previews failed during TypeScript checking: first, the web app's test helpers were included in the
remote build; then `pg` types from the schema reader imported by `apps/web/next.config.ts` were missing from the filtered
install. Both causes are fixed. The third preview built the web app and both `apps/sites` services successfully, including
the shared root, but Vercel failed while packaging because both builds wrote to `.next` and replaced each other's chunks.
The fourth preview built both distinct directories, but Vercel only packages `.next` and rejected `.next/elite` with a
missing `routes-manifest.json`. The fifth clean-archive preview built all three services, but packaging still failed:
Vercel looked for a chunk in `.next-prabhave` after its build had staged that output as `.next`. The five deployment URLs
were previews only; none became production.

The next fallback is separate projects: `munshi` for `apps/web`, `munshi-elite` for `apps/sites` with
`MUNSHI_SITE=elite`, and `munshi-prabhave` for `apps/sites` with `MUNSHI_SITE=prabhave`. The temporary Elite project
builds locally with the filtered install, `ENABLE_EXPERIMENTAL_COREPACK=1`, and `MUNSHI_SITES_DIST=.next`. Its CLI
deployments were marked `production` even when `--target=preview` was supplied; those temporary deployments were
removed. No preview URL was verified. The prebuilt clean-checkout route remains the following fallback.

## Production environment names

Values belong in Vercel project settings or `deploy/vercel-env.ts`; never in `vercel.json` or source files. Preview stays
on recorded mode and uses demo-only credentials. The live deployment stays blocked until the approved demo defaults
and provider spend ceiling are in place.

| Name | Purpose |
|---|---|
| `DATABASE_URL`, `PUBLIC_DATABASE_URL`, `JOBS_DATABASE_URL`, `AGENT_DATABASE_URL`, `IDP_DATABASE_URL`, `PLATFORM_DATABASE_URL` | Role-specific transaction-pool URLs written by `db/src/supabase-roles.ts` |
| `MUNSHI_DEPLOYMENT` | `demo` for the Paytm demo |
| `MUNSHI_SESSION_SECRET`, `MUNSHI_RATE_SECRET` | Session and sample sign-up rate protection |
| `MUNSHI_DEMO_TENANT_ID` | The demo sign-in's sample tenant id, printed by `db/seed/hosted.ts` |
| `MUNSHI_IDENTITY_SECRET` | Real sign-in and sign-up (with `MUNSHI_RATE_SECRET`): required on live, optional on demo; unset, the demo offers sample shops only |
| `CRON_SECRET` | Authorization for the daily `/api/internal/tick` request |
| `MUNSHI_MODEL_MODE`, `MUNSHI_EDITION` | `recorded` until the hosted ceiling and approved defaults pass; edition `paytm` |
| | The edition for the Meta submission's hosted demo is the founder's open choice; `paytm` above is not that decision |
| `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `SARVAM_API_KEY`, `META_MODEL_API_KEY`, `BASETEN_API_KEY` | Model keys, each optional; `deploy/vercel-env.ts` sends those set in `.env`. A missing key falls back to an allowed alias whose key is set; Meta's keys wait on the founder |
| `MUNSHI_SITE_KEY_ELITE`, `MUNSHI_SITE_KEY_PRABHAVE` | Publishable keys for their respective public-site services |
| `MUNSHI_API_URL` | Munshi API origin used by the public sites |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `MUNSHI_APP_URL` | Real shops' verified-email sign-up, all three or none (`deploy/supabase.md` §8); set by hand, as `vercel-env.ts` refuses `SUPABASE_*`. Unset, the hosted site offers no real sign-up |
| `MUNSHI_SEND_MODE`, `MUNSHI_AI`, `MUNSHI_CACHE_URL` | Sends stay recorded unless `live`; cache may remain empty (in-memory) |

Channels (WhatsApp, Instagram): a real send needs all of `MUNSHI_SEND_MODE=live`, the channel's credentials, a real shop
the operator has accepted, that shop's approved channel grant, and a listed recipient, rechecked at send. A sample shop
never sends; anything else is recorded. `vercel-env.ts` refuses `WHATSAPP_*`, `INSTAGRAM_*` and
`MUNSHI_PHONE_ROUTE_SECRET`: set them by hand, and only once the founder has the channel accounts. Do not place
`MIGRATOR_DATABASE_URL`, `ADMIN_DATABASE_URL`, or `MUNSHI_PLATFORM_SECRET` in Vercel. The deployment-wide AI ceiling is
separate from provider billing; the founder still sets a spend limit in the provider console before live use.

## Vercel settings

- Production branch: `paytm`; function region: `bom1`; Node.js: 22.x.
- `ENABLE_EXPERIMENTAL_COREPACK=1` enables the package manager version pinned by the repo.
- If the Vercel GitHub app is unavailable, deploy a clean archive of the exact commit with
  `vercel deploy --archive=tgz` (preview) or `vercel deploy --archive=tgz --prod` (production after the hosted gate).
- After `vercel link`, locate `.vercel/project.json` and remove any `.env.local` unread. The project file contains only
  linkage metadata; it is not an environment-value source.
- One daily cron runs at `41 0 * * *` UTC (`06:11` IST) on `/api/internal/tick`.
