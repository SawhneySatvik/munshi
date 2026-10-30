# Figures and refs

A figure is a number with its source. There are four shapes:

| Shape | Fields | Example |
|---|---|---|
| Money | `minor`, `currency`, `ref` | a price |
| Integer | `value`, `ref` | a duration in minutes, a number of sessions |
| Derived money | `minor`, `currency`, `from` (refs) | an order's line amount or total, computed from published prices |
| Text, date, time | `text`, `date` or `at`, with `ref` | an item's name |

A `ref` reads `⟨snap:<snapshot id>·<row>·<column>⟩`: the stored snapshot the server read, the row in it, and the
column.

## Tap for source

`GET /api/v1/sites/{slug}/refs/{snapshot}/{row}/{col}` answers whether the cell is one the site's release pins, the
cell itself, which book table and row it came from, and when the release was published:

```json
{ "verified": true, "cell": { "minor": 189900, "currency": "INR", "ref": "⟨snap:…·0·price⟩" }, "source": { "table": "…", "id": "…" }, "publishedAt": "…" }
```

A ref the release does not pin, another shop's, or one that does not parse answers
`{ "verified": false, "label": "Cannot verify" }`. Show that label in place of the number.

## Rules for showing figures

- Render a figure from its own fields; never type a number into your page that did not come as a figure.
- Format money from `minor` with integer arithmetic (the SDK's `formatMoney` does). Never divide into a float.
- Show "Prices from the shop's books · published <date>" near prices, from the site's release.
