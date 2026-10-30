# Authentication and errors

## Modes

| Mode | Used by | How |
|---|---|---|
| None | every published read | no header |
| Publishable key | orders, bookings, holds, enquiries, reservations | `Authorization: Bearer mpk_<slug>_…` |
| Secret key | the shop's own drafts and findings | `msk_<slug>_…`; these routes are not open yet |

A publishable key is meant to sit in a web page. It can only send requests the shop approves, and only from the
origins the shop listed for its site. A key that is wrong, revoked or used from another origin answers the same
`not_found` as an unknown route, so a key cannot be probed.

## Origins

A GET without an `Origin` header is served. A browser request from an origin the site does not list answers
`not_found`.

## Idempotency

Every POST and DELETE carries an `Idempotency-Key` header: 8 to 128 of `A–Z a–z 0–9 _ -`. Sending the same key with
the same body again returns the first answer and writes nothing. The same key with a different body answers
`idempotency_mismatch`. Without the header the answer is `idempotency_key_required`.

## Rate limits

Per address: 5 writes in 10 minutes and 120 reads a minute. Per key: 300 writes and 20,000 reads a day. A hold is
limited per device, per address and per stylist and day. Over a limit the answer is `rate_limited` with
`Retry-After`.

## Errors

Every error has one body, its message fixed per code:

```json
{ "error": { "code": "not_found", "message": "Not found.", "fields": [], "requestId": "…" } }
```

`fields` names the request fields that failed their contract, for `invalid`. The full table follows.
