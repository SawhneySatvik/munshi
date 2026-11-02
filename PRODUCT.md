# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Shop owner** of a small shop that sells, stocks and buys: a kirana in the demo, salons and restaurants too. Runs the
  counter, stock, buying, books, customer credit (udhaar) and staff, often from a phone at the counter. Job: know what
  changed, find where money leaks, and approve fixes without doing the bookkeeping.
- **Shop staff** (manager, counter staff): record sales, counts and payments under their own name; approve only what
  their role allows.
- **Platform operator** (superadmin): runs the hosted platform. Verifies shops and their sites, sets per-shop AI on/off,
  call caps and model choices; every change is an approved platform draft.
- **Hackathon judges** (until 5 Nov 2026): evaluate the landing page, the demo and a short film on a laptop. Primary
  viewer for this design pass; phone width must still work cleanly.

## Product Purpose

An AI back office for a small shop. Agents watch the shop's records, explain what happened, find money leaks and draft
the fix; the owner approves. Success: the owner acts on a ranked morning brief and a tray of drafts in minutes, and every
figure they see can be traced to the row behind it.

## Positioning

The One Guarantee: nothing changes the books without a named person's approval, and every number shown traces to a
ledger row. Agents have no write access; they only propose drafts. Model prose never carries free digits; a figure that
cannot be traced reads "Cannot verify".

## Operating Context

- Owner app (`/app`): home and morning brief, the office (the agents), ask (typed or by voice), counter, stock and shelf
  counts from a photo, bills, suppliers, orders, invoices, credit, settlements, reports, growth, customers, staff and
  salary, offers, loyalty, campaigns, inbox, settings.
- Approval tray: drafts wait for a named person; approve or reject; executed under the approver's identity.
- Platform console (`/platform`): shops, changes awaiting approval, defaults, the model allow-list.
- Public site (`(site)`): landing, how it works, sign-up, the demo picker (sample shops, no password), developer docs.
- Shop public sites (`apps/sites`) are a separate website layer, out of scope for the current design pass.

## Capabilities and Constraints

- Two editions from one codebase (a config switch): the Meta hackathon edition and a Paytm edition.
- Model-agnostic: roles (router, reason, vision, segment, voice, narrate) map to a provider and model in config.
- Simulated means labelled: data is synthetic, suppliers are simulated, payments are recorded and never processed; any
  screen with simulated parts says so on screen.
- Languages: English and Hindi. In English mode no Devanagari script appears anywhere on screen (Latin-script words such
  as "udhaar" are fine).
- Navigation decision (2 Nov 2026): desktop groups the app into five hubs (Today, Sell, Stock & buying, Money, People)
  plus a jump-to palette; phones use a bottom bar plus the palette.
- The isometric office (Gemini's component, refined by the founder separately) appears on the landing page and in the
  app's office; the app hosts it and feeds it stored rows.
- Open: the agent roster and names (a seven-agent cast is proposed, not confirmed).

## Brand Commitments

- Name: Munshi.
- Keep the existing colours and theme (owner-confirmed 2 Nov 2026); improve placement, hierarchy and how content is shown.
- Voice: plain, short, factual sentences; no hype.
- Landing page: a split hero, words and actions on one half and the live office on the other. Skydive's office scenes
  are the reference for the office; its wordmark-only landing page is not.

## Evidence on Hand

- Sample shops on synthetic data: Sharma General Store (kirana), Elite Unisex Salon & Academy, Prabhave (suits),
  Bansal Super Mart (Paytm edition).
- No real customers, testimonials, pricing, press or usage numbers exist. Do not invent them.
- No live Meta model call has been recorded yet; recorded fixtures are hand-written.

## Product Principles

1. The owner decides; agents propose. Every action surface makes the approval explicit.
2. Every number carries its receipt: a source a click away, never a bare figure.
3. Say less. One clear line beats a paragraph; show the shop's state, not a description of the product.
4. Honest about what is simulated or unverified, on the screen where it matters.
5. Works at the counter: fast, legible, thumb-reachable on a phone.

## Accessibility & Inclusion

Bilingual (English, Hindi) with no mixed scripts in English mode; voice input for owners who prefer speaking; keyboard
access and reduced-motion support across the app.
