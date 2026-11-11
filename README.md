<div align="center">

# Munshi

**An AI back office for a small shop. Agents do the books; a named person approves every change.**

<img src="docs/images/office.png" alt="The office: Munshi's seven agents at their desks in an isometric office, with the owner's approval tray in front" width="900">

<br>

[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue.svg)](LICENSE)
[![Next.js 16.4](https://img.shields.io/badge/Next.js-16.4.3-000000?logo=nextdotjs&logoColor=white)](apps/web/package.json)
[![React 19.3](https://img.shields.io/badge/React-19.3.1-149eca?logo=react&logoColor=white)](apps/web/package.json)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0.2-3178c6?logo=typescript&logoColor=white)](pnpm-workspace.yaml)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-4169e1?logo=postgresql&logoColor=white)](db/schema)
[![Node 22+](https://img.shields.io/badge/Node-%E2%89%A522-5fa04e?logo=nodedotjs&logoColor=white)](package.json)
[![pnpm 11.9](https://img.shields.io/badge/pnpm-11.9.0-f69220?logo=pnpm&logoColor=white)](package.json)
<br>
[![Models: Meta-first](https://img.shields.io/badge/models-Meta--first-0866ff?logo=meta&logoColor=white)](docs/decisions/0005-model-roles-meta-first.md)
[![PayPal: sandbox](https://img.shields.io/badge/PayPal-sandbox%20only-003087?logo=paypal&logoColor=white)](docs/decisions/0009-paypal-as-approved-drafts.md)
[![Vitest 5.0](https://img.shields.io/badge/Vitest-5.0.5-6e9f18?logo=vitest&logoColor=white)](docs/testing.md)
[![Test files: 263](https://img.shields.io/badge/test%20files-263-brightgreen)](docs/testing.md)
[![Red-proofs: 1,794 cases](https://img.shields.io/badge/red--proofs-1%2C794%20cases-c0392b)](docs/testing.md#red-proofs-the-sabotage-registry)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?logo=pwa&logoColor=white)](apps/web/public/sw.js)
[![Data: synthetic](https://img.shields.io/badge/data-synthetic-f2c94c)](docs/limitations.md#scope)

[**Run the demo locally**](#quick-start) ·
[Architecture](docs/architecture.md) ·
[Security](docs/security.md) ·
[Testing](docs/testing.md) ·
[Decisions](docs/decisions/README.md) ·
[Limitations](docs/limitations.md)

</div>

---

Munshi runs the back office of a shop that sells, stocks and buys: the counter, stock, buying, the books, customer credit
(_udhaar_), staff and salary. The demo is a kirana (an Indian corner store), with a second kirana, a salon and a clothes
boutique beside it. A cast of seven agents watches the shop's records, explains what happened, finds where money leaks
and drafts the fix. **Nothing changes the books until a named person approves it, and every figure on screen opens the
row it came from.**

## Contents

- [Why Munshi](#why-munshi)
- [The One Guarantee](#the-one-guarantee)
- [The agent cast](#the-agent-cast)
- [Feature tour](#feature-tour)
- [Architecture](#architecture)
- [The data model at a glance](#the-data-model-at-a-glance)
- [Security highlights](#security-highlights)
- [Testing](#testing)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Roadmap and limitations](#roadmap-and-limitations)
- [Licence](#licence)

## Why Munshi

A small shop's owner is the cashier, the buyer, the stock-keeper, the credit desk and the payroll office, often at the
same counter. The money leaks quietly: stock that walks off the shelf, a supplier's price that creeps up a rupee a
month, credit that is never chased, a payout that settles short, goods that expire at the back of a shelf. Accounting
software records what the owner types; it does not notice any of this, and an AI assistant that _can_ notice it usually
also wants to change things on its own.

Munshi takes the other road. Its agents read the books overnight and on request, raise **findings** with the rupees at
stake, and turn a finding into a **draft**: a reorder, a reminder, a PayPal link, a gift of near-expiry stock. The owner
taps Approve, and the change runs under their name. An agent never writes, and a number on screen never comes from a
model's prose.

| What a shop gets                                           | How                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A morning brief, ranked by rupees at stake                 | Watchers run over named reads of the books; findings are deduplicated and ranked                       |
| Answers to questions, typed or spoken, in English or Hindi | Ask routes the question to a desk, reads the books, and validates every figure against a stored cell   |
| Photos instead of data entry                               | A shelf photo becomes a count; a supplier's bill (photo or PDF) becomes a purchase draft               |
| Fixes it can trust                                         | Every fix is a draft waiting in a tray; approval re-checks the numbers it was based on                 |
| A trail for every figure                                   | Tap a number for its source; "Why this number" walks it to the book row, the decision and the approver |

## The One Guarantee

> **Nothing changes the books without a named person's approval, and every number shown traces to a ledger row.**

"The books" are the ledgers, stock, prices, the catalogue, customer credit, staff records, and messages to customers or
suppliers. Every other rule in the code serves this one, and **the database enforces it, not only the app.**

```mermaid
flowchart LR
  person["A person, signed in"] -- "direct command, such as a counter sale" --> guard
  agent["An agent, read-only role"] -- "proposes a draft" --> tray["Approval tray"]
  tray -- "a person approves: their identity, one transaction" --> guard
  guard{{"Book guard: a trigger on every books table"}} -- "admitted" --> books[("books.* append-only")]
  guard -- "anything else" --> refused["Refused: MS001"]
  books -- "same statement" --> audit[("Audit chain, per shop")]
  books -- "named read" --> snap[("Snapshot cells")]
  snap --> screen["Screen or answer, or 'Cannot verify'"]
```

| Control                           | What it does                                                                                                                                                                                                                                                                                                                                  | Code                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The agent's role cannot write** | Agents run on their own database role, `munshi_agent`, which reads snapshots and a few name-only views and holds no INSERT, UPDATE or DELETE on any table. An agent reaches the books only by proposing a draft through core.                                                                                                                 | [`db/schema/00_bootstrap.sql`](db/schema/00_bootstrap.sql), [`db/schema/30_agent_views.sql`](db/schema/30_agent_views.sql), [`packages/agent/src/port.ts`](packages/agent/src/port.ts) |
| **The book guard**                | A trigger on every books table admits an insert only for a person's own direct command their role holds, or for an approved decision made in this same transaction by a member allowed to approve it, and only if that command writes this table. Anything else fails with `MS001`. Books are append-only; a correction is an exact reversal. | `books.write()` in [`db/schema/02_shared.sql`](db/schema/02_shared.sql)                                                                                                                |
| **Approval**                      | `proposeDraft` refuses a draft whose numbers are not each mapped to a stored cell. `decide` re-runs every cited read; if anything moved, the draft goes stale instead of running. Otherwise it executes under the approver's identity, with its audit entry, in one transaction.                                                              | [`packages/core/src/approvals.ts`](packages/core/src/approvals.ts)                                                                                                                     |
| **Snapshot cells**                | A screen or an agent gets numbers only through a registered named read, stored as an immutable snapshot of typed cells. Model prose carries references to cells, never free digits.                                                                                                                                                           | [`packages/core/src/snapshots.ts`](packages/core/src/snapshots.ts), [`packages/core/src/queries.ts`](packages/core/src/queries.ts), [`db/schema/06_snap.sql`](db/schema/06_snap.sql)   |
| **Cannot verify**                 | The validator refuses an answer with a digit, a number written as words (English or Hindi), or a cell from another run or shop. The screen then shows "Cannot verify", never the model's text.                                                                                                                                                | [`packages/agent/src/answer.ts`](packages/agent/src/answer.ts), [`packages/core/src/read.ts`](packages/core/src/read.ts)                                                               |
| **Why this number**               | Tap a figure to walk its chain: the cell, the read, the book row, the decision, the approver. A link that cannot be walked says "Cannot verify" where it breaks.                                                                                                                                                                              | [`apps/web/components/WhyChain.tsx`](apps/web/components/WhyChain.tsx)                                                                                                                 |
| **Context from the session only** | Shop and person are set with `SET LOCAL` in one function, `withTx`, from a signed session that only core can construct. No tool schema has a tenant field.                                                                                                                                                                                    | [`packages/core/src/session.ts`](packages/core/src/session.ts)                                                                                                                         |

Each of these protections has a gate test paired with a sabotage case that removes it; the red-proof harness requires
the test to fail under the sabotage and pass without it (see [Testing](#testing)).

## The agent cast

Seven names on screen, each covering some of the database's desks and run kinds
([`apps/web/lib/cast.ts`](apps/web/lib/cast.ts)). The office shows each one's last seven days of runs: proposed,
approved, rejected, abstained and failed. The run log opens any run step by step.

| Agent      | Desk                   | What it does                                                                                                                |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Munshi** | The lead               | Answers questions, typed or spoken; writes the morning brief; runs the watchers; reads answers aloud                        |
| **Tally**  | Stock                  | Counts a shelf from a photo; watches shrinkage, expiry and dead stock; offers near-expiry stock to a recipient ("Offer it") |
| **Ledger** | Money                  | Reads supplier bills (photo or PDF); watches sales, overdue credit, short settlements and staff advances                    |
| **Dash**   | The counter and fixes  | Works the counter's runs; turns a finding into a draft ("Draft the fix") by a fixed recipe, not model output                |
| **Echo**   | Customers              | The inbox: transcribes voice notes, drafts replies and orders from chat; watches orders, bookings and lapsing regulars      |
| **Bloom**  | Packages and campaigns | Writes campaign copy for the owner to edit; watches expiring packages                                                       |
| **Keeper** | Memory                 | Keeps short notes from past decisions (why a draft was rejected, a stated preference); the owner can make it forget         |

A finding offers **Why?** (an explanation that cites its cells), **Draft the fix**, **Snooze** and **Dismiss**. Five
finding kinds have a fix recipe ([`packages/agent/src/recipes.ts`](packages/agent/src/recipes.ts)): a shelf shortage
becomes a reorder; overdue credit becomes a reminder or a PayPal (sandbox) payment link; an expiring package becomes a
reminder or its expiry; an expiring lot becomes a gift to a simulated recipient; and a PayPal payment the books do not
show yet becomes a draft to record it. Every other kind is explained only.

## Feature tour

Every screenshot below is the running demo on synthetic data, captured by
[`scripts/readme-screenshots.mjs`](scripts/readme-screenshots.mjs).

### On a phone

The owner app is built for a phone at the counter first: a bottom bar with Ask in the middle, and the same screens.

<p align="center">
  <img src="docs/images/phone-home.png" alt="Phone: Home with the morning brief's findings and their Why, Draft the fix, Snooze and Dismiss buttons" width="180">
  <img src="docs/images/phone-office.png" alt="Phone: the office scene with the agents at their desks" width="180">
  <img src="docs/images/phone-ask.png" alt="Phone: the Ask screen with the recorded questions it can answer" width="180">
  <img src="docs/images/phone-counter.png" alt="Phone: the counter with the best-selling items to tap" width="180">
</p>
<p align="center">
  <img src="docs/images/phone-credit.png" alt="Phone: the credit book with overdue balances and PayPal sandbox labels" width="180">
  <img src="docs/images/phone-stock.png" alt="Phone: stock running low with suggested reorders from simulated suppliers" width="180">
  <img src="docs/images/phone-more.png" alt="Phone: the More menu listing every hub of the owner app" width="180">
  <img src="docs/images/phone-landing.png" alt="Phone: the product site's first screen with Try the demo" width="180">
</p>

### The morning brief and the approval tray

Home is the morning brief: findings with the most rupees at stake first, each figure a tap away from its source, and the
tray of drafts waiting for you. The owner can leave Keeper a note (words only, no numbers) with a decision.

<img src="docs/images/home.png" alt="Home: the morning brief lists overdue credit, a short UPI settlement and a shelf gap; a reorder draft waits in the tray with Approve and Reject; the source panel shows the credit read behind the circled figure" width="900">

### Every figure has a source: "Why this number"

Tap any figure and the source drawer opens the stored snapshot it was read from, with the cell highlighted. "Why this
number" walks the chain from the figure to the read, the book row, the decision that wrote it and the person who
approved it.

<img src="docs/images/why-this-number.png" alt="The credit book with a balance circled; the source drawer shows the credit.balances snapshot with that cell highlighted and the Why this number chain below it" width="900">

### Ask, in English or Hindi, by voice or in writing

Ask routes a question to one desk (stock, sales or credit), reads the books with named reads only, and narrates an
answer whose every figure is a cell reference. An answer the validator cannot check says "Cannot verify". In recorded
mode the screen offers the questions that have a recorded response and says so.

<img src="docs/images/ask.png" alt="Ask the books: a question box, Ask by voice, and the recorded-mode panel offering the questions with recorded responses" width="900">

### Photos of a shelf and a bill

A shelf photo is matched against the catalogue (the vision role) and counted per product (the segment role); plain code
compares the count with the books and raises a shelf gap. A supplier's bill, photo or PDF, is read into a purchase draft
whose figures are cells of the stored bill; the line text is shown as read, under a note that it is not checked. Only
the photo's sha256 and what the model read are kept. Sample inputs:
[`packages/agent/fixtures/media/`](packages/agent/fixtures/media) (`shelf.png`, `bill.png`).

<img src="docs/images/bills.png" alt="Bills: this month's purchase bills from simulated suppliers, each total a cited figure, with Record a bill by hand" width="900">

<details>
<summary><b>Suppliers and price rises</b></summary>

<img src="docs/images/suppliers.png" alt="Suppliers: a price-rise finding for butter from a simulated supplier, and each supplier's last bill and prices" width="900">

</details>

### The counter and stock

A sale is a direct command recorded under the signed-in person's name. Stock shows what the books hold, how long each
item lasts at recent sales, and a suggested reorder from a (simulated) supplier.

<img src="docs/images/counter.png" alt="The counter: best-selling items, three items added to the bill, payment by cash, UPI or credit, and Record sale" width="900">

<img src="docs/images/stock.png" alt="Stock: items running low, days of cover at recent sales, and suggested reorders from simulated suppliers" width="900">

### Credit with PayPal links (sandbox)

The udhaar book lists who owes what and since when. An overdue balance can get a PayPal payment link, as an approved
draft; the WhatsApp message that carries it is a separate draft. A paid notice writes no book row: it becomes a finding
whose fix drafts the payment. Munshi never moves money, and without sandbox keys the panel says nothing is sent.

<img src="docs/images/credit-paypal.png" alt="The credit book: overdue customers with balances and dates, each with a PayPal sandbox recorded label and a Send PayPal link button" width="900">

### Bookings on a Bryntum Scheduler

For a salon, the calendar has a schedule view (`/app/calendar?view=schedule`). It is drawn with
[Bryntum Scheduler](https://bryntum.com/products/scheduler/): one row per stylist at each branch, or one column per
stylist on a phone. Each bar's colour and label show the booking's state. Each stylist's usual hours and any leave sit
behind their bookings.

Dragging a confirmed booking changes nothing by itself. The board snaps the bar back and shows the move as a dashed
proposal beside it. The proposal is checked against the free slots the roster offers. Only the owner or a manager can
confirm it. A confirmed move is two of the desk's own commands, both under that person's name: book the new slot for
the same customer, then cancel the old booking. Requests are confirmed or declined from the board; they do not move.

The board uses Bryntum's public trial package, `@bryntum/scheduler-trial`, installed from npm under the
`@bryntum/scheduler` alias together with `@bryntum/scheduler-react`. None of Bryntum's code or styles is committed
here. The trial draws a watermark over the board. Bryntum runs only in the browser: the page loads it through
`next/dynamic` with server rendering off, so no server render loads it, and the tests stub its React wrapper.

### The office

The seven agents at their desks, today's brief in the order Munshi ranked it, and each agent's recent runs. The brief
can be read aloud.

<img src="docs/images/office.png" alt="The office scene with the seven agents, the brief board and the approval tray" width="900">

### Inbox and campaigns

The inbox gathers WhatsApp and Instagram messages; Echo drafts replies and orders for approval. Campaigns are composed
by the owner, with Bloom's copy to edit, a test send to yourself, then a draft to approve. An Instagram campaign carries
a picture card; the approval binds the picture's id and sha256, so a changed picture makes the draft stale. Both
screens say "Recorded · nothing is sent" while no channel is live.

<img src="docs/images/campaigns.png" alt="Campaigns: the new-campaign form with a name, the Instagram channel and an audience, labelled recorded, nothing is sent" width="900">

<details>
<summary><b>The inbox</b></summary>

<img src="docs/images/inbox.png" alt="The inbox: waiting and handled messages, labelled recorded, nothing is sent, on synthetic data" width="900">

</details>

### AI staff, the model router and spend

Each desk's model is the owner's pick from the models the operator allowed for this shop. The page shows which model
each desk will actually call, and this month's AI spend, from `ai.spend` rows; a call with no price shows "Cannot
verify", never zero.

<img src="docs/images/ai-staff.png" alt="AI staff: each desk with its current model and a list of allowed models to choose from, and this month's AI spend" width="900">

### Money: growth, reports, settlements and surplus

Growth reads four weeks of sales and payments: peak hours, customers, basket trend, slow movers and payment mix.
Reports show a day's or a week's takings by payment method. Settlements preview a payout statement, or the simulated
payments feed, against the books before a person records it. Surplus tallies near-expiry stock given to simulated
recipients.

<img src="docs/images/growth.png" alt="Growth: the busiest hour by weekday, with bills and takings, each a cited figure" width="900">

<details>
<summary><b>Settlements and surplus</b></summary>

<img src="docs/images/settlements.png" alt="Settlements: a sample statement import and the simulated payments feed, previewed against the books before recording" width="900">

<img src="docs/images/surplus.png" alt="Surplus: near-expiry stock given to simulated recipients, with the all-time tally" width="900">

</details>

### Finding your way, the product site and the operators' console

<img src="docs/images/jump-to.png" alt="The Jump to palette open over Home, listing screens to go to" width="900">

<details>
<summary><b>The product site, the demo picker, the developer docs and the console sign-in</b></summary>

<img src="docs/images/landing.png" alt="The product site: Agents do the books, you approve every change, with Try the demo and the office scene" width="900">

<img src="docs/images/demo-picker.png" alt="The demo picker: four sample shops and a form to make your own sample shop" width="900">

<img src="docs/images/how-it-works.png" alt="How it works: from the counter to an approved change, step by step" width="900">

<img src="docs/images/developers.png" alt="The developer docs for API v1: figures and refs, guides, reference, sandbox and SDK" width="900">

The operators' console (`/platform`) accepts shops, sets model lists, AI features, budgets and channel grants. It is
linked from nowhere, answers 404 unless configured, and needs a password and a TOTP code. Every setting is a proposal
that a later request approves.

<img src="docs/images/console-sign-in.png" alt="The operators' console sign-in: email, password and a six-digit authenticator code" width="900">

</details>

## Architecture

```
apps/web            Next.js 16: the owner app (/app), demo sign-in, product site, operators' console (/platform),
                    the public API (/api/v1), webhooks, the jobs tick. One server process.
apps/sites          the shop websites' shared code (a salon, a boutique), reading the shop through the SDK only
apps/elite          Elite's site, a thin Next.js app over apps/sites, served at /s/elite
apps/prabhave       Prabhave's site, the same, at /s/prabhave
packages/core       the framework-free domain: commands, approvals, snapshots and named reads, watchers, jobs,
                    sessions, the platform, AI switches, caps and spend
packages/agent      the agent flows: ask, shelf photo, bill, voice, read-aloud, inbox, campaign copy, recipes,
                    and the cite-or-abstain validator. Holds only the read-only agent pool
packages/ai         the model provider layer: roles, the model catalogue, adapters, fallback, prices, recorded
                    fixtures. No database and no agent logic
packages/adapters   channels (WhatsApp, Instagram, recorded), payments (PayPal sandbox), identity (password,
                    Supabase email), cache (memory, Redis), media store, bot check
packages/config     the one config module: reads the environment, checks it at boot, never prints a secret
packages/contracts  API v1 as zod schemas, which generate openapi.json and the SDK's types (pnpm contracts)
packages/sdk        the dependency-free API client
apimatic            the same openapi.json, through APIMatic: TypeScript and Python SDKs and a docs portal (docs/api-sdks.md)
packages/widgets    an embeddable order widget (a web component) built on the SDK
db                  db/schema (the SQL, ordered files 00 to 90), db/seed (synthetic shops), db/test (gates,
                    red-proofs), db/src (dev, build, deploy checks)
```

The package lines are tests, not conventions: source-scanning gates fail if `packages/agent` reaches a core writer, the
app pool or a database URL, if anything but `withTx` names the actor setting, if anything but `mintSnapshot` writes a
snapshot, or if `packages/ai` imports a Munshi package or a database driver.

### System context

```mermaid
flowchart TB
  person["Owner, manager, staff: phone or counter browser"]
  site["Shop website or order widget"]
  hooks_in["WhatsApp, Instagram, PayPal webhooks"]
  cron["Scheduler: hosted cron or the dev ticker"]

  subgraph web["apps/web: one Next.js server process"]
    pages["Pages and server actions"]
    api["/api/v1 public API"]
    hooks["/api/webhooks/*"]
    tick["/api/internal/tick"]
    port["Agent port: one shop, one run"]
  end

  core["packages/core: commands, approvals, named reads, jobs"]
  agent["packages/agent: flows and the validator"]
  ai["packages/ai: roles, catalogue, adapters, fixtures"]
  providers[["Model providers"]]
  pg[("PostgreSQL 17: forced RLS, one role per process")]

  person --> pages
  site --> api
  hooks_in --> hooks
  cron --> tick
  pages --> core
  pages --> agent
  agent --> port
  port --> core
  agent --> ai
  ai -.-> providers
  api --> core
  hooks --> core
  tick --> core
  core --> pg
  port -- "read-only agent role" --> pg
```

There is no separate API service. The agent runs inside the web process, so the shop and the person always come from
the authenticated session, never from a model's argument.

<details>
<summary><b>An approval, step by step</b></summary>

```mermaid
sequenceDiagram
  participant A as Agent run or person
  participant C as core
  participant DB as PostgreSQL
  participant P as Approver
  A->>C: proposeDraft(command, payload, basedOn, payloadRefs)
  C->>DB: check every payload number maps to a cell holding exactly it
  C->>DB: insert approval.draft (proposed)
  Note over DB: waits in the tray
  P->>C: decide(session, draftId, approved)
  C->>DB: lock the draft, re-run each cited read
  alt a cited cell changed
    C->>DB: mark stale, audit, commit
  else unchanged
    C->>DB: insert decision (decided_by = approver)
    C->>DB: SET LOCAL munshi.decision_id
    C->>DB: run the command (the guard admits it and audits each row)
    C->>DB: mark executed, audit, commit
  end
```

The approver is the session's member; `decide` has no other parameter for it. A decision admits writes only in the
transaction that made it, so it cannot be replayed later or by another shop. A command returns the ids of the rows it
wrote, never a number.

</details>

<details>
<summary><b>An Ask question, from words to a cited answer</b></summary>

```mermaid
sequenceDiagram
  participant U as Person
  participant W as apps/web
  participant G as packages/agent
  participant M as Model, via packages/ai
  participant C as core and PostgreSQL
  U->>W: a question, typed or a voice clip
  W->>C: start an ai.run for this member, build the port
  G->>M: router: pick one desk the person may use
  loop at most 8 tool calls, 45 s budget
    G->>M: reason, with that desk's named reads as tools
    M-->>G: call a read by handle, such as item:3
    G->>C: port.read: mint an evidence snapshot
  end
  G->>M: narrate: short segments with cell refs
  G->>C: validator: resolve every ref under RLS
  alt any rule fails
    G-->>W: "Cannot verify" and the rule names
  else every figure is a cell
    G-->>W: the answer, rendered from cells
  end
```

The model never sees a uuid; a tool accepts back only a handle the run showed it. Untrusted text reaches a prompt only
inside delimited data blocks. Traces store kinds, fixed labels, ids and timings, never the question or the model's
words.

</details>

<details>
<summary><b>Model routing and fallback</b></summary>

Agents ask for a **role**, never a model: router, reason, vision, segment (counting boxes in a photo), voice (speech to
text), narrate and speak (text to speech). Meta's models are the default for every role: Muse Spark for router, reason
and vision; SAM 3.1 for segment; Muse Voice Transcribe for voice; Muse Spark Open (on Baseten, or through OpenRouter) for narrate. Meta has no
text-to-speech model, so read-aloud uses Sarvam's Bulbul.

```mermaid
flowchart LR
  call["A model call: agent and role"] --> feat{"Feature on for the shop?"}
  feat -- "no" --> refuse["Refused before the run: the screen says why"]
  feat -- "yes" --> allow{"allow(): AI on, daily caps, monthly budget"}
  allow -- "no" --> refuse
  allow -- "yes" --> chain["1 owner's pick, 2 shop default, 3 build default, 4 Meta-hosted, 5 Gemini, 6 other providers"]
  chain --> mode{"MUNSHI_MODEL_MODE"}
  mode -- "recorded" --> fx["Committed fixture, or an abstention when none exists"]
  mode -- "live" --> prov["Provider adapter: a missing key or a failure moves to the next in the chain"]
  prov --> spend[("ai.spend row, an unknown cost shows 'Cannot verify'")]
```

The database stores aliases only, never a provider's model id. The operator approves the allowed aliases per role and
may narrow them per shop; every list, switch and budget is an approved platform change. The segment role has no other
provider: without Meta's key the shelf count marks items uncounted rather than guessing.

</details>

<details>
<summary><b>The outbox and channels</b></summary>

```mermaid
flowchart LR
  d["Approved draft: reminder, reply, campaign, post"] --> b[("Book message and its delivery, one transaction")]
  b --> s["Outbox sweep: jobs role, every tick or right after an approval"]
  s -- "claim committed first" --> r{"Recheck at send time"}
  r -- "send mode live, credentials, real accepted shop, channel grant, listed recipient, consent, 24-hour window" --> live["WhatsApp Cloud API or Instagram Graph"]
  r -- "anything missing" --> rec["Recorded sender: ids and body hashes only"]
```

A message to a customer or supplier is a book: only a person's command or an approved draft writes it. A delivery that
cannot be sent waits and lapses at its deadline. Outside WhatsApp's 24-hour window, only an approved template with its
exact configured wording goes out. Webhooks verify their signature before parsing and run as `munshi_public` with no
actor: they can store a new inbound message and nothing else.

</details>

<details>
<summary><b>Database roles and row-level security</b></summary>

```mermaid
flowchart TB
  subgraph roles["One login role per process, none is a superuser or bypasses RLS"]
    app["munshi_app: members' requests"]
    agentr["munshi_agent: agent reads"]
    jobs["munshi_jobs: tick, watchers, outbox"]
    pub["munshi_public: API, webhooks, rate counters"]
    idp["munshi_idp: password identity"]
    plat["munshi_platform: operators' console"]
  end
  ctx["withTx: SET LOCAL munshi.tenant_id, actor_id, command"] --> rls{"RLS enabled and forced on every tenant table"}
  app --> ctx
  agentr --> ctx
  jobs --> ctx
  pub --> ctx
  rls --> books[("books: guarded, append-only")]
  rls --> snapt[("snap: immutable cells")]
  rls --> ops[("ops, approval, ai, audit")]
  agentr -.->|"SELECT only: snap and agent_view"| snapt
  plat -.->|"no grant on any shop books"| platform[("platform")]
  owner["munshi_owner owns every object and cannot log in"]
```

`tenant_id` leads every key. With no shop context, every role sees no rows. Policies read
`nullif(current_setting(k, true), '')`, because a pooled connection returns `''` after a `SET LOCAL` transaction ends.
At boot the web app checks that each of its six pools connects as its own role and refuses a database built from other
schema files; until then every route answers 503.

</details>

More: [docs/architecture.md](docs/architecture.md) covers package boundaries, the book guard's seven rules, snapshots,
request flows, webhooks, the jobs tick, caching, the PWA and the public API.

## The data model at a glance

The schema is 30 ordered SQL files, [`db/schema/00_bootstrap.sql`](db/schema/00_bootstrap.sql) to
[`90_seal.sql`](db/schema/90_seal.sql), rebuilt from scratch on every build. Each file has a `.manifest.json` of its
tables, grants, policies and indexes, which the gates hold the built database to; `90_seal.sql` asserts the whole.

```mermaid
flowchart LR
  ref["ref: commands, who holds them, which tables each writes"] --> books
  ops["ops: shops, members, sessions, documents, orders, messages, sites"] --> approval
  approval["approval: draft, decision"] -- "decision admits a write" --> books["books: items, prices, sales, purchases, stock moves, credit, payments, journal, staff, salary, messages"]
  books -- "AFTER trigger, same statement" --> audit["audit: hash-chained log per shop"]
  books -- "named read" --> snap["snap: snapshot cells"]
  snap -- "cited by" --> ai["ai: runs, findings, answers, briefs, spend, memory"]
  snap -- "cited by" --> approval
  platform["platform: operators, changes, model lists, grants, budgets"]
```

| Schema                      | Tables | Holds                                                                                        |
| --------------------------- | -----: | -------------------------------------------------------------------------------------------- |
| `books`                     |     46 | The books: guarded and append-only; corrections are exact reversals                          |
| `ops`                       |     54 | Tenancy, members, sessions, documents, orders, inbound messages, deliveries, sites, evidence |
| `ref`                       |     17 | Global constants: commands, authorities, the tables each command writes, capabilities        |
| `platform`                  |     14 | Operators, platform changes, model allow-lists, channel grants, AI budgets                   |
| `ai`                        |     10 | Runs, traces, findings, answers, briefs, usage, spend, memory                                |
| `idp`                       |      3 | The password identity adapter                                                                |
| `approval`, `audit`, `snap` | 2 each | Drafts and decisions; the audit chain; snapshots and pins                                    |
| `agent_view`                |  views | Names and ids for the agent; no numbers                                                      |

Money is stored in minor units with its currency; quantities in milli-units with their unit; time as `timestamptz`.
Journal entries must balance per currency at commit.

## Security highlights

- **Least privilege, by role.** Eight roles, none a superuser or able to bypass RLS. The agent role holds no write on
  any table; the platform role holds no grant on any shop's books. Every table has an explicit revoke-then-grant block.
- **The guard trusts no setting on its word.** A decision must exist, be approved, belong to this shop, have been made
  in this transaction by a member allowed to approve it, and its command must write this table.
- **Exactly three `SECURITY DEFINER` functions**, each with a pinned `search_path`, EXECUTE revoked from PUBLIC, and
  listed in the seal so a fourth fails the build.
- **Models are untrusted.** Tools are named reads only, a run that reads untrusted text is tainted and may propose only
  the recipe the person tapped, and numbers cannot come from the model.
- **Sessions.** HMAC-signed cookies checked timing-safe and against a live session row; scrypt passwords on one path
  for every failure; lockouts per (email, IP) pair; real shops sign up by a verified email and wait for acceptance.
- **Edges.** Webhook signatures checked before parsing; a per-request CSP nonce with `strict-dynamic`; HSTS; rate
  limits counted in PostgreSQL by keyed hashes; uploads typed by their first bytes; Instagram cards re-encoded without
  metadata.
- **Secrets.** One module reads the environment and its errors name settings, never values; provider keys and bearer
  tokens are scrubbed from every model error.
- **Personal data.** Names reach the agent's views only for sample shops; IPs and emails are stored as keyed hashes;
  photos are not stored; inbound messages are erased after 30 days.

The threat model, every control with its code, and the residual risks: [docs/security.md](docs/security.md). To report
a vulnerability, contact the maintainer privately rather than opening a public issue.

## Testing

```bash
pnpm check                                      # lint, typecheck and every package's tests
pnpm --filter @munshi/db test                   # database gates and core's tests on embedded PostgreSQL 17
cd db && node test/redproof.ts <case names>     # prove named gates fail when their protection is removed
pnpm redproof                                   # every red-proof case (slow; run on a quiet machine)
```

- **The database is never mocked.** Each Vitest run starts an embedded PostgreSQL 17, builds a template from
  `db/schema` as the migrator would on a hosted database, and gives each test file a fresh clone, because row-level
  security, grants and the book guard are what is under test. No Docker, no install.
- **Every gate can fail.** Each of the **1,794** registered sabotage cases in
  [`db/test/v2/sabotage`](db/test/v2/sabotage) breaks exactly one protection (by SQL, a source mutation applied as the
  module loads, or a harness switch) and names the test that must then fail.
  [`db/test/redproof.ts`](db/test/redproof.ts) requires that test to pass clean and fail under the sabotage, judged from
  Vitest's JSON report; a sabotage that did not apply is an error, never a pass. A full run first proves its own error
  branch with 3 planted cases.
- **A failing run exits non-zero**, even though `embedded-postgres` registers an exit hook that calls
  `process.exit(0)` ([`db/test/v2/g8-exit-code.test.ts`](db/test/v2/g8-exit-code.test.ts)).
- **Type-level gates.** A hand-built `Session` and a command result carrying a number each sit under
  `@ts-expect-error`, so `tsc` fails if either ever compiles.

<details>
<summary><b>What is tested, and where</b></summary>

| Where                                                        | Test files | What                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ---------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db/test`                                                    |        144 | Database gates G1 to G13 (no agent writes, the book guard, forced RLS, append-only books, balanced journals, the audit chain, function grants, declared indexes), core's domain on a real database, deploy checks |
| `apps/web/test`                                              |         73 | Screens and server actions rendered from a seeded database; the hero flows; unlinked console; PWA                                                                                                                 |
| `packages/agent/test`                                        |         12 | The validator and its precision corpus (199 clean sentences, 157 attacks, 18 refused on purpose), flows on recorded fixtures                                                                                      |
| `packages/ai/test`                                           |          8 | Adapters, fallback, prices, redaction, recorded probe fixtures                                                                                                                                                    |
| `packages/core/test`                                         |          6 | Unit tests and the boundary gates B0 to B6                                                                                                                                                                        |
| `apps/sites/test`                                            |          8 | The shop sites against the real API on a seeded database; one business per bundle; the two site apps and their deploy settings                                                                                    |
| `packages/adapters`, `contracts`, `config`, `sdk`, `widgets` |         15 | Each package's own tests                                                                                                                                                                                          |
| **Total**                                                    |    **266** | More than 1,400 test cases                                                                                                                                                                                        |

</details>

Details, suites and known flakiness: [docs/testing.md](docs/testing.md).

## Quick start

Needs Node 22 or later and pnpm 11. No Docker, no database to install, and no API key. `redis-server` on your path is
optional; without it the app uses an in-memory cache.

```bash
pnpm install
pnpm dev
```

`pnpm dev` ([`db/src/dev.ts`](db/src/dev.ts)):

1. starts an embedded PostgreSQL 17 in `.run/pg17`, generates its passwords and the session secret under `.run/`, and
   builds the schema from `db/schema`;
2. seeds the synthetic sample shops (Sharma General Store, a kirana with known problems planted; Bansal Super Mart;
   Elite Unisex Salon and Academy; and Prabhave, a boutique), runs their watchers and drafts one reorder;
3. starts the app at http://localhost:3000 in recorded mode, with the jobs ticker, and the two shop sites at
   http://localhost:3150/s/elite and http://localhost:3151/s/prabhave, each with the publishable key just issued for it.

Open http://localhost:3000/demo, pick a shop and a person, and you are in. No password. The operators' console's local
sign-in is written to `.run/dev-operator.json` (never printed).

The kirana's planted problems (stock missing from the shelf, a supplier's price creeping up, overdue credit, a short
settlement, goods near expiry) are worked out by hand in [`db/seed/kirana.answers.json`](db/seed/kirana.answers.json),
so the watchers can be checked against an answer key.

In recorded mode Ask offers the questions that have recorded answers. For the shelf count, the bill reader and voice,
use the synthetic samples in [`packages/agent/fixtures/media/`](packages/agent/fixtures/media) (`shelf.png`,
`bill.png`, `ask-en.wav`, `ask-hi.wav`). Other inputs have no recording, and the screen says so.

<details>
<summary><b>Re-taking the README's screenshots</b></summary>

With `pnpm dev` running, and [playwright-core](https://www.npmjs.com/package/playwright-core) installed anywhere (it
is not a dependency of this repository) and Google Chrome on the machine:

```bash
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core node scripts/readme-screenshots.mjs
```

It refuses to run unless the app answers as a demo deployment, never approves, records or sends anything, and
overwrites the fixed files in `docs/images/`. Set `MUNSHI_SHOT_ELITE` or `MUNSHI_SHOT_PRABHAVE` to a running shop
site's URL to capture it too.

</details>

## Configuration

All settings are environment variables, read in one place ([`packages/config`](packages/config)); the names are in
[`.env.example`](.env.example). **None are needed for the demo.** `pnpm dev` passes your shell's environment to the
app, so to use keys run `node --env-file=.env db/src/dev.ts`.

| Mode (`MUNSHI_MODEL_MODE`) | Behaviour                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recorded` (the default)   | Every model call is answered from a committed fixture; nothing leaves the machine. Screens say "Recorded response". A request with no fixture abstains. The sample shops stay on the business day they were seeded as of (27 Oct 2026 for the kirana, the day the recorded questions were asked), whatever the date; Home, Reports and Ask say "Recorded demo · business day 27 Oct" |
| `live`                     | Calls the providers whose keys are set                                                                                                                                                                                                                                                                                                                                               |
| `record`                   | Calls the providers and saves their answers as fixtures                                                                                                                                                                                                                                                                                                                              |

| To turn on                                                                                       | Set                                                                                                                                                                                        | Without it                                                                 |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Meta's models: Muse Spark (router, reason, vision), SAM 3.1 (shelf count), Muse Voice Transcribe | `MUNSHI_MODEL_MODE=live`, `META_MODEL_API_KEY`                                                                                                                                             | Recorded. The Meta fixtures are hand-written, not recordings               |
| Muse Spark Open on Baseten (narrate)                                                             | `BASETEN_API_KEY`                                                                                                                                                                          | Recorded, or falls back                                                    |
| Muse Spark Open on OpenRouter (narrate)                                                          | `OPENROUTER_API_KEY`                                                                                                                                                                       | Falls back to Muse Spark on Meta's API                                     |
| Gemini, the first fallback after Meta                                                            | `GEMINI_API_KEY`                                                                                                                                                                           | Not called                                                                 |
| Sarvam: read-aloud (Bulbul), speech to text, PDF bills                                           | `SARVAM_API_KEY`                                                                                                                                                                           | Recorded                                                                   |
| Other providers                                                                                  | `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `NVIDIA_API_KEY`                                                                                                                 | Not called                                                                 |
| PayPal sandbox payment links                                                                     | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (`PAYPAL_ENV` must be `sandbox`)                                                                                           | Recorded, labelled on screen; PayPal is never called                       |
| WhatsApp Cloud API                                                                               | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `MUNSHI_PHONE_ROUTE_SECRET`, `MUNSHI_SEND_MODE=live`; optional `WHATSAPP_TEMPLATE_*`  | Sends are recorded (ids and body hashes only)                              |
| Instagram                                                                                        | the `INSTAGRAM_*` settings, `MUNSHI_SEND_MODE=live`, an https `MUNSHI_APP_URL` and a media store                                                                                           | The webhook answers 404; posts are recorded                                |
| Hosted database and real-shop email sign-up                                                      | the role URLs (`DATABASE_URL` and the other `*_DATABASE_URL`), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `MUNSHI_APP_URL`; for pictures `SUPABASE_SECRET_KEY`, `SUPABASE_STORAGE_BUCKET` | Embedded PostgreSQL; on a hosted deployment, no real-shop sign-up          |
| Redis cache                                                                                      | `MUNSHI_CACHE_URL`                                                                                                                                                                         | In-process memory cache (`pnpm dev` starts `redis-server` if it finds one) |
| A kill switch for every model call                                                               | `MUNSHI_AI=off`                                                                                                                                                                            | AI on, subject to each shop's switches and caps                            |

In live mode, a call whose provider has no key, or fails, moves to the next allowed model that has one, in this order:
the owner's pick, the shop's default, the build's default, then Meta-hosted models, then Gemini, then the other
providers. A real WhatsApp or Instagram send needs all of: the channel's credentials, `MUNSHI_SEND_MODE=live`, a real
shop the operator accepted (never a sample shop), the operator's grant for that channel, and, on WhatsApp, a listed
recipient. All are rechecked at send time; anything less is recorded, and the screen says which condition is missing.

## Deployment

The hosted shape is **Supabase** (PostgreSQL 17) plus **Vercel**: one project with three services, the owner app at `/`
and each shop site at `/s/<slug>` on the same domain ([`vercel.json`](vercel.json)), six database URLs with one login
each, TLS verified against a pinned root, and a cron that calls the jobs tick. A site's server reads the API over its
binding to the web app; its browser calls `/api/v1` on its own origin. The layout is built and tested offline; it is not
yet verified on a real Vercel preview.

```mermaid
flowchart LR
  browser["Browsers"] --> vercel
  subgraph vercel["Vercel project"]
    web["web: apps/web"]
    elite["elite: apps/elite at /s/elite"]
    prabhave["prabhave: apps/prabhave at /s/prabhave"]
    cronj["cron: /api/internal/tick"]
  end
  elite -- "server: /api/v1 over the WEB_URL binding" --> web
  prabhave -- "server: /api/v1 over the WEB_URL binding" --> web
  web -- "six role URLs, transaction pooler, TLS verified" --> db[("Supabase PostgreSQL 17")]
```

Bootstrap the roles, build the schema as the migrator, seed, then `scripts/deploy-check.ts` must print
`deploy-check: ok`: it refuses a shared or missing password, a superuser or BYPASSRLS login, a database built from other
schema files, and Supabase API roles that can reach a Munshi schema. Runbooks: [docs/deployment.md](docs/deployment.md),
[`deploy/supabase.md`](deploy/supabase.md), [`deploy/vercel.md`](deploy/vercel.md).

On [Render](https://render.com), the Blueprint [`render.yaml`](render.yaml) runs a cron that calls the jobs tick every
10 minutes (the agents' watchers and morning briefs) and the chat relay as a worker: [docs/deploy-render.md](docs/deploy-render.md).

## Roadmap and limitations

Munshi is honest about what is live, recorded or simulated. The full list is [docs/limitations.md](docs/limitations.md).

| Area              | Today                                                                                                                                                                                        | Next                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Meta's models     | **Not yet called live from this code.** The Meta fixtures are hand-written responses replayed through the real adapter path; some request shapes are marked unverified                       | A live run of every flow on Meta's models, then recorded fixtures from it |
| Other providers   | A live probe passed Gemini, Anthropic, OpenAI, OpenRouter, NVIDIA and Sarvam in their listed roles ([probe record](docs/model-probe-2026-10-31.md)); not yet run live through every app flow | Live runs through each flow                                               |
| Cite-or-abstain   | A word-list filter in English and Hindi that errs toward refusing; it proves every number came from a cell, not that the prose is true                                                       | A broader corpus measured on real model output                            |
| Payments          | Recorded, never processed; PayPal sandbox only; refunds and disputes not handled                                                                                                             |                                                                           |
| Channels          | Recorded unless every live condition holds; Instagram posting tested against fake endpoints; WhatsApp voice-note download not built                                                          | Live sends for an accepted shop                                           |
| Audit chain       | Unkeyed; publishing its head outside the database is planned, not done                                                                                                                       | Publish the chain head                                                    |
| Hosted deployment | Deploy tooling tested offline; a complete hosted run is not yet recorded                                                                                                                     | A recorded end-to-end hosted run                                          |
| Scope             | Kirana, salon and apparel; one time zone and currency per shop; offline is read-only; screen reads not cached                                                                                | Restaurants                                                               |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The review bar is the One Guarantee, and a new or changed gate is not done
until it is red-proved. Architecture decision records live in [docs/decisions](docs/decisions/README.md).

## Licence

Munshi is licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Satvik Sawhney. If you
redistribute Munshi or a work derived from it, keep the [NOTICE](NOTICE) file (or reproduce its attribution), as
section 4(d) of the licence requires.
