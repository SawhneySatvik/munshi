# Vercel deployment: three projects

Munshi deploys as three Vercel projects, all in Mumbai (`bom1`), each with its **Root Directory** set to its app:

| Project | Root Directory | Builds | Environment |
|---|---|---|---|
| `munshi` | `apps/web` | the owner app, counter, demo, API v1 and the superadmin console | the database, the secrets, the model keys |
| `munshi-elite` | `apps/sites` | Elite's public site | `MUNSHI_SITE=elite`, the API's origin, Elite's publishable key |
| `munshi-prabhave` | `apps/sites` | Prabhave's public site | `MUNSHI_SITE=prabhave`, the API's origin, Prabhave's publishable key |

The commands, in order, are in [docs/deployment.md, "Deploy, step by step"](../docs/deployment.md#deploy-step-by-step).
This page holds the settings and what was learned getting here.

## The files

- `apps/web/vercel.json`: Next.js, `bom1`, `pnpm install --frozen-lockfile --filter @munshi/web...` (the app and its
  workspace packages only, so the embedded PostgreSQL development packages stay off the build machine),
  `pnpm --filter @munshi/web build`, and the one daily cron: `41 0 * * *` UTC (06:11 IST) on `/api/internal/tick`.
- `apps/sites/vercel.json`: the same shape for `@munshi/sites`, built with `MUNSHI_SITES_DIST=.next` and no base path.
  Each site is its own origin, and `.next` is the only folder Vercel packages. One file serves both site projects: the
  business comes from the project's `MUNSHI_SITE`, which `apps/sites/next.config.ts` requires at build time. There is
  no default, so a missing slug cannot build another business's site.
- No `vercel.json` at the repository root. The one-project, three-services layout is retired (below).
- `.vercelignore` at the root. The CLI does not read `.gitignore`, so without this file it would upload `.env`,
  `.env.production`, `.run` (the local database and the operator's sign-in file) and local notes. Only `apps`,
  `packages`, `db`, `deploy` and the workspace's root files go up.

No file carries an environment value (VERCEL1, VERCEL2, `db/test/v2/deploy/vercel.test.ts`). None of the three builds
needs a value from `.env`. On 3 Nov each was built locally from only the files `.vercelignore` uploads, after its own
filtered install, with only `CI`, `VERCEL` and `VERCEL_ENV` set, plus `MUNSHI_SITE` for a site (a project setting, not a
secret). The web build reads `db/schema` (`../../db`) to compile in the schema's
sha256, so the web project must include files outside its Root Directory in the build. That is Vercel's default for a
new project, but it is UNVERIFIED on these projects: check Settings, Build and Deployment, Root Directory.

## What the one-project layout taught

Five CLI previews of one project with three services never reached production:

1. TypeScript checking failed because the web app's test helpers were in the remote build. Fixed.
2. The `pg` types needed by the schema reader that `apps/web/next.config.ts` imports were missing from the filtered
   install. Fixed. Both fixes still apply.
3. All three builds succeeded, but both `apps/sites` builds wrote `.next` in the same folder and replaced each other's
   chunks while packaging.
4. With a folder per business (`.next/elite`), Vercel packaged only `.next` and refused the build for a missing
   `routes-manifest.json`. That is why the sites' build command now sets `MUNSHI_SITES_DIST=.next`.
5. Staging each output as `.next` still failed: Vercel looked for a chunk in `.next-prabhave` after the build had moved
   it.

Also learned: the CLI marked deployments `production` even when given `--target=preview`, so treat every CLI deploy of
these projects as production. Vercel uses the pnpm version pinned in the root `package.json` only with
`ENABLE_EXPERIMENTAL_COREPACK=1`.

## Production environment names, per project

Values belong in the Vercel project settings, set by `deploy/vercel-env.ts` or by hand. They never go in a
`vercel.json` or a source file. `deploy/vercel-env.ts --project=<name>` sends each project only its own names
(VERCEL-ENV1, VERCEL-ENV2, `db/test/v2/deploy/vercel-env.test.ts`) and refuses a checkout linked to another project.

**`munshi` (apps/web)**

| Name | Purpose | Set by |
|---|---|---|
| `DATABASE_URL`, `PUBLIC_DATABASE_URL`, `JOBS_DATABASE_URL`, `AGENT_DATABASE_URL`, `IDP_DATABASE_URL`, `PLATFORM_DATABASE_URL` | Role-specific transaction-pool URLs written by `db/src/supabase-roles.ts` | vercel-env, from `.env.production` |
| `MUNSHI_DB_CA` | Supabase's TLS root, base64 | vercel-env, from `.env.production` |
| `MUNSHI_DEPLOYMENT` | `demo` for the hosted demo | vercel-env, from `.env.production` |
| `MUNSHI_SESSION_SECRET`, `MUNSHI_IDENTITY_SECRET`, `MUNSHI_RATE_SECRET`, `CRON_SECRET` | Session, sign-in and rate keys; the daily tick's bearer | vercel-env, from `.env.production` |
| `MUNSHI_PLATFORM_SECRET` | The superadmin console's key (below) | vercel-env, only with `--with-console` |
| `GEMINI_API_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`, `SARVAM_API_KEY`, `META_MODEL_API_KEY`, `BASETEN_API_KEY` | Model keys, each optional; those set in `.env` are sent. A missing key falls back to an allowed alias whose key is set | vercel-env, from `.env` |
| `MUNSHI_DEMO_TENANT_ID` | The demo sign-in's sample shop, printed by the seed | vercel-env `--set` |
| `MUNSHI_MODEL_MODE` | `recorded` until the hosted ceiling and approved defaults pass | vercel-env `--set` |
| `MUNSHI_APP_URL` | The app's public https origin; required with the `SUPABASE_*` names | vercel-env `--set` |
| `MUNSHI_SEND_MODE`, `MUNSHI_AI` | Sends stay recorded unless `live`; `MUNSHI_AI=off` stops every model call | vercel-env `--set` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Real shops' verified-email sign-up (`deploy/supabase.md`, step 8): both or neither, and then `MUNSHI_APP_URL` | by hand |
| `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | The private bucket for uploaded pictures (step 9). The bucket needs `SUPABASE_URL` and the key, so turning it on also turns on step 8's sign-up | by hand |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | vercel-env |

**`munshi-elite` and `munshi-prabhave` (apps/sites)**

| Name | Purpose | Set by |
|---|---|---|
| `MUNSHI_SITE` | `elite` or `prabhave`, fixed by the project | vercel-env |
| `MUNSHI_API_URL` | The `munshi` project's https origin, where the site's server reads `/api/v1` (required) | vercel-env `--set` |
| `MUNSHI_PUBLIC_API_URL` | The same origin as the browser sees it; unset means `MUNSHI_API_URL` | vercel-env `--set` |
| `MUNSHI_SITE_KEY_ELITE` or `MUNSHI_SITE_KEY_PRABHAVE` | That business's publishable key, for the browser's writes (booking requests, holds) | vercel-env `--set` |
| `NEXT_PUBLIC_MUNSHI_SITE_SAMPLE` | `1` labels the site as a sample on every page (`apps/sites/lib/variant.ts`); read at build time | vercel-env `--set` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | vercel-env |

A site gets no database URL, secret or model key. For every project, `vercel-env.ts` refuses `WHATSAPP_*`,
`INSTAGRAM_*`, `MUNSHI_PHONE_ROUTE_SECRET` and `SUPABASE_*`, and never sends `MIGRATOR_DATABASE_URL` or
`ADMIN_DATABASE_URL`. Those stay on the operator's machine.

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
and the sign-in (`CONSOLE1`, `apps/web/test/console.test.tsx`). UNVERIFIED: a deployed console on Vercel.

## Vercel settings

- Each project: the Root Directory in the table at the top, framework Next.js, Node.js 22.x. The function region comes
  from each app's `vercel.json` (`bom1`).
- Deploy from the repository root of a clean clone of the exact commit (`vercel deploy --prod`); the project's Root
  Directory picks the app. A clean clone holds no `.env`, `.env.production` or `.run`, and `.vercelignore` is the
  second fence. Whether the CLI reads `.vercelignore` from the repository root when a Root Directory is set is
  UNVERIFIED: check the upload's file count in the first deploy's output.
- After `vercel link`, remove any `.env.local` it wrote, without reading it. `.vercel/project.json` holds only linkage
  metadata (the project and team ids and the project's name), which `vercel-env.ts` checks.
- The daily cron belongs to the web project alone. Hobby runs a cron at most once a day.
