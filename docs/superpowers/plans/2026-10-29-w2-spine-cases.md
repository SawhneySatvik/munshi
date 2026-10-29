# The spine's stranded v1 red-proof cases (SPINE-0)

Measured 29 Oct at `d47cb2a` by importing `db/test/sabotage.ts`'s `CASES` (283 cases). **87** strand when the spine
moves its test files or rewrites the source they patch:

- **W:** 28 cases. Their tests move with SPINE-W, or they patch W's files.
- **R:** 59 cases. Their tests move with SPINE-R, or they patch R's files.
- **V:** none. The web suite has no v1 cases; SPINE-V adds SQL1's case.

Two cases patch `packages/core/src/session.ts`: `c2-raw-error` and `c4-session-inactive`. The spine doesn't touch that
file, so these move to v2 with the same mutation.

**What each lane does with a case it owns:**
1. Re-create it in `db/test/v2/sabotage/core-<area>.ts` against the moved test. Use the same sabotage name with a
   `v2-` prefix, unless the gate's text changed.
2. List it in the report as `v1 name → v2 name`. Or retire it with a reason, for a check v2's schema gates already
   prove.

At integration the orchestrator deletes the 87 cases from `db/test/sabotage.ts`. BP-JOBS-1 then added one v1 case,
`b4-jobs-insert`, to the boundary test. That test stays in place, so the case doesn't strand. **Expected v1 count after the
spine: 284 − 87 = 197.**

| Lane | Case | Test file (v1) | Patches | Gate |
|---|---|---|---|---|
| W | `c4-two-open-drafts` | `db/test/c4-approvals.test.ts` | SQL | C4 a finding has at most one open draft: a second proposal conflicts until the first is de |
| W | `c1-stored-total` | `db/test/c1-commands.test.ts` | `packages/core/src/commands-sale.ts` | C1 a counter sale is priced from the books, takes the rest as credit, balances and is audi |
| W | `c1-overpayment` | `db/test/c1-commands.test.ts` | `packages/core/src/commands-sale.ts` | C1 a sale paying more than the books price is refused, and an unpaid rest needs a customer |
| W | `c1-count-not-rederived` | `db/test/c1-commands.test.ts` | `packages/core/src/commands.ts` | C1 a stock count writes the difference from the books as one adjustment, and nothing when  |
| W | `c1-result-number` | `db/test/c1-commands.test.ts` | `packages/core/src/commands.ts` | C1 a command result carrying a number is refused: a number to show comes from a snapshot c |
| W | `c2-raw-error` | `db/test/c2-errors.test.ts` | `packages/core/src/session.ts` | C2 a database error reaches the caller as a code, never with row values |
| R | `c3-any-name` | `db/test/c3-snapshots.test.ts` | `packages/core/src/snapshots.ts` | C3 an unregistered name is refused and writes nothing |
| R | `c3-read-writable` | `db/test/c3-snapshots.test.ts` | `packages/core/src/snapshots.ts` | C3 a named read cannot write, even a registered one |
| R | `c3-cell-leak` | `db/test/c3-snapshots.test.ts` | SQL | C3 a ref resolves only in its own tenant; anything else is 'Cannot verify' |
| R | `c3-actor-unstamped` | `db/test/c3-snapshots.test.ts` | SQL | C3 a snapshot's actor is stamped by the database: the minting member, or none for a system |
| W | `c4-no-decision` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a draft approved by the owner executes under the owner in one transaction, and its audi |
| W | `c4-no-recheck` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a draft whose evidence changed goes stale, and nothing executes |
| W | `c4-no-recheck` | `db/test/c4-approvals.test.ts` | — | C4 a write-off recorded after a watcher's as_of makes a draft cited from it stale |
| W | `c4-unchecked-refs` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a draft must cite cells that exist in this tenant, and a payload its command accepts |
| W | `c4-empty-basedon` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 every number in a draft's payload is mapped to a cell of its kind holding that number,  |
| W | `c4-payload-unmapped` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 every number in a draft's payload is mapped to a cell of its kind holding that number,  |
| W | `c4-payload-value` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 every number in a draft's payload is mapped to a cell of its kind holding that number,  |
| W | `c4-payload-kind` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 every number in a draft's payload is mapped to a cell of its kind holding that number,  |
| W | `c4-payload-unchecked` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a cell a payload number came from is re-checked at approval like basedOn |
| W | `c4-dated-evidence` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a stock or money draft must cite the current on-hand of every item it names; a watcher' |
| W | `c4-any-item` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a stock or money draft must cite the current on-hand of every item it names; a watcher' |
| W | `c4-no-item-needed` | `db/test/c4-approvals.test.ts` | `packages/core/src/approvals.ts` | C4 a stock or money draft must cite the current on-hand of every item it names; a watcher' |
| W | `c4-reject-authority` | `db/test/c4-approvals.test.ts` | SQL | C4 only an active member allowed to approve a command may reject it or have it marked stal |
| W | `c4-reject-inactive` | `db/test/c4-approvals.test.ts` | SQL | C4 only an active member allowed to approve a command may reject it or have it marked stal |
| W | `c4-stale-authority` | `db/test/c4-approvals.test.ts` | SQL | C4 only an active member allowed to approve a command may reject it or have it marked stal |
| W | `c4-stale-inactive` | `db/test/c4-approvals.test.ts` | SQL | C4 only an active member allowed to approve a command may reject it or have it marked stal |
| W | `c4-session-inactive` | `db/test/c4-approvals.test.ts` | `packages/core/src/session.ts` | C4 a Session opens only for an active member of its own tenant |
| R | `c5-omit-shrinkage` | `db/test/c5-watchers.test.ts` | — | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-omit-price_creep` | `db/test/c5-watchers.test.ts` | — | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-omit-expiry` | `db/test/c5-watchers.test.ts` | — | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-omit-overdue_credit` | `db/test/c5-watchers.test.ts` | — | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-omit-short_settlement` | `db/test/c5-watchers.test.ts` | — | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-shrinkage-threshold` | `db/test/c5-watchers.test.ts` | `packages/core/src/queries.ts` | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-creep-threshold` | `db/test/c5-watchers.test.ts` | `packages/core/src/queries.ts` | C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else |
| R | `c5-dedupe-per-run` | `db/test/c5-watchers.test.ts` | `packages/core/src/watchers.ts` | C5 re-running the watchers raises nothing twice, the same day or the next |
| R | `c5-dedupe-drifts` | `db/test/c5-watchers.test.ts` | `packages/core/src/watchers.ts` | C5 re-running the watchers raises nothing twice, the same day or the next |
| R | `c5-watcher-actor` | `db/test/c5-watchers.test.ts` | `packages/core/src/watchers.ts` | C5 watchers run with no actor and write no book row |
| R | `h1-count-unhashed` | `db/test/h1-shelf-count.test.ts` | SQL | H1 a forged count is refused: a response edited after it was hashed, or a count that is no |
| R | `h1-count-unmatched` | `db/test/h1-shelf-count.test.ts` | SQL | H1 a forged count is refused: a response edited after it was hashed, or a count that is no |
| R | `h1-evidence-optional` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/approvals.ts` | H1 the count draft needs both cells: the count of that item from count.shelf, and its on-h |
| R | `h1-evidence-any-read` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/approvals.ts` | H1 the count draft needs both cells: the count of that item from count.shelf, and its on-h |
| R | `h1-evidence-any-item` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/approvals.ts` | H1 the count draft needs both cells: the count of that item from count.shelf, and its on-h |
| R | `h1-evidence-any-item` | `db/test/h2-bill-read.test.ts` | — | H2 an unmatched bill line never becomes a book line |
| R | `h1-expected-unchecked` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/commands.ts` | H1 the count draft needs both cells: the count of that item from count.shelf, and its on-h |
| W | `h1-expected-unchecked` | `db/test/c7-current-state.test.ts` | — | C7 a count waits for a write-off in flight, so it never states books that have just change |
| R | `h1-any-photo` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/photo.ts` | H1 only a still photo is sent: anything else is refused before any model is asked |
| R | `h2-unplaced-sent` | `db/test/h2-bill-read.test.ts` | `packages/agent/src/bill.ts` | H2 a bill number with no page position is refused |
| R | `h2-unplaced-stored` | `db/test/h2-bill-read.test.ts` | SQL | H2 a bill number with no page position is refused |
| R | `h2-late-line` | `db/test/h2-bill-read.test.ts` | SQL | H2 a bill's lines are accepted only in the transaction that read it |
| R | `h2-ambiguous-match` | `db/test/h2-bill-read.test.ts` | `packages/core/src/commands.ts` | H2 a line's text is matched by plain code: one item's exact name or alias, else none |
| R | `h3-transcript-traced` | `db/test/h3-voice.test.ts` | `packages/agent/src/voice.ts` | H3 the voice transcript never appears in a trace |
| W | `c7-waste-below-zero` | `db/test/c7-current-state.test.ts` | `packages/core/src/commands.ts` | C7 a write-off cannot take on-hand below zero |
| W | `c7-count-below-zero` | `db/test/c7-current-state.test.ts` | `packages/core/src/commands.ts` | C7 a count in the past cannot take on-hand below zero once the moves after it are added |
| W | `c7-count-unlocked` | `db/test/c7-current-state.test.ts` | `packages/core/src/commands.ts` | C7 a count waits for a write-off in flight, so it never states books that have just change |
| W | `c7-credit-not-current` | `db/test/c7-current-state.test.ts` | `packages/core/src/approvals.ts` | C7 a credit draft cites the customer's current balance from credit.balance, and goes stale |
| R | `b0-walk-skips-fixtures` | `packages/core/test/boundary.test.ts` | `packages/core/test/boundary.test.ts` | B0 the import scanner sees every form of import, follows them to their files, and lets the |
| R | `b0-walk-no-mts` | `packages/core/test/boundary.test.ts` | `packages/core/test/boundary.test.ts` | B0 the import scanner sees every form of import, follows them to their files, and lets the |
| R | `b0-no-follow` | `packages/core/test/boundary.test.ts` | `packages/core/test/boundary.test.ts` | B0 the import scanner sees every form of import, follows them to their files, and lets the |
| R | `b0-no-follow-read` | `packages/core/test/boundary.test.ts` | `packages/core/test/boundary.test.ts` | B0 the import scanner sees every form of import, follows them to their files, and lets the |
| R | `fc1-unit-not-rendered` | `packages/agent/test/answer.test.ts` | `packages/core/src/read.ts` | FC1 a money cell renders with its currency sign and a quantity cell with its unit |
| R | `fc1-stale-finding` | `db/test/a1-agent.test.ts` | `packages/agent/src/run.ts` | A1 a finding the latest watcher run still sees stays current; one it no longer sees is ref |
| R | `fc1-dedupe-not-current` | `db/test/a1-agent.test.ts` | `packages/core/src/watchers.ts` | A1 a finding the latest watcher run still sees stays current; one it no longer sees is ref |
| R | `fc1-closed-finding` | `db/test/a1-agent.test.ts` | `packages/agent/src/run.ts` | A1 a dismissed or resolved finding is neither explained nor drafted |
| R | `h1-shelf-raw-names` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/shelf.ts` | H1 a catalogue name cannot forge a catalogue line: names reach the vision model quoted and |
| R | `h1-shelf-unescaped` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/shelf.ts` | H1 a catalogue name cannot forge a catalogue line: names reach the vision model quoted and |
| R | `vision-tools-offered` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/photo.ts` | H1 the vision call is quarantined: no tools are offered, and an answer with a tool call is |
| R | `vision-tool-call-used` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/photo.ts` | H1 the vision call is quarantined: no tools are offered, and an answer with a tool call is |
| R | `vision-tools-offered` | `db/test/h2-bill-read.test.ts` | `packages/agent/src/photo.ts` | H2 the vision call is quarantined: no tools are offered, and an answer with a tool call is |
| R | `vision-tool-call-used` | `db/test/h2-bill-read.test.ts` | `packages/agent/src/photo.ts` | H2 the vision call is quarantined: no tools are offered, and an answer with a tool call is |
| R | `h1-phrase-digits` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/shelf.ts` | H1 a phrase for a product outside the catalogue leaves the agent with no figure in it |
| R | `h1-phrase-words` | `db/test/h1-shelf-count.test.ts` | `packages/agent/src/shelf.ts` | H1 a phrase for a product outside the catalogue leaves the agent with no figure in it |
| R | `h1-count-age-proposal` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/approvals.ts` | H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by def |
| R | `h1-count-age-approval` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/approvals.ts` | H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by def |
| R | `h1-count-age-default` | `db/test/h1-shelf-count.test.ts` | SQL | H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by def |
| R | `h1-count-stamp-now` | `db/test/h1-shelf-count.test.ts` | `packages/core/src/queries-count.ts` | H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by def |
| R | `h1-count-writer-elsewhere` | `db/test/h1-shelf-count.test.ts` | — | H1 only the shelf flow stores a count: the port's recordCount is called only in shelf.ts w |
| R | `h1-count-binding-forged` | `db/test/h1-shelf-count.test.ts` | — | H1 only the shelf flow stores a count: the port's recordCount is called only in shelf.ts w |
| R | `h1-count-core-elsewhere` | `db/test/h1-shelf-count.test.ts` | — | H1 only the shelf flow stores a count: the port's recordCount is called only in shelf.ts w |
| R | `h2-bill-header-supplier` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `h2-bill-header-number` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `h2-bill-header-date` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `h2-bill-line-split` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `h2-bill-line-twice` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `h2-bill-two-reads` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's |
| R | `ms12-bill-twice-approval` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill read backs one executed purchase: a second draft of it goes stale at approval, a |
| R | `ms12-bill-twice-proposal` | `db/test/h2-bill-read.test.ts` | `packages/core/src/approvals.ts` | H2 a bill read backs one executed purchase: a second draft of it goes stale at approval, a |
| R | `fc1-second-draft` | `db/test/a1-agent.test.ts` | `packages/agent/src/run.ts` | A1 one draft per finding awaits a decision: draftFix proposes no second one |
