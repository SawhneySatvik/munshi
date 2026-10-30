# Overview

Munshi's API v1 lets a shop's own website, app or widget show what the shop has published and send the shop requests:
an order, a booking, a hold on a piece, an enquiry.

**Every figure you get is a ledger row. Nothing you send changes the books until the shop approves it.**

- A price, a duration, a count: each comes as a *figure* with a `ref`, the address of the stored cell it was read from.
  `GET …/refs/{snapshot}/{row}/{col}` answers which book row that is. A figure that cannot be traced renders
  "Cannot verify", never a guess.
- Reads come from the shop's latest *release*: the catalogue, services, packages and offers as the owner last
  published them. Stock on hand is never published.
- Writes are requests. An order arrives as a request the shop confirms; a booking request waits for the desk. The
  totals in an order's answer are computed from published price cells, and the shop confirms them.

The API lives under `/api/v1`. Every response carries `Munshi-Api-Version` and an `x-request-id`; quote the request id
when you ask for help.

This is a hackathon build. The shops on the demo are synthetic, payments are recorded and never processed, and messages
to customers are recorded, not sent.
