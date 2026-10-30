# Getting started

## 1. Read a published catalogue

Reads need no key. Ask for a shop's site by its slug:

```sh
curl https://<host>/api/v1/sites/prabhave/catalogue?limit=3
```

Each item has its variants, and each variant's price comes back as a figure: whole minor units (paise), the currency,
and the ref of the cell it was read from.

```json
{ "minor": 249900, "currency": "INR", "ref": "⟨snap:…·0·price⟩" }
```

## 2. Install the SDK

Download the tarball from [the SDK page](/developers/sdk), check its sha256, and install it from the file:

```sh
sha256sum munshi-sdk-0.1.0.tgz
npm install ./munshi-sdk-0.1.0.tgz
```

It has no runtime dependencies and runs wherever `fetch` does.

## 3. The first call

```ts
import { createClient, formatMoney } from "@munshi/sdk";

const munshi = createClient({ baseUrl: "https://<host>" });
const page = await munshi.catalogue("prabhave", { limit: 3 });
for (const item of page.data) for (const v of item.variants) console.log(v.name, formatMoney(v.price));
```

`formatMoney` groups the Indian way and shows paise only when there are any. It renders "Cannot verify" for a figure
whose ref does not parse.

## 4. Send a request

Writes need the site's publishable key (`mpk_<slug>_…`), from the shop's settings. The SDK sends it in the
`Authorization` header and adds an `Idempotency-Key` to every write.

```ts
const shop = createClient({ baseUrl: "https://<host>", key: "mpk_prabhave_…" });
const order = await shop.order("prabhave", { shopId, channel: "site", lines: [{ itemId, qtyMilli: 1000 }] });
console.log(order.code); // the code the customer quotes; GET …/orders/{code} shows its steps
```
