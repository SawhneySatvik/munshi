# Agents that work: wave 1 and wave 2 (design)

Date: Mon 2 Nov 2026. Status: approved by the founder (2 Nov). Gap list: `2026-11-02-munim-gap.md`.
Every item keeps the One Guarantee: agents propose, a named person approves, every figure renders from a stored cell.

## The cast (on screen; database desk ids unchanged)

| Cast | Role | Desks and run kinds it covers |
|---|---|---|
| Munshi | The lead | `ask`, `brief`, router |
| Tally | Stock | `shelf`, watcher desk `stock` |
| Ledger | Money | `bills`, `settlements`, watcher desks `sales`, `staff` |
| Dash | Fixes | recipe runs (`draftFix`), `counter` |
| Echo | Customers | `replies`, `chat_to_order`, `voice`, inbox, watcher desks `customers`, `orders`, `bookings` |
| Bloom | Campaigns | `campaigns`, watcher desk `packages` |
| Keeper | Memory | the memory desk (wave 2) |

One mapping module in the web app (`lib/cast.ts`) turns a desk or run into a cast member; the database keeps its ids.

## Wave 1

### W1-A · The idle agents, wired (no schema)
- A finding (Home's brief and "+N more", the office brief) gets **Why?** (`explainFinding`: an answer with source chips,
  cite or abstain) and **Draft the fix** (`draftFix`: the draft joins "Waiting for you"). **Snooze** and **Dismiss** use
  core's `snoozeFinding` / `dismissFinding`.
- The tick narrates the brief (`narrateBrief`, narrate role); the template stays the fallback and the label says which.
- Inbox: a voice note is transcribed (`transcribe`, voice role, `saveTranscript`); **Draft reply** (`draftReply`) and
  **Draft order** (`draftOrder`) make drafts for approval. A run that read a customer's text is tainted (existing rule).
- Campaigns: **Write the copy** (`writeCampaignCopy`) fills the copy; the owner edits; approval is unchanged.
- AI staff: desks with no agent code (`counter`, `settlements`) leave the model picker.
- Done when: each action runs end to end in recorded mode with a fixture, a test per action proves the draft lands in the
  tray and nothing is written to the books before approval, each red-proved.

### W1-B · Desks and the run log (no schema)
- A core view per desk over `ai.run`, `ai.trace` and the decisions on its drafts, last 7 days: proposed, approved,
  rejected, abstained, failed. Each count is a stored snapshot cell.
- `/app/office`: under the scene, one card per cast member (name, role, model alias, the counts, the latest run), and a
  run log (newest first, filter by cast) whose row opens the run's trace step by step (kind, label, alias, ms).
- The scene's agent states come from each cast member's latest run: running → thinking, proposed and undecided →
  waiting, approved → done, failed → blocked, else idle. No invented activity.
- Done when: the view's counts match seeded runs in a test; the office renders states from rows; red-proved.

### W1-C · Spend ledger and money cap (schema: migrator M1)
- `ai.spend`: one row per model call (run, role, alias, tokens in / out / cached, cost in minor units and currency, or
  null cost when the alias has no price). Append-only, RLS, revoke-then-grant.
- A price table in code (`packages/agent/src/prices.ts`) per alias: input, output, cached per million tokens. Muse Spark
  1.25 / 4.25 / 0.15 USD; others from their public price pages; an unpriced alias costs null and shows "Cannot verify".
- A shop's monthly budget (minor units) in its platform config, set through an approved platform change.
- `allow()`: under 80% as today; from 80% a role moves to the cheapest allowed alias with a price, else the template;
  at 100% rules only (run outcome `budget`). The trace says which.
- Shown: AI staff (this month by cast member, and the budget), the console's shop page. Figures are cells.
- Done when: SPEND gates (a call writes its row; the soft cap swaps the alias; the hard cap stops calls; an unpriced
  alias shows "Cannot verify"), red-proved.

## Wave 2

### W2-A · Memory and "why this number" (schema: migrator M3)
- `ai.memory`: short notes derived from decisions (a rejection's reason, a standing preference), each citing its decision
  row, `valid_from` / `valid_to`, no digits (the number grammar rejects them). Forgetting is the owner's command.
- Notes go into the agents' context as a stable prefix; Keeper's desk lists them with their source chips.
- "Why this number": the source drawer adds a small graph from a figure's cell to its snapshot, the rows read, the
  decision that wrote them and who approved it (a recursive read over the keys; no new table).
- Done when: MEM gates (a decision makes a note; a note with a digit is refused; an expired note is not used) and a
  GRAPH gate (the walk from a seeded figure reaches its decision), red-proved.

### W2-B · Surplus for good (schema: migrator M4)
- The expiry watcher's finding can be fixed by **Offer it**: a draft to give the stock to a recipient (simulated and
  labelled). Approving records the stock out with reason `donated` and a listing row, in one transaction with its audit.
- An impact tally (items given, rupees not wasted) from stored cells, on the office and the landing page's sample.
- Done when: SURPLUS gates (nothing moves before approval; approval writes stock and listing together), red-proved.

### W2-C · Sarvam through the provider layer (schema: migrator M2, the `speak` role)
- `speak` role: Bulbul v3 adapter; reads the brief and an answer aloud from already-validated text, in the page's
  language (Hindi, English, and the other Bulbul languages). Served by Sarvam on both editions (no Meta text-to-speech).
- Voice in: Saaras v4 with language detection across its Indian languages, behind Muse Voice.
- Documents: a Sarvam Vision adapter serving the vision role for bills and invoices, PDFs included; Muse Spark stays the
  default for images; a PDF goes to Sarvam Vision.
- Done when: recorded fixtures for each adapter, SARVAM gates (speak returns audio for validated text only; a PDF bill
  reads to a purchase draft; a missing key falls back or fails by name), red-proved.

## Order

Migrator, serially: M1 spend and budget → M2 the speak role → M3 memory → M4 surplus.
Builder lanes: W1-A and W1-B start now; W1-C after M1; W2-C after M2; W2-A after M3; W2-B after M4.
Every lane: its own territory, red-proof its new gates, an adversarial review before merge, no commits (the orchestrator
commits).
