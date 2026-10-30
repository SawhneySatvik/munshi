# SDK

`@munshi/sdk` is a thin typed client for API v1. The types are generated from the same contracts the server parses
with, so a method's path, query and body are checked at compile time.

- No runtime dependencies. It needs `fetch` (Node 20 or later, or any browser).
- Every money figure renders through `formatMoney(figure, locale)`, integer arithmetic only.
- An error is a `MunshiError` with `status`, `code` and `requestId`.
- The key travels only in the `Authorization` header of a write. Nothing in the client logs.

It is shipped as a tarball from this page, not from npm. Check the sha256 before you install it.

## Changelog

- **0.1.0** — the first release: every published read, the writes (orders, bookings, booking requests, holds,
  enquiries, reservations), `ref`, `formatMoney` and `MunshiError`.
