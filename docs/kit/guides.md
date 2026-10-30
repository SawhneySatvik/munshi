# Guides

## A catalogue page

Read `catalogue` page by page with its `next` cursor, and show each item's name and price figure. Variants carry their
parent's id. Filter with `category`.

```ts
let cursor: string | undefined;
do {
  const page = await munshi.catalogue("prabhave", { limit: 50, ...(cursor ? { cursor } : {}) });
  render(page.data);
  cursor = page.next ?? undefined;
} while (cursor);
```

## An order widget

The app serves a ready widget. One script and one element put a cart on any page; it reads the catalogue and sends
the order with your publishable key:

```html
<script src="https://<host>/widgets/munshi-order.js"></script>
<munshi-order site="prabhave" key="mpk_prabhave_…" api="https://<host>"></munshi-order>
```

The order arrives at the shop as a request. The customer gets a code and follows its steps at
`GET …/orders/{code}`: step names and times only, never an amount.

## Booking with live slots

For a salon whose site takes live slots: read `services` and `stylists`, then `slots` for a branch, a service and a
date. Hold the slot the customer picks (`hold`), which keeps it for ten minutes, then `book` with the hold's id and
token, the customer's name and phone, and the site's notice and consent versions (from `site`). Release a hold the
customer abandons (`releaseHold`).

```ts
const { slots } = await munshi.slots("elite", { shop, service, date: "2026-11-02" });
const hold = await shop.hold("elite", { shopId: shop, serviceId: service, ...slots[0], botToken });
```

A site without live slots takes `requestBooking`, which the desk confirms.

## Hold a piece

For a shop that sells one-of-a-kind pieces, `reserve` asks the shop to keep a piece for a customer. The shop decides;
nothing is held until it does.

## Offers with codes

`offers` lists the published offers still running, each with its code. Pass the code with an order as `offerCode`. The
order's answer prices the cart from published cells, and the shop confirms the price.
