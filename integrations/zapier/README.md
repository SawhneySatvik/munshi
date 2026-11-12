# Munshi for Zapier

A Zapier Platform CLI app (`zapier-platform-core` 19.2.1) with three polling triggers on Munshi's read-only
integration feed. There are no actions: nothing in Zapier changes a shop's books. See [docs/zapier.md](../../docs/zapier.md)
for the feed and how it keeps the One Guarantee.

| Trigger | Key | Fires when |
|---|---|---|
| PayPal Payment Waiting to Be Recorded | `paypal_payment_waiting` | PayPal (sandbox) reports a payment the books do not show yet |
| New PayPal Link Made | `paypal_link_made` | PayPal has made a link a person approved, with its payer URL |
| New Finding | `new_finding` | A watcher raises a finding; optional desk and kind filters |

Authentication is custom: the Munshi URL (default `https://munshi-sable.vercel.app`), the shop slug (default
`sharma-general-store`) and the integration key (the deployment's `MUNSHI_INTEGRATION_SECRET`). The connection test
reads the feed once. Every request carries the key as `Authorization: Bearer`.

This folder stands outside the pnpm workspace, with its own `package.json` and `package-lock.json`, so `zapier push`
packages plain npm dependencies.

## Test

```
npm install
npm test
```

The tests run the app through `createAppTester` against a local HTTP server that serves a synthetic feed: the app passes
Zapier's schema check and has no actions, the connection test sends the key and fails on Munshi's `404`, and each
trigger's mapping, filter and sample are checked.

## Push to Zapier

```
npm install -g zapier-platform-cli
zapier login                # opens Zapier's sign-in; saves a deploy key in ~/.zapierrc
zapier register "Munshi"    # once: makes the private integration and writes .zapierapprc
zapier validate
zapier push                 # builds and uploads this version
```

The integration stays private to your Zapier account until you invite others (`zapier users:add`).

## Example Zaps

These are three Zaps the triggers are made for. Each item carries `shop_label` ("Sample shop: synthetic data") and
`paypal_label`; put them in the message so a sample shop's events are never read as real ones.

1. **Slack: a payment to record.** Trigger: PayPal Payment Waiting to Be Recorded. Action: Slack, Send Channel Message
   to `#shop-office`: "PayPal says {{customer_name}} paid {{amount}} (invoice {{reference}}). It is not in the books yet:
   open Munshi to approve recording it. {{shop_label}} · {{paypal_label}}".
2. **Google Sheets: a link log.** Trigger: New PayPal Link Made. Action: Google Sheets, Create Spreadsheet Row with
   columns Customer `{{customer_name}}`, For `{{purpose}}`, Amount `{{amount}}`, Source `{{amount_source}}`, Payer link
   `{{payer_url}}`, Made `{{sent_at}}`, Label `{{shop_label}}`.
3. **Gmail to the owner: high-severity findings.** Trigger: New Finding, desk `credit`. Filter: severity is `high` or
   `critical`. Action: Gmail, Send Email to the owner: subject "Munshi found {{kind}} ({{severity}})", body
   "Impact {{impact}} (source {{impact_source}}), first seen {{first_seen_at}}. Open Munshi to see the draft fix.
   {{shop_label}}".
