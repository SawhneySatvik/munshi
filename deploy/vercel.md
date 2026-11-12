# Vercel deployment: one project, three services

Munshi deploys as one Vercel project, `munshi`, in Mumbai (`bom1`), with three
[services](https://vercel.com/docs/services) on one domain:

| Service | Root | Builds | Public path |
|---|---|---|---|
| `web` | `apps/web` | the owner app, counter, demo, API v1 and the superadmin console | everything not below |
| `elite` | `apps/elite` | Elite's public site | `/s/elite` and under it |
| `prabhave` | `apps/prabhave` | Prabhave's public site | `/s/prabhave` and under it |

The commands, in order, are in [docs/deployment.md, "Deploy, step by step"](../docs/deployment.md#deploy-step-by-step).
This page holds the settings and what was learned getting here. The services layout is held by
`db/test/v2/deploy/vercel.test.ts`; after a deploy, run the checks in "Checking a deployment" below.

## The files

- `vercel.json` at the repository root defines the services. Each has its `root`, framework Next.js, a filtered install
  (`cd ../.. && pnpm install --frozen-lockfile --filter @munshi/<app>...`: the app and its workspace packages only, so
  the embedded PostgreSQL development packages stay off the build machine) and `pnpm build`. Each site service has one
  binding, `{ "type": "service", "service": "web", "format": "url", "env": "WEB_URL" }`. The top level holds only
  routing, the region and the cron: services mode does not accept `framework`, `installCommand`, `buildCommand`,
  `outputDirectory` or `functions` there.
  - Rewrites, most specific first: `/s/elite` and `/s/elite/(.*)` to `elite`, the same for `prabhave`, then `/(.*)` to
    `web`. A service receives the original path, so each site app builds under its base path (`/s/elite`,
    `/s/prabhave`), set in its `next.config.ts`.
  - `regions: ["bom1"]` and the one daily cron, `41 0 * * *` UTC (06:11 IST) on `/api/internal/tick`, stay at the top
    level, for the whole project. The cron's path reaches `web` through the catch-all.
- `apps/elite` and `apps/prabhave`: two thin Next.js apps over the shared site code in `apps/sites`. Each fixes its
  business in its `next.config.ts` (`@business` resolves to that business's folder only; nothing comes from the
  environment at build time), builds under its base path, and builds into its own `.next`.
- No `vercel.json` inside an app: the three-project files (`apps/web/vercel.json`, `apps/sites/vercel.json`) are gone,
  since a service's build settings live in its entry in the root file.
- `.vercelignore` at the root. The CLI does not read `.gitignore`, so without this file it would upload `.env`,
  `.env.production`, `.run` (the local database and the operator's sign-in file) and local notes. Only `vercel.json`,
  `apps`, `packages`, `db`, `deploy` and the workspace's root files go up.

No file carries an environment value (`db/test/v2/deploy/vercel.test.ts`). None of the three builds needs a value from
`.env`, and none needs `WEB_URL`: on 4 Nov each was built locally from only the files `.vercelignore` uploads, after
its own filtered install, with only `CI`, `VERCEL` and `VERCEL_ENV` set. The web build reads `db/schema` (`../../db`)
to compile in the schema's sha256; with the project's Root Directory at the repository root, that folder is part of
the upload.

## How the sites reach the API

- **Server:** a site's functions read `/api/v1` at `WEB_URL`, the web service's address that the binding injects at
  request time. Bindings are not available during a build or in the proxy, and nothing there calls the API (every page
  is rendered on request). Locally, `MUNSHI_API_URL` names the app instead (`apps/sites/lib/api-base.ts`). A call over
  the binding skips the public pipeline (firewall, Deployment Protection).
- **Browser:** the sites share the web app's domain, so the browser calls `/api/v1` on the page's own origin; no CORS
  is involved. `MUNSHI_PUBLIC_API_URL` overrides it (local dev, where each site runs on its own port).
- **Origins and keys:** a browser write (a booking request, a hold, an order) sends the page's Origin, which the API
  checks against the site's list, and the site's publishable key. Both sites therefore list the same origin, the
  project's production domain (`db/src/site-origins.ts` with that domain for both). A same-origin read sends no Origin
  and passes. A preview deployment's own URL is not listed, so on a preview the pages render but browser writes are
  refused.
- **One origin for the shop sites and the owner app.** The owner's session cookie (httpOnly, path `/`) is sent with
  requests to `/s/<slug>` too; the site code never reads it, and the SDK sends no credentials. But a script that ran on
  a site page would run with the owner app's origin, so the sites must never render raw HTML (none does today: every
  value is rendered as text). The sites send no Content-Security-Policy of their own yet. Routing each site by host
  instead (`elite.<domain>`, a `has: host` rewrite in the same project) would give each its own origin; that is the
  founder's call.

## What the earlier layouts taught

Five CLI previews of the first services layout failed, in this order:

1. TypeScript checking failed because the web app's test helpers were in the remote build. Fixed.
2. The `pg` types needed by the schema reader that `apps/web/next.config.ts` imports were missing from the filtered
   install. Fixed. Both fixes still apply.
3. All three builds succeeded, but both site services were rooted at `apps/sites`, so both builds wrote `.next` in the
   same folder and replaced each other's chunks while packaging.
4. With a folder per business (`.next/elite`), Vercel packaged only `.next` and refused the build for a missing
   `routes-manifest.json`.
5. Staging each output as `.next` still failed: Vercel looked for a chunk in `.next-prabhave` after the build had moved
   it.

The three-project layout came next. The services layout now returns with each site its own app
and folder, so each service's build writes only its own `.next`, the folder Vercel packages
(`db/test/v2/deploy/vercel.test.ts` refuses two services with one root).

Also learned: the CLI marked deployments `production` even when given `--target=preview`, so treat every CLI deploy of
this project as production. Vercel uses the pnpm version pinned in the root `package.json` only with
`ENABLE_EXPERIMENTAL_COREPACK=1`.

## Production environment names

Values belong in the project's settings, set by `deploy/vercel-env.ts` or by hand. They never go in `vercel.json` or a
source file. A project's variables reach every service, so there is one list (VERCEL-ENV1, VERCEL-ENV2,
`db/test/v2/deploy/vercel-env.test.ts`); the script takes `--project=munshi` only and refuses a checkout linked to
another project.

| Name | Purpose | Set by |
|---|---|---|
| `DATABASE_URL`, `PUBLIC_DATABASE_URL`, `JOBS_DATABASE_URL`, `AGENT_DATABASE_URL`, `IDP_DATABASE_URL`, `PLATFORM_DATABASE_URL` | Role-specific transaction-pool URLs written by `db/src/supabase-roles.ts` | vercel-env, from `.env.production` |
| `MUNSHI_DB_CA` | Supabase's TLS root, base64 | vercel-env, from `.env.production` |
| `MUNSHI_DEPLOYMENT` | `demo` for the hosted demo | vercel-env, from `.env.production` |
| `MUNSHI_SESSION_SECRET`, `MUNSHI_IDENTITY_SECRET`, `MUNSHI_RATE_SECRET`, `CRON_SECRET` | Session, sign-in and rate keys; the daily tick's bearer | vercel-env, from `.env.production` |
| `MUNSHI_PLATFORM_SECRET` | The superadmin console's key (below) | vercel-env, only with `--with-console` |
| `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `SARVAM_API_KEY`, `META_MODEL_API_KEY`, `BASETEN_API_KEY` | Model keys, each optional; those set in `.env` are sent. A missing key falls back to an allowed alias whose key is set | vercel-env, from `.env` |
| `MUNSHI_DEMO_TENANT_ID` | The demo sign-in's sample shop, printed by the seed | vercel-env `--set` |
| `MUNSHI_MODEL_MODE` | `live` on the hosted demo (Meta's models first, Gemini as the fallback); `recorded` replays fixtures | vercel-env `--set` |
| `MUNSHI_APP_URL` | The project's public https origin; required with the `SUPABASE_*` names | vercel-env `--set` |
| `MUNSHI_SEND_MODE`, `MUNSHI_AI` | Sends stay recorded unless `live`; `MUNSHI_AI=off` stops every model call | vercel-env `--set` |
| `MUNSHI_SITE_KEY_ELITE`, `MUNSHI_SITE_KEY_PRABHAVE` | Each site's publishable key, for the browser's writes; public by design. The script refuses a key under the other business's name | vercel-env `--set`, from `.run/hosted-site-keys.json` |
| `NEXT_PUBLIC_MUNSHI_SITE_SAMPLE` | `1` labels both sites as samples on every page (`apps/sites/lib/variant.ts`); read at build time. Leave it unset: the sites present as the shops' own | vercel-env `--set` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Real shops' verified-email sign-up (`deploy/supabase.md`, step 8): both or neither, and then `MUNSHI_APP_URL` | by hand |
| `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | The private bucket for uploaded pictures (step 9). The bucket needs `SUPABASE_URL` and the key, so turning it on also turns on step 8's sign-up | by hand |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | vercel-env |

`WEB_URL` is not set by anyone: the binding injects it into the site services. The three-project names are gone:
`MUNSHI_SITE` (each site app fixes its business), `MUNSHI_API_URL` and `MUNSHI_PUBLIC_API_URL` (the binding, and the
page's own origin), and the one-key `MUNSHI_SITE_KEY` (both sites would read it). `vercel-env.ts` refuses all of them
through `--set`.

Because variables are project-wide, the site services' functions now hold the database URLs, secrets and model keys in
their environment, which a site project of the three-project layout never did. The site code never reads them: the
sites import only the SDK (the closure gate, `apps/sites/test/closure.test.ts`), and their only door to the books is
the public API. Where Vercel lets a variable be scoped to one service, scope the database URLs, secrets and model
keys to `web`.

For the project, `vercel-env.ts` refuses `WHATSAPP_*`, `INSTAGRAM_*`, `MUNSHI_PHONE_ROUTE_SECRET` and `SUPABASE_*`, and
never sends `MIGRATOR_DATABASE_URL` or `ADMIN_DATABASE_URL`. Those stay on the operator's machine.

Channels (WhatsApp, Instagram): a real send needs all of `MUNSHI_SEND_MODE=live`, the channel's credentials, a real shop
the operator has accepted, that shop's approved channel grant, and a listed recipient, rechecked at send. A sample shop
never sends; anything else is recorded. Set channel names by hand on `munshi`, and only once the operator holds the
channel accounts. The deployment-wide AI ceiling is separate from provider billing: the operator still sets a spend
limit in each provider's console before live use.

## The superadmin console (on the hosted deployment, unlinked)

`/platform` is the platform operators' console: they accept real shops, grant channels and approve the platform's
settings there. The hosted deployment runs it on the same site as the app, behind a password and TOTP, and nothing on
the site links to it; the console links back to the
site (its nav has "Munshi home" and "The app"). It runs only where the deployment holds both `PLATFORM_DATABASE_URL`
and `MUNSHI_PLATFORM_SECRET`; with either unset every `/platform` page, the sign-in page included, is 404.
`PLATFORM_DATABASE_URL` is always set (boot requires every pool's URL), so the key alone decides, and it reaches
Vercel only through the explicit flag:

- **The hosted deployment (the demo):** `node deploy/vercel-env.ts --project=munshi --cwd=<checkout linked to munshi>
  --with-console`, then redeploy. It sends `MUNSHI_PLATFORM_SECRET` from `.env.production`, which must be the value
  the hosted seed sealed the operators' TOTP secrets under; any other key opens none of them, and every sign-in fails
  with the one same line. The console's sign-in is the password identity's, so the deployment also needs
  `MUNSHI_IDENTITY_SECRET` (the seed's), `MUNSHI_RATE_SECRET`, `IDP_DATABASE_URL` and `PUBLIC_DATABASE_URL` (the
  script sends them from `.env.production`, and refuses `--with-console` when the console key, the identity secret or
  the rate secret is missing there).
- **Live:** the console is part of every live deployment, since real shops are accepted there: boot refuses a live
  config without the key (`config_missing`, 503), and `vercel-env.ts` refuses a live `.env.production` without `--with-console`.
- **A deployment without it** (a preview, or if the operator turns it off): run `vercel-env.ts` without the flag; it
  never sends the key. If the key was set before, remove it by hand (`vercel env rm MUNSHI_PLATFORM_SECRET production
  --project munshi`, then redeploy): the script sets values, it does not delete them. Operators then use the console on
  a laptop against the hosted database, or the platform CLI (`deploy/supabase.md`, step 6).

Unlinked and unindexed: no page, layout, nav, footer, sitemap or manifest of the product site, `/app`, `/demo`,
`/developers` or the shop sites names `/platform` (UNLINKED1, `apps/web/test/unlinked.test.ts`); every `/platform`
response carries `X-Robots-Tag: noindex, nofollow` from the request hook (ROBOTS1, `db/test/v2/core/boot/robots.test.ts`).
`robots.txt` does not list it, since that would advertise it. Unlinked is not hidden: anyone who guesses the path
reaches the sign-in page.

What enabling it exposes: one public page, `/platform/sign-in` (not indexed), which asks for an operator's email,
password and a code from the authenticator app; a wrong answer of any kind reads the same one line. What limits
guessing: every attempt counts against the per-IP sign-in limit (10 in 10 minutes, `packages/core/src/logins.ts`), and
wrong passwords also count against the identity adapter's lockout of that email from that IP (every fifth failure
locks it). Wrong codes count nowhere else: once someone knows an operator's password, guesses at the six-digit code are
limited only by the per-IP limit, so a guesser with many IPs gets that many tries. There is no per-operator failure
counter yet (queued for the schema, not built). A code counts once, and only three 30-second steps are open at a time.
Every other `/platform` page answers 404 to anyone without a live
operator session, a member's session included. A session is its own cookie (`munshi_operator`, path `/platform`,
2 hours, signed), ended by sign-out or a password reset. Nothing in the console applies on its own: every setting is a
proposal that a later request approves, and adding an operator is approved only by the CLI.

FACT (offline): the robots tag and the absence of links (ROBOTS1, UNLINKED1, above); the key's live requirement (`CONFIG1 the console’s platform key is optional on demo, required on live,
…`, `packages/config/test/config.test.ts`); the flag (`VERCEL-ENV1`, `db/test/v2/deploy/vercel-env.test.ts`); the 404s
and the sign-in (`CONSOLE1`, `apps/web/test/console.test.tsx`).


## Vercel settings

- One project, `munshi`. Its Root Directory is the repository root (empty), where `vercel.json` defines the services;
  Vercel builds each service from its own `root`. A project created for the three-project layout with Root Directory
  `apps/web` must have it cleared (Settings, Build and Deployment, Root Directory). Node.js 22.x. On import, check that the
  dashboard lists the three services from `vercel.json`.
- The CLI deploy and `.vercelignore`: deploy from the repository root of a clean clone of the exact commit. A clean
  clone holds no `.env`, `.env.production` or `.run`, and `.vercelignore` is the second fence. Check the upload's file
  count in the first deploy's output.
- After `vercel link`, remove any `.env.local` it wrote, without reading it. `.vercel/project.json` holds only linkage
  metadata (the project and team ids and the project's name), which `vercel-env.ts` checks.
- The daily cron is the project's, on the web app's route. Hobby runs a cron at most once a day.
- Crawlers: each site's `robots.txt` is served at `/s/<slug>/robots.txt`, where crawlers do not look; the domain's
  `/robots.txt` is the web app's (it has none today, so nothing is disallowed). The sites' pages carry their own robots
  meta tag.

## Checking a deployment

1. The project imports with its three services detected from `vercel.json`, and each service's install and build run
   from its own root and pass.
2. Packaging: each service's `.next` is packaged on its own (the earlier previews' failure).
3. Routing: `/s/elite`, `/s/elite/hi`, `/s/elite/_next/static/…` reach `elite`; the same for `prabhave`; `/`, `/app`,
   `/api/v1/…` reach `web`.
4. The binding: a site page renders its figures, so its server read the API at `WEB_URL`. Watch the API's per-IP read
   limit (120 a minute): calls over the binding may arrive without the visitor's address, so every site render could
   share one bucket. If they do, site pages start answering errors under load.
5. Browser writes on production: a booking request on `/s/elite/book` and a hold on a Prabhave piece are accepted once
   both sites list the production domain and the keys are set. On a preview they are refused (its URL is not listed).
6. The region (`bom1`) for all three services' functions, and the cron's run through the rewrites (a 200 in the Cron
   Jobs tab).
7. Variables scoped to `web` where Vercel allows it (above).
