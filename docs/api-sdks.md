# SDKs and a docs portal for Munshi's API, with APIMatic

Munshi's public API (`/api/v1`) is described once, as zod schemas in `packages/contracts`. `pnpm contracts` turns them
into the OpenAPI 3.1 document [`packages/contracts/openapi.json`](../packages/contracts/openapi.json) and into the types
of the repository's own dependency-free TypeScript client, `packages/sdk`. [APIMatic](https://www.apimatic.io) takes the
same document and generates SDKs in TypeScript and Python, and a documentation portal with an API reference, a
playground and a getting-started page for each SDK. Nothing is written by hand twice: change a schema, run
`pnpm contracts`, and run the commands below again.

The API serves only what a shop's owner published, and nothing sent to it changes the books until a person at the shop
approves it. Every figure carries its ref, the ledger row it came from. A generated SDK changes none of that: it calls
the same routes.

## The layout

```
apimatic/
  run.ts                      runs the CLI (below)
  src/
    apimatic.json             the portal's title and links, and the SDK languages and package names
    spec/
      APIMATIC-META.json      the API's base URL and the SDKs' project name
      openapi.json            written from packages/contracts on every run; not in git
```

- **Base URL.** The OpenAPI document names its server relatively (`/api/v1`), because the API is served on the same
  origin as the shop sites that call it. An SDK needs an absolute address, so `APIMATIC-META.json` sets
  `https://munshi-sable.vercel.app/api/v1` as the production server, without changing the document.
- **Names.** The SDKs' project name is `Munshi` (`APIMATIC-META.json`), the package name `munshi-api-sdk` on npm and
  on PyPI is set in `apimatic.json` (the name the portal's SDK pages install), and the portal is titled "Munshi API".
  None clashes with the workspace's own `@munshi/sdk`.
- **Authentication.** Public reads need no key, and a site's writes send its publishable key (`mpk_…`) as a bearer
  token.
- **Only what is built.** The document also specifies two secret-key reads (`/findings`, `/drafts`) that are marked
  `x-munshi-deferred`: specified, not built. The scripts leave them, and their `secretKey` scheme, out of what APIMatic
  sees, so no SDK offers a call the API does not answer.

## The commands

| Command | What it does | Output (not in git) |
|---|---|---|
| `pnpm apimatic:validate` | Validates the document and its metadata against APIMatic's rules | Printed |
| `pnpm apimatic:sdk` | Generates the TypeScript SDK, then the Python SDK | `apimatic/sdk/typescript`, `apimatic/sdk/python` |
| `pnpm apimatic:portal` | Builds the static documentation portal | `apimatic/portal` |

Each command writes the current `openapi.json` into `apimatic/src/spec`, then runs APIMatic's CLI (`@apimatic/cli`
2.2.0, pinned and run through `pnpm dlx`, so its dependencies stay out of the workspace). It exits with the CLI's own
status.

- `apimatic:validate` runs `api validate` and prints APIMatic's findings on the document. Fix what it reports in
  `packages/contracts` (the zod schemas or `src/openapi.ts`), never in the generated `openapi.json`, then run
  `pnpm contracts`.
- `apimatic:sdk` runs `sdk generate` twice, `--language=typescript` then `--language=python`, each with `--force`, into
  `apimatic/sdk/<language>`: a typed client for every built operation, against the production base URL above.
- `apimatic:portal` runs `portal generate --force` into `apimatic/portal`: static files for the API reference, the
  playground and a getting-started page per SDK, ready for any static host.

To preview the portal with live reload instead, run any of the three once (it writes `src/spec/openapi.json`), then
`pnpm dlx @apimatic/cli@2.2.0 portal serve --input=apimatic --auth-key=<key>`.

## The key

Every APIMatic command runs on APIMatic's servers, validation included, so each one needs an APIMatic account's key in
`APIMATIC_API_KEY` (in the environment, or in `.env`). Unset, the scripts stop before calling anything:

```
$ pnpm apimatic:validate
apimatic: APIMATIC_API_KEY is not set. Every APIMatic command, validation included, runs on APIMatic's servers and needs it.
```

With a key APIMatic does not accept, the CLI itself refuses, and the script exits 1:

```
$ pnpm apimatic:validate
apimatic: api validate
┌   Validate API
│
■  Authorization has been denied for this request. Please run apimatic auth login to log in via browser, or apimatic auth login --auth-key={api-key} to log in with an auth key.
│
└  Failed
```

To get a key:

1. Create an APIMatic account at [apimatic.io](https://www.apimatic.io). The
   [APIMatic page](https://paypalaihackathon.devpost.com/details/apimatic) of PayPal's AI hackathon offers a free
   subscription, through its form, to participants who used APIMatic's Context Plugin for PayPal to build their PayPal
   integration.
2. In APIMatic's dashboard: **Settings**, **Account Settings**, **API Authentication**. Name a key, **Add**, and copy it.
3. Put it in `.env` as `APIMATIC_API_KEY=…`. The web app never reads it, and the scripts never print it. They pass it to
   the CLI as an argument, so another user on the same machine could see it in the process list while a command runs.

The scripts don't use the CLI's stored login (`apimatic auth login`); they always pass the key.

## Publishing

- **SDKs.** `apimatic sdk publish` (to npm, PyPI and GitHub) needs a publishing profile in APIMatic's Publishing
  Center.
- **A context plugin for Munshi's API.** `apimatic plugin generate` builds a plugin that teaches AI coding assistants
  to use the SDKs; it reads the SDKs' published GitHub sources, so it follows publishing.
