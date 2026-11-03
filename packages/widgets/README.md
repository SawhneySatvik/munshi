# @munshi/widgets

Embeddable web components built on [`@munshi/sdk`](../sdk) and a site's publishable key. Today: `<munshi-order>`, an
order form a plain web page can load with one `<script>` tag.

## Entry points

| File | What |
|---|---|
| [`src/order.ts`](src/order.ts) | The `<munshi-order>` element |
| [`scripts/build.ts`](scripts/build.ts) | Builds the one file the app serves, `apps/web/public/widgets/munshi-order.js`: a classic script with no imports and no third-party code |

## Boundaries

- Reaches a shop only through the public API. Its calls are answered only from the site's own listed origins.

## Testing

```bash
pnpm --filter @munshi/widgets build
pnpm --filter @munshi/widgets test    # includes a check that the committed build is fresh
```
