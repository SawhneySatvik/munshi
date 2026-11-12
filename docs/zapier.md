# Munshi in Zapier

A shop owner already lives in WhatsApp, Slack, a Google Sheet or their inbox. The Zapier app sends Munshi's PayPal
events and findings there: a payment PayPal reports that the books do not show yet, a payment link PayPal has made,
and a new finding from the watchers. Zapier only reads. Recording a payment, sending a link or quieting a finding is
still done in Munshi, by a named person's approval.

The app is in [`integrations/zapier`](../integrations/zapier). It reads one route,
[`GET /api/integrations/v1/feed`](../apps/web/app/api/integrations/v1/feed/route.ts).

## The feed

```
GET /api/integrations/v1/feed?shop=sharma-general-store
Authorization: Bearer <MUNSHI_INTEGRATION_SECRET>
```

It answers one shop's:

| List | What it holds | Item id |
|---|---|---|
| `links` | Each PayPal link, newest change first: customer, purpose (`credit`, `invoice`, `order`), state, amount, payer URL, mode | `<linkId>:<state>` |
| `payments` | Each PayPal payment the books do not show yet, by the watcher's own rule (`watch.paypal_unrecorded`) | `<eventId>:unrecorded` |
| `findings` | The watchers' findings: desk, kind, severity, status, impact, first and last seen | the finding's id |

A link's state is the app's own (`linkState` in [`queries-paypal.ts`](../packages/core/src/queries-paypal.ts)): `asked`,
`sent` (made, not paid), `paid` (PayPal says paid, not in the books yet), `recorded`, `failed`, `cancelled`. The id
changes with the state, so a link that moves on is a new item to a poller, and Zapier's deduplication never hides it.

Every item carries the shop's labels: `Sample shop: synthetic data`, and that PayPal is the sandbox and that Munshi
records payments but never processes them. A link made without PayPal keys says `mode: "recorded"`.

### How it keeps the One Guarantee

- **Read only, held by the database.** [`readIntegrationFeed`](../packages/core/src/integration-feed.ts) runs in one
  transaction that is set `READ ONLY` before anything is read, so PostgreSQL refuses any write in it. It mints no
  snapshot, proposes no draft and runs no command. It reads the way a watcher does: under the shop's context, with no
  acting member, so it can never act as anyone. Row-level security stays forced.
- **Every amount traces to a stored row.** A link's amount is the stored snapshot cell its approved draft cited, sent
  with its ref (`⟨snap:…·row·col⟩`). A payment's amount is the stored PayPal notification's row
  (`ops.payment_event:<id>`). A finding's impact is the snapshot cell the watcher named. The route only formats them.
  One that cannot be traced reads "Cannot verify".
- **A key, and nothing else.** The route admits only `Authorization: Bearer <MUNSHI_INTEGRATION_SECRET>`, compared in
  constant time. An unset secret, or one shorter than 32 characters, admits no one. A wrong key, an unknown or
  malformed shop, and a real shop all get the same bare `404`, as if the route did not exist, and a refused key opens
  no database connection.
- **Sample shops only.** A real shop's books (`data_class = 'live'`) are read only by that shop's own members, never
  through a deployment-wide key, so the feed answers `404` for one.

The tests are [`apps/web/test/integration-feed.test.ts`](../apps/web/test/integration-feed.test.ts) (FEED1–FEED4), on
the demo kirana with its PayPal step. Their red-proofs are in
[`db/test/v2/sabotage/integrations.ts`](../db/test/v2/sabotage/integrations.ts): any key admitted, a link id without its
state, a writable transaction, a real shop served.

## Setting it up

1. Set the key on the deployment. Generate one with `openssl rand -hex 32` and put it in `.env` as
   `MUNSHI_INTEGRATION_SECRET`. `node deploy/vercel-env.ts` pushes it to Vercel with the deploy's other keys.
2. Check the feed answers:
   ```
   curl -H "Authorization: Bearer $MUNSHI_INTEGRATION_SECRET" \
     "https://munshi-sable.vercel.app/api/integrations/v1/feed?shop=sharma-general-store"
   ```
3. Push the Zapier app (see [`integrations/zapier/README.md`](../integrations/zapier/README.md)): `zapier login`, then
   `zapier push` from `integrations/zapier`.
4. In Zapier, connect Munshi with the URL, the shop slug and the key. The connection test reads the feed once.

## The triggers

| Trigger | Fires when | Useful fields |
|---|---|---|
| PayPal Payment Waiting to Be Recorded | PayPal reports a payment the books do not show yet | customer, amount, amount source, PayPal invoice id, received at |
| New PayPal Link Made | PayPal has made a link a person approved | customer, purpose, amount, payer URL, mode |
| New Finding | A watcher raises a finding (optionally one desk or kind) | desk, kind, severity, impact, impact source |

All three poll the feed. There are no actions: nothing in Zapier writes to Munshi.

## Tests

```
cd integrations/zapier && npm install && npm test
```

The tests use `zapier-platform-core`'s app tester against a local HTTP server that stands in for the feed: the app
definition passes Zapier's own schema check and has no action, the connection test sends the key and fails on a `404`,
and each trigger maps the feed's items with their sources.
