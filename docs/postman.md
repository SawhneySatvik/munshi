# Munshi in Postman

One collection covers what Munshi exposes and what it calls: the read-only integration feed, every operation of public
API v1, and the PayPal sandbox calls Munshi's adapter makes. It is in [`integrations/postman`](../integrations/postman),
with two environments.

| File | What it is |
|---|---|
| `munshi.postman_collection.json` | The collection (Postman Collection v2.1), built by `build.ts`. Do not edit it by hand |
| `munshi-hosted.postman_environment.json` | `https://munshi-sable.vercel.app`, shop `sharma-general-store`, site `elite` |
| `munshi-local.postman_environment.json` | `http://localhost:3000` (`pnpm dev`), the same shop and site |
| `build.ts` | Writes the collection from [`packages/contracts/openapi.json`](../packages/contracts/openapi.json) |
| `run.ts` | Runs folders of it with newman |
| `coverage.test.ts` | Checks the collection is current and covers every operation |

Secret variables (`integrationSecret`, `publishableKey`, `secretKey`, `paypalClientId`, `paypalClientSecret`) are empty in
both environments. Fill them in Postman's current-value column, or let `run.ts` take them from your shell.

## The folders

### Integration feed

`GET /api/integrations/v1/feed?shop={{shop}}` with `Bearer {{integrationSecret}}`, and the same call with a wrong key.
The tests check what [docs/zapier.md](zapier.md) describes: the answer is never cached, the shop carries its sample
label, each link's id is its link and its state, each state is the app's own, and every amount names its source (a
snapshot ref, or the stored PayPal notification). A wrong key gets a bare `404` with an empty body.

The feed is read only and held to it by the database. The route admits only `MUNSHI_INTEGRATION_SECRET`, and serves
sample shops only. See [docs/zapier.md](zapier.md#how-it-keeps-the-one-guarantee).

### Public API v1

One request per operation in `openapi.json`, in three folders:

- **Public reads** (no key). Run in order, each saves what the next needs: the site's first shop, its first service
  and the stored cell behind that service's price. So `GET /refs/{snapshot}/{row}/{col}` reads back the exact cell a
  price came from. Each request checks that its status is one the contract documents and that it carries a request id.
  The listing reads must answer `200`.
- **Site writes** (a site's publishable key). Holds, orders, enquiries, bookings and reservations. Each makes a request
  that a person then decides in Munshi. Their bodies are small examples built from the contract's schemas. Run them
  against local only: `run.ts` refuses them on the hosted environment.
- **Owner (deferred)**. `GET /drafts`, `POST /drafts` and `GET /findings` are specified and not built, so they answer
  `404` today.

### PayPal sandbox

The calls in [`packages/adapters/payments/paypal.ts`](../packages/adapters/payments/paypal.ts), in its order, against
`https://api-m.sandbox.paypal.com` only:

1. `POST /v1/oauth2/token`: client credentials. The test saves the token.
2. `POST /v2/invoicing/search-invoices`: the adapter's invoice number (`MS-` and the request id's first 20 hex digits),
   which a fresh run does not find.
3. `POST /v2/invoicing/invoices`: a draft invoice for `{{paypalValue}}` in `{{paypalCurrency}}` (USD by default, as a US
   sandbox merchant needs), with `PayPal-Request-Id`.
4. `POST /v2/invoicing/invoices/{id}/send`: `send_to_recipient: false`, `PayPal-Request-Id: <id>-send`. The test saves
   the payer link.
5. `GET /v2/invoicing/invoices/{id}`: waiting to be paid, for the amount asked.
6. `POST /v2/invoicing/invoices/{id}/cancel`: closes it, so a run leaves nothing open.

It is test money on PayPal's sandbox. Nothing here touches Munshi's books: in Munshi a link is made only after a
person approves it, and a payment is recorded only after a person approves that.

## Running it

```
pnpm postman:build          # write the collection from openapi.json
pnpm postman:check          # POSTMAN1: current, and every operation covered; POSTMAN2: no secret in the files
pnpm postman:test           # the public reads, against the hosted deployment
pnpm postman:test -- --env=local --folder="Site writes"
MUNSHI_INTEGRATION_SECRET=... pnpm postman:test -- --folder="Integration feed"
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... pnpm postman:test -- --folder="PayPal sandbox"
```

`run.ts` reads secrets only from your shell, never from a file. They reach newman inside the process, not on a command
line, and are not printed. A folder whose secret is not set is refused before anything runs. A failed assertion exits
non-zero.

In Postman itself, import the collection and an environment, fill the secrets you need, and run a folder.

The coverage test's red-proof: build the collection with one HTTP method left out, and POSTMAN1 fails, naming the
missing `DELETE /sites/{slug}/holds/{id}`.
