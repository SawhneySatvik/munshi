# Vercel project settings for `apps/web`

Written offline. No `vercel` CLI was run and nothing was linked (Munim gotcha 39: `vercel link` writes a
`.env.local` with an OIDC token; if the founder links, check where `.vercel/project.json` landed and delete that
`.env.local` unread).

| Setting | Value |
|---|---|
| Project name (proposed) | `munshi-web` |
| Framework preset | Next.js |
| Root directory | `apps/web` (link from the repo root; pnpm keeps dependencies at the root) |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm --filter @munshi/web build` (or the default `next build`) |
| Node.js | 22.x |
| Function region | `bom1` (Mumbai) |
| Include files outside the root directory | on (the app imports `packages/*`) |

## Environment variables (Production)

`DATABASE_URL` (munshi_app, pooled), `AGENT_DATABASE_URL` (munshi_agent, pooled), `MUNSHI_MODEL_MODE`,
`MUNSHI_EDITION`, and only the provider keys the chosen edition needs (`META_MODEL_API_KEY`, `BASETEN_API_KEY`, ...). Add
them in the dashboard, never in a committed file. Do **not** add `MIGRATOR_DATABASE_URL` or `ADMIN_DATABASE_URL` to
Vercel: the app never migrates.

## Before the founder shares the URL (needs a decision)

- The demo sign-in has no password (`db/src/dev.ts` binds the dev server to localhost for that reason). A public
  Vercel URL exposes it. Decide: ship it as an explicit, labelled demo with synthetic data only, or put a gate in front.
- Every screen with simulated parts must say so (suppliers are simulated, data is synthetic, payments are recorded,
  never processed).
- Deploy from a clean checkout of a commit, not a working tree with other work in it (Munim gotcha 42), and use
  `vercel deploy --prebuilt --archive=tgz` (Munim gotcha 43).
