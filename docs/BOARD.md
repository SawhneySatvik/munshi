# Munshi — ticket board

Plan: `../hackathon/_meta/PLANS-2026-10-27.md` §2–3 (decisions D-025–D-028 in `../hackathon/_meta/DECISIONS.md`). Rules:
`CLAUDE.md` (read it first; the fresh-code rule and the database rules bind every ticket). Waves run back to back; each
ticket ends with a report of ≤ 300 words to the orchestrator: files changed, each command run with its key output lines,
red-proofs, what you did NOT do. The orchestrator commits.

Shared for every MS ticket:
- Work in `/Users/satviksawhney/Downloads/projects_26/munshi`. Run every `pnpm install/add/remove` through
  `scripts/pnpm-locked.sh` (lanes share one lockfile). Node 22, pnpm 11, TypeScript strict, vitest.
- Product names in data and screens are **generic** ("Glucose biscuits 70 g", "Butter 100 g", "Toor dal 1 kg"), never real
  brands; the shop is "Sharma General Store (synthetic)"; suppliers carry "(simulated)".
- Fresh code: read Munim's docs for design (`../foodops-os/docs/plan/02-schema.md`, `03-architecture.md`,
  `04-agent-framework.md`, `adr/`); open Munim's source only when stuck; never copy a file or paste a block.

---

## Wave 1

### MS-1 · Foundation: database, the guarantee, then the core domain (Opus) — two phases with a stop between

**Territory:** `db/**`, `packages/core/**`, `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, root `package.json` scripts,
root dev tooling (vitest/biome config). Not `packages/agent`, not `design`, not `apps`.

**Phase 1 — schema and guarantee (stop and report after it; an Opus guarantee review runs before phase 2):**
1. `docs/ARCHITECTURE.md` (≤ 2 pages): the parts and the trust boundary. One Next.js app (`apps/web`) whose route
   handlers call `packages/core`; the agent runs in the same server but queries Postgres only through a pool connected as
   the read-only `munshi_agent` role, and proposes drafts only through core functions. No separate API service, no run
   tokens. Snapshot cells, drafts, decisions, the book guard, the audit chain, editions (meta | paytm) in config.
2. `docs/SCHEMA.md` + `db/migrations/0001_*.sql …` (plain SQL, applied in order by a small runner in `db/src/migrate.ts`):
   - Roles: `munshi_owner` (owns everything, NOLOGIN), `munshi_migrator`, `munshi_app` (the API), `munshi_agent`
     (SELECT on `snap.*` and on named read views only; no write grant anywhere).
   - Schemas: `ops` (tenant, shop, member + role, command_authority, photo/document metadata, finding, run trace),
     `books` (item, price, stock_move, supplier, purchase + purchase_line, sale + sale_line, payment (recorded),
     customer, credit_entry (udhaar), journal_entry + journal_line, staff, attendance, outbound_message),
     `approval` (draft: command type + payload + `based_on` snapshot refs + status; decision: verdict, decided_by, reason,
     `created_txid`), `snap` (snapshot: query name, params, actor/run, created_at; snapshot_cell: snapshot id, row, col,
     typed value), `audit` (audit_log, append-only, hash-chained per tenant).
   - `tenant_id` leads every key; RLS enabled **and forced** on every tenant table; context only via `SET LOCAL`
     (`munshi.tenant_id`, `munshi.actor_id`, `munshi.decision_id`, `munshi.command`).
   - **Book guard** (trigger on every `books` table, every write): admits a write only if (a) `munshi.decision_id` names a
     decision row that exists, is `approved`, has the same tenant and `created_txid = txid_current()`; or (b)
     `munshi.command` is a direct command the actor's role holds in `ops.command_authority` for that tenant (e.g.
     `sale.record` for counter staff). Anything else raises. Books are append-only: no UPDATE/DELETE grants; corrections
     are reversal rows with reason and actor.
   - Journal entries balance per currency at commit (deferred constraint trigger).
   - `audit.verify_chain(tenant)` returns the first broken link or NULL.
   - Explicit revoke-then-grant block per table; `REVOKE EXECUTE … FROM PUBLIC` per function; indexes asserted in
     `pg_index` by a test.
3. `db/test/` harness on `embedded-postgres` (a fresh database per test file) and these tests, **each red-proved**
   (show it failing when the guard is broken, then passing):
   - G1 the agent role is refused INSERT/UPDATE/DELETE on every table; the count of tables checked equals the count in
     the migrations' table manifest (a positive number from an independent source).
   - G2 a book write is refused with: no context; a decision of another tenant; a decision from an earlier transaction; a
     rejected decision. Allowed with an approved decision created in this transaction.
   - G3 direct command allowed for an authorised member; refused for a member without that authority and for a member
     of another tenant.
   - G4 RLS: tenant A can neither read nor write tenant B's rows, on every tenant table (count asserted).
   - G5 UPDATE/DELETE on books refused for `munshi_app`.
   - G6 an unbalanced journal entry fails at commit; a balanced one commits.
   - G7 `audit.verify_chain` finds a tampered row (tampered as owner).
   - G8 a deliberately failing test makes the test process exit non-zero (the embedded-postgres exit hook).
   - G9 no function in the `munshi` schemas grants EXECUTE to PUBLIC.
   - G10 every declared index exists in `pg_index` with its columns.
4. Root scripts: `pnpm check` = lint + typecheck + test. **Done when:** `pnpm check` is green; each of G1–G10 shown red
   then green in the report; then **STOP and report**.

**Phase 2 — core domain, seed, watchers (starts only after the orchestrator says the guarantee review passed):**
5. `packages/core`: money (minor units + currency), time (`Asia/Kolkata`, one module), commands (counter sale,
   purchase from a bill, stock count adjustment, waste, credit entry, payment recorded, reorder), approvals
   (`proposeDraft`, `decide` → executes the command under the approver's identity in one transaction with its audit
   entry; re-checks `based_on` cells and marks the draft `stale` if the evidence changed), snapshots (`mintSnapshot(name,
   params)` runs a named read and stores its cells; `resolveRef`).
6. Seed: `db/seed/kirana.ts` builds "Sharma General Store (synthetic)": 60 generic SKUs, 90 days of sales, purchases from
   3 simulated distributors with bills, 25 credit customers, 4 staff. **Planted situations** with an answer key
   (`db/seed/kirana.answers.json`): shelf shrinkage on 2 SKUs, a distributor price creep on 1 SKU, stock expiring within 7
   days, 3 overdue credit customers, a short UPI settlement on 1 day. One command reseeds in under 60 s.
7. Watchers: deterministic SQL detectors, one per planted kind, writing `ops.finding` with snapshot refs; a finding is not
   raised twice for the same situation.
8. **Done when:** `pnpm check` green; the watcher test finds 5 of 5 plants and red-proves (remove a plant → the test
   fails); a draft approved by the owner executes and its audit chain verifies; a draft whose evidence changed goes
   `stale`.

### MS-2 · Visual direction: the owner's home screen, two directions (Opus)

**Territory:** `design/**` only. No npm installs: static HTML + CSS (+ inline SVG), screenshots with headless Chrome
(`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=… --window-size=390,844 …`).
Load the `impeccable` or `frontend-design` skill first. Original art only (CSS/SVG drawn), no stock images, no icon packs
copied in.

**The screen (same content in both directions):** the owner's phone home for "Sharma General Store (synthetic)":
- Header: shop name, date, a Hindi/English toggle, a "Synthetic data" label.
- Morning brief, 3 cards, each number with a small source chip:
  1. Shelf count gap: "Glucose biscuits 70 g: books say 24, shelf shows 18", with a drawn shelf thumbnail and boxes on the
     gaps.
  2. Bill price rise: "Butter 100 g: ₹56 → ₹60 a unit on Gupta Traders' bill (simulated supplier)".
  3. Overdue credit: "3 customers owe ₹2,350 for more than 30 days".
- A draft awaiting approval: "Reorder 48 × Glucose biscuits 70 g from Gupta Traders (simulated)", Approve / Reject.
- A large voice button: "बोलकर पूछें · Ask by voice".
- One "Cannot verify" example on a line whose number has no source.

**Deliver:** `design/a/index.html`, `design/b/index.html` (two clearly different directions: type, colour, density,
layout), screenshots `design/shots/{a,b}-390.png` (390×844) and `{a,b}-1280.png` (1280×800), and `design/NOTES.md` (one
paragraph per direction: its idea and what it is good at). Tap targets ≥ 48 px; text ≥ 16 px for inputs; contrast ≥ 4.5:1.
**Done when:** the four PNGs exist and you have looked at each one (read the image) and fixed anything clipped or
overlapping. The founder chooses; no other UI is built until then.

### MS-3 · Model adapters by role (Sonnet)

**Territory:** `packages/agent/**`, `scripts/meta-smoke.ts`, `packages/agent/fixtures/**`. Not `.env.example` (it exists;
report any new name you need).

1. `packages/agent/src/providers/types.ts`: `Role` = router | reason | vision | segment | voice | narrate; `ProviderId` =
   meta | baseten | nebius | gemini | openrouter | sarvam; request/result types for `generate` (messages, optional tools,
   optional JSON schema → text | tool calls | parsed JSON, usage tokens, provider id, model id, latency), `segment`
   (image + noun phrase or boxes → matches with box, mask, score), `transcribe` (16-bit mono WAV + optional language →
   text, language).
2. `config.ts`: editions → role map. `meta`: router, reason, vision = `muse-spark-1.3` on meta; segment = `sam-3.1`;
   voice = `muse-voice-transcribe-1.0`; narrate = Muse Spark Open on baseten (`meta-models/muse-spark-open-1026`).
   `paytm`: a placeholder map on gemini/nebius/sarvam, marked TODO for the Paytm edition. Unknown role/provider → error.
3. Adapters: one OpenAI-compatible adapter (the `openai` npm package with a per-provider base URL; the Responses API for
   meta, Chat Completions where a provider lacks Responses) covering meta (`https://api.meta.ai/v1`), baseten, nebius
   (Token Factory — take the base URL from `../foodops-intel/services/intel/munim_intel/llm/providers.py`, the value
   only), gemini (`https://generativelanguage.googleapis.com/v1beta/openai/`), openrouter (`https://openrouter.ai/api/v1`);
   `meta-sam.ts` (`sam-3.1`); `meta-voice.ts` (`POST /v1/asr/transcribe`). Verify each base URL and request shape against
   the provider's current docs (Meta's captures: `../hackathon/meta-ai-developer-hackathon/raw/2026-10-27/tech/`); mark
   anything unverified in a comment.
4. Strict JSON-schema output validated with zod; tool calls normalised; 429/5xx retried 3 times with exponential backoff
   and jitter; per-role timeouts; every error message redacts keys (keys read from `process.env` names in `.env.example`).
5. Record/replay: `MUNSHI_MODEL_MODE` = live | recorded | record; fixtures keyed by the sha256 of the canonical request,
   under `packages/agent/fixtures/`. Tests run recorded (hand-written synthetic fixtures until a key exists).
6. `scripts/meta-smoke.ts` (the M0 gate): calls `muse-spark-1.3` once with a tool and a JSON schema, `sam-3.1` once on a
   committed synthetic shelf image (`packages/agent/fixtures/smoke/shelf.png`, drawn by you: identical packets on shelves)
   with a noun phrase, `muse-voice-transcribe-1.0` once on a committed synthetic Hindi clip (`fixtures/smoke/hindi.wav`,
   made with macOS `say -v Lekha` then `afconvert` to 16 kHz mono 16-bit WAV); prints PASS/FAIL per model with model id
   and latency; exits non-zero on any FAIL; never prints a key. Baseten checked only if its key is set.
7. **Done when:** `pnpm --filter @munshi/agent test` green; red-proofs: a key planted in an error is redacted (test fails
   if redaction is removed); a schema-violating fixture is refused; a role missing from an edition fails the config test.
   `scripts/meta-smoke.ts` run without a key prints FAIL for each model and exits non-zero (show it).
