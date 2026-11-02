# UI refresh: layout, navigation, landing (design)

Date: Mon 2 Nov 2026. Status: proposed, awaiting the founder's approval.
Scope: `apps/web` only: the public site, the owner app (`/app`) and the platform console (`/platform`).
Out of scope: shop public sites (`apps/sites`, a separate layer); the office scene's own design (the founder refines it
with Gemini separately); colours and theme (kept as they are).

## Decisions taken (2 Nov)

- Keep the palette, type and theme. Fix placement, hierarchy and how much text each screen shows.
- Landing page: a split hero. Words and actions on one half, the live isometric office on the other. Not Skydive's
  wordmark page; the office scene is the borrowed idea.
- Use Gemini's office (`design/munshi_isometric_ai_back_office.tsx`) as-is on the landing page and in the app's office.
  The founder will refine it later; the app only hosts it.
- Navigation: five hubs plus a jump-to palette on a desk; a bottom bar plus the palette on a phone.
- Design for judges on a 1440px laptop first; 390px phones must still work cleanly.
- English mode shows no Devanagari anywhere.

## 1. The office component

- New `apps/web/components/office/` holds Gemini's component, cut down to the component itself (its demo page's
  environment and look switchers stay out). Gemini's file is incomplete: the gaps are filled with plain stand-ins
  marked in the code, its two bugs are fixed (the discarded `tick`; walks with no event never animating), and the
  characters use our existing bot marks until Gemini's full characters arrive.
- It takes the props in the brief's data contract (`design/prompts/isometric-office.md` §6) and nothing else.
- **Landing:** fed by a short scripted loop on the sample shop (a finding, a draft to the tray, an approval), with
  the "Sample shop" label always visible. Reduced motion shows the still scene.
- **App, `/app/office`:** the scene sits above the morning brief. Tray count and agent states come from stored rows
  (drafts waiting, open findings); no invented activity. Clicking an agent opens Ask; clicking the tray opens the drafts.

## 2. Landing page (`/`)

- **First viewport, 1440×900:** left half (about 520px of text column): a one-line kicker, a headline of at most eight
  words, one sentence under it, two actions ("Try the demo", "How it works"), and the simulated-data line. Right half:
  the office, bleeding to the page edge. No second-language line in English mode.
- **Below the fold:** each section becomes a heading, one line and one visual. The three promise cards, the "runs"
  list, the agents list and the shops strip are kept but each loses its paragraph; the agents list reuses the office's
  cast so the page shows one cast, not two.
- **Phone:** the office goes under the actions, cropped to the centre of the room.

## 3. Owner app shell (`/app`)

- **Desk rail (≥1024px):** Ask on top, then five hub groups with small headings, each listing its sections:
  - Today: Home, The office, Inbox
  - Sell: Counter, Orders, Invoices, Offers, Packages, Calendar, Requests
  - Stock & buying: Stock, Bills, Suppliers
  - Money: Credit, Settlements, Reports, Growth
  - People: Customers, Staff, Salary, Loyalty, Campaigns
  - Settings sits at the rail's foot.
  The current role and capability filtering is unchanged; an empty group hides.
- **Jump-to palette:** ⌘K / Ctrl K, or the search field in the top bar. It lists every section the member can open, by
  hub, filtered as you type. Pressing Enter on a question that matches no section hands it to Ask.
- **Phone bottom bar:** Home, Counter, the mic, Stock, and More. More opens a sheet listing every section grouped by hub, with the palette's search field at its top.
- **Page head:** one line: the page title, with the shop name as a small kicker beside it. The ruled card and the
  lede paragraph go. A page that needs a lede gets one short muted line.
- **Width:** content uses the space. At 1440 the main column grows to fill the shell (max about 1280px), with the right
  rail kept at about 360px where a page has one. Lists and tables use the full main column.
- **Repetition:** per-row labels that say the same thing on every row (for example "Fixed words" on each brief line)
  move to the column or section heading.

## 4. Platform console (`/platform`)

Same page head and width rules; its navigation becomes one short group in the same rail style.

## 5. Language sweep

Remove Devanagari from English mode at: `components/site/words.ts` (lines 20, 90, 92, 95, 98), `example.ts:69-70`,
`SiteFoot.tsx:31`, `lib/i18n.ts:75` (`askHi`, shown by `VoiceButton.tsx:25`) and `app/global-error.tsx`. Hindi mode
keeps its Hindi.

## 6. Order of work

1. Shell: rail groups, palette, phone bar, page head, width. One change reaches every app page.
2. Language sweep.
3. Office component in place; `/app/office` hosts it.
4. Landing page split hero and the trimmed sections.
5. Per-page passes on the busiest app pages (Home, Stock, Credit, Counter, Office), then the platform console and the
   remaining site pages.

Each step ends with screenshots at 1440 and 390, the web test suite, and the founder's look.

## 7. Guarantee and rules

- No change to what a number renders from; source chips and "Cannot verify" stay on every figure.
- Simulated labels stay on every screen that has simulated parts, the landing office included.
- No schema change. No new dependency except, if needed, the `motion` package already allowed by the office brief.
