# PASS report (31 Oct, Bansal Super Mart (sample), edition paytm, recorded mode)

Walked at 1280 and 390 px, all four roles (Aarav owner, Nisha manager, Kabir and Mira counter staff), by client navigation
(link clicks) and direct load. Console errors: none on any route. Screenshots: `before_*` (owner, before fixes),
`after_desk_owner_*` (1280), `after_phone_owner_*` (390), `staff_*`, `manager_*`; raw walk table `walk-before_.tsv`.

| Route | Before | Fix | Remains |
|---|---|---|---|
| /app (home) | 5 px horizontal overflow at 1280 (right column wider than its track); edition card said "Placeholder / not built yet" with four items | right column pinned to its track; card is now a ledger card "This edition's own screens", links Settlements, AI teammate (/app/teammate) and Growth (/app/growth) only when that page exists (listed at build time in next.config.ts); voice summary and credit readiness dropped | AI teammate and Growth links appear once the other lanes add the routes |
| /app/settlements | table unstyled, 18 px horizontal overflow on a phone, copy showed a repo path and the Paytm name | tables use the shared ledger style inside a sideways scroller; copy neutral ("payment-provider-style"), no path | statement import form still the plain file input |
| /app/settings | one very long column of capability cards, empty right column | full-width page, capabilities in a two-column grid | the Signed-in list grows with every demo sign-in (no cap) |
| /app/settings/ai | long single column | same two-column grid, full width | |
| /app/counter, credit, stock, customers, orders, office, reports, staff, bills, bills/new, ask, offers, loyalty, invoices, inbox, campaigns, stock/table | already in look A, load, no console errors, no overflow | none needed | see data notes |
| /app/suppliers, /app/bills (owner) | redirected in an early walk | artefact of my click timing; direct and client loads are fine | |
| /app/calendar, packages, requests, staff/salary, /choose-shop | 404 | none: capability-gated (off in this shop) or not a Bansal route; not linked from the nav | |
| /, /demo, /sign-up, /how-it-works, /developers*, /platform/sign-in | 200 | none | not screenshotted beyond / and /demo |
| Staff roles | /app/office, settings, settlements are 404 for counter staff, by design | | |

Data notes (need db/seed or core, not done): Reports defaults to "Yesterday" (30 Oct) and shows rupee 0 because the
seed's sales end 27 Oct; loyalty, offers, inbox, invoices, campaigns, orders board are empty states (no seeded rows).
Tap targets: inline figure buttons (the dotted "Tap for source" figures) are 29 px high by design; segmented radios are
visually hidden inputs behind 48 px labels.
