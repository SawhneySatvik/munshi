# Munshi as a platform: shops, storefronts, PWA, caching, channels, PayPal (design)

Date: Mon 2 Nov 2026. Status: approved with changes (D-079): no date gating; merchants accepted by the superadmin; a
superadmin model and feature router per merchant; PayPal built now.

## The product, in three layers

1. **Munshi** — the agentic back office from day one: counter, stock, buying, books, credit, staff (ERP), customers,
   campaigns and the inbox (CRM, marketing, help desk), run by agents that propose and a person who approves.
2. **Munshi API** — the same shop as a backend for any storefront: catalogue, offers, bookings, orders, holds, through
   `/api/v1` and the dependency-free SDK.
3. **Munshi Studio** — we design and build a shop's website on that API (today's Elite and Prabhave sites are the first
   two), and a template any shop can publish itself.

The landing page and the README say these three in this order.

## 1. Shops: one click to a working shop

- **Sign-up** (email + password, the identity adapter already built): shop name, kind (kirana, salon, boutique,
  restaurant), city. One transaction creates the tenant, its first branch, the owner member, the capabilities its kind
  needs, and the edition's model defaults. Two modes, chosen on the page:
  - **Sample shop** (as today): seven days, synthetic data, AI on, labelled.
  - **Real shop** (new): empty books, real data, AI off until the operator approves (A5 stands: an approved platform
    change), payments recorded only. The founder reverses "no real shop before 5 Nov" for self-serve sign-up (record as a
    decision). Hardening first: lockout, rate limits (below), a password policy, and email verification when an email
    provider exists (until then, the owner's own invite link flow).
- **After the dashboard: Getting started**, a checklist on Home that finishes itself from the books: add items (a price
  list photo or a CSV through the grid), opening stock (a shelf photo), a staff member, connect WhatsApp and Instagram,
  turn AI on (a request to the operator), build your storefront.
- **Build your storefront**: pick a template (kirana, salon, boutique), the shop's colours and logo, the address
  (`<slug>.munshi.shop` or a path); the site reads the shop through the SDK. Publishing is a request: the site stays
  hidden until the operator verifies it (A6 stands). Studio, as a service, is a contact form on the same page.

## 2. The PWA

- Web app manifest (name, short name, icons from the mark, theme and background from the tokens, `display: standalone`,
  start URL `/app`, shortcuts: Ask, Counter, Stock), iOS meta tags, an install prompt on Home (dismissable).
- A service worker (hand-written, small, versioned by the build id):
  - **Precache** the app shell: the offline page, fonts, icons, the CSS and JS of the shell.
  - **Runtime**: `/_next/static/*` cache-first (immutable); images stale-while-revalidate; page navigations
    network-first with the offline page as fallback.
  - **Never cached**: server actions and any POST, `/api/*`, sign-in, anything under `/platform`.
  - **Sign-out clears every cache and the offline store.**
- **Offline, read-only**: the last Home brief and the stock list the member opened are kept in IndexedDB as the stored
  snapshot cells they rendered from, with their read time. Offline, the page shows them under "Offline · as read at
  <time>" and every action is disabled. Nothing writes offline (no queued sales: a sale is a book write).
- **Push** (Web Push, VAPID keys in config): "A draft is waiting for you" when an agent proposes; the notification
  carries no figures (a figure on a lock screen cannot cite its row), only who and what kind.

## 3. Caching

Server (Redis through `packages/adapters/src/cache`, an in-memory fallback in dev):
- **Read-through cache of tenant reads**, keyed by `tenant : read : params : version`, where `version` is a per-tenant
  counter bumped in the same transaction as every book or ops write (a small `ops.tenant_version` row read once per
  request). A write makes every older entry unreachable: no stale figure, no invalidation lists. The cached value is the
  stored snapshot's id and cells, so a figure still cites its row.
- **Public storefront reads** (`/api/v1/sites/*`): Next's `use cache` with a tag per shop, revalidated on publish and on
  catalogue writes; the CDN holds them for a short max-age with stale-while-revalidate.
- **Answer cache**: an Ask answer is reused for the same question on the same data version (question hash + version),
  saving a model call; it is the same checked answer, re-rendered from its cells.
- **Rate limits** (Redis sliding window): sign-in and sign-up per IP and per email, the public API per site and IP,
  Ask and photos per member (beside the AI caps), webhooks per channel.
- Marketing pages: static, revalidated on deploy.

Client:
- Next's router cache for back/forward; no prefetch of app pages (they mint snapshots); fonts and static assets
  immutable; the service worker above.

## 4. Security, the rest of it

- CSP with a per-request nonce (scripts), `frame-ancestors 'none'`, HSTS, `Referrer-Policy`, `Permissions-Policy`
  (camera and microphone only on the pages that use them) — `proxy.ts` already sets headers; extend it.
- Session cookie `HttpOnly; Secure; SameSite=Lax`, rotated on sign-in and on role change; idle and absolute expiry.
- Server actions: the person always from the session; origin checked (Next) plus the form key where a write is not
  naturally idempotent.
- Secrets only through `packages/config` (redacted); webhook signatures verified (WhatsApp already).

## 5. Channels: Instagram and WhatsApp (Meta's own)

- The adapters exist (`packages/adapters/src/channels/{whatsapp,instagram}.ts`). Wire the live path behind the
  operator's channel grant: a campaign's approved send goes to WhatsApp (template message) and its post to Instagram
  (image + caption). Without a grant or a token every send stays recorded, as today, and the screen says so.
- Tokens come from a Meta app the founder sets up; until then the film shows recorded sends, labelled.

## 6. PayPal (for the PayPal AI Hackathon, built now)

- A payments connector (`packages/adapters/src/payments/paypal.ts`) in sandbox: create a PayPal invoice or payment link
  for an invoice, an order's advance, or an overdue udhaar; receive PayPal's webhook (signature verified).
- Agents propose "send a PayPal link to Rakesh for his overdue balance" as a draft; approving sends it. A paid webhook
  becomes a draft "record this payment" (the settlement pattern), approved by a person. Munshi never moves money.
- The PayPal Agent Toolkit / MCP server is used by the agent's tool layer for reads (invoice status), never to pay.
- Before submitting: the repo public with an open-source licence (the founder's decision), the Juspay employment terms
  checked by the founder.

## 7. Compliance items found

- Muse Spark Open's licence: show "Built with Muse Spark Open" in the UI (AI staff page and the landing page's footer).

## 8. The superadmin (D-079)

- **Merchant acceptance**: a real shop's sign-up creates its tenant as pending; it signs in to a "waiting for approval"
  page until the superadmin accepts it (an approved platform change, audited). A sample shop needs no acceptance.
- **Model router per merchant**: on top of the deployment's allow-list, a per-shop allow-list of model aliases per role
  and a per-shop default; core's modelFor reads the shop's list first. Set only through approved platform changes.
- **Feature access per merchant**: which AI features a shop may use (ask, photos, voice, read-aloud, narration,
  campaign copy, inbox drafts, memory), beside the existing capabilities and caps.
- **Dashboard**: shops pending acceptance, shops by state, this month's AI spend and calls by shop (from ai.spend),
  models in use, channel grants, recent platform changes.

## Order

No date gating (D-079). Lanes run in parallel where their files do not overlap; the schema is one migrator at a time:
M3 memory → M4 surplus → M5 platform (pending merchants, per-shop model and feature access) → M6 cache version and push
subscriptions → M7 PayPal records.
