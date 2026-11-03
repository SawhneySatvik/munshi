# Security

Munshi's security model exists to hold one promise: **nothing changes the books without a named person's approval, and
every number shown traces to a ledger row.** This page states what we defend, against whom, the controls in the code,
and what is not covered. The database and boundary controls below are held by gate tests, each paired with a sabotage
case that removes the control and must turn the test red (see [testing.md](testing.md)).

To report a vulnerability, contact the maintainer privately rather than opening a public issue.

- [Assets and threats](#assets-and-threats)
- [Database: roles, grants and row-level security](#database-roles-grants-and-row-level-security)
- [The decision guard](#the-decision-guard)
- [Security-definer functions](#security-definer-functions)
- [Agents and untrusted text](#agents-and-untrusted-text)
- [Sessions and sign-in](#sessions-and-sign-in)
- [Rate limits](#rate-limits)
- [Webhooks](#webhooks)
- [HTTP headers and CSP](#http-headers-and-csp)
- [Secrets and redaction](#secrets-and-redaction)
- [Personal data](#personal-data)
- [The superadmin console](#the-superadmin-console)
- [Residual risks](#residual-risks)

## Assets and threats

| Asset | Threat we design against |
|---|---|
| **The books** (ledgers, stock, prices, catalogue, credit, staff records, outbound messages) | An agent or a model writing them; a person writing what their role does not allow; one shop reaching another's rows; a replayed or forged approval; silent edits after the fact |
| **Figures on screen** | A model inventing or altering a number; a figure with no source |
| **Customers' and staff's personal data** | Leaking to another shop, to a model provider, into logs or traces |
| **Secrets** (database passwords, session and identity keys, provider keys, channel tokens) | Appearing in logs, errors, traces or the browser |
| **Operator powers** (accepting shops, model lists, channel grants) | Use by anyone but a signed-in operator with a second factor |

Adversaries considered: a model following instructions planted in a customer's message or a supplier's bill; a shop
member acting beyond their role; a member of another shop; an anonymous caller of the public API or a webhook; a
stolen or forged cookie. A compromised application server or database superuser is out of scope (see
[Residual risks](#residual-risks)).

## Database: roles, grants and row-level security

**One role per process, least privilege.** [`db/schema/00_bootstrap.sql`](../db/schema/00_bootstrap.sql) creates eight
roles; none is a superuser, bypasses RLS, creates roles or databases, or replicates. `munshi_owner` owns every object
and cannot log in. The runtime roles own nothing.

| Role | Can write | Cannot |
|---|---|---|
| `munshi_app` | Books (only through the guard), ops, approvals, snapshots, audit | UPDATE or DELETE a book row |
| `munshi_agent` | Nothing | INSERT, UPDATE, DELETE, TRUNCATE on any table; create temporary tables, objects or large objects (gate G1) |
| `munshi_jobs` | Findings, briefs, deliveries' status, purges | Write a book row |
| `munshi_public` | New inbound messages (no actor), API requests, rate counters | Read amounts or names in the books: it reads only the columns the public API needs (item kinds, shift and leave days for slots, order codes and steps); figures reach it as published snapshot cells |
| `munshi_idp` | Its own `idp` tables | Read shop data: outside `idp` it reads only sign-in rows (a login's provider and subject, reset grants) |
| `munshi_platform` | Platform changes | Read or write any shop's books, approvals, snapshots or audit chain |

Every table has an explicit revoke-then-grant block, and each schema file's `.manifest.json` lists the exact grants,
policies and indexes. Gates check the built database against the manifests: no undeclared grant, no missing index
(G9, G10, G13). Functions do not keep PUBLIC's default EXECUTE: each is revoked by name, and
[`90_seal.sql`](../db/schema/90_seal.sql) fails the build if any function is executable by PUBLIC or lacks a pinned
`search_path`.

**Forced row-level security.** `tenant_id` leads every key, and RLS is enabled **and forced** on every tenant table,
so the owner, and every view, also sees only the current shop. With no shop context, any role sees no rows (G4).

**Context only by `SET LOCAL`.** Shop, actor, command and decision are transaction-local settings, set in one function,
`withTx` ([`packages/core/src/session.ts`](../packages/core/src/session.ts)). A source-scanning gate (B3) fails if any
other shipped file names the actor setting. Readers use `nullif(current_setting(k, true), '')` because a pooled
connection returns `''` once a `SET LOCAL` transaction ends.

**Boot refuses a dangerous connection.** The web app checks each pool's role before serving: not a superuser, no
BYPASSRLS, the expected role name ([`apps/web/lib/server/db.ts`](../apps/web/lib/server/db.ts)). It also refuses a
database built from other schema files, and a `MUNSHI_DEPLOYMENT` that does not match the database's own record.

## The decision guard

Any role can set any custom setting, so the guard trusts no setting on its own word. `books.write()` in
[`db/schema/02_shared.sql`](../db/schema/02_shared.sql) admits a book insert only if:

- the writer is `munshi_app`, the row is for the current shop, and the shop is open; and
- **either** `munshi.decision_id` names a decision that exists, is approved, belongs to this shop, was created **in
  this transaction** (`created_txid = txid_current()`, stamped by a trigger the caller cannot override), was made by
  the acting member, and that member is active with a role allowed to approve the draft's command;
- **or** `munshi.command` is a direct command the acting member's role holds and that is not draft-only;
- **and** that command writes this table.

The guard stamps the author, decision and time itself, refuses every UPDATE and DELETE (the only delete is the owner
role resetting a sandbox shop), accepts a child row only in its parent's transaction, and accepts a reversal only as
the exact negation of an unreversed original. Every book row gets an audit entry in the same statement.

**What it trusts.** The acting member (`munshi.actor_id`) is trusted from the app, because the database cannot see who
is at the keyboard. That trust is narrowed in code: the actor is set only in `withTx`, only from a `Session` that only
core can construct (a branded type; a hand-built one does not type-check), `decide()` runs only on the approver's own
request, watchers and agent runs carry no actor, and `packages/agent` cannot import the app's pool (gate B1).

## Security-definer functions

Functions run with the caller's rights by default. Exactly three are `SECURITY DEFINER`, each owned by `munshi_owner`,
with `search_path` pinned to `pg_catalog, pg_temp`, EXECUTE revoked from PUBLIC and granted to named roles only, and
listed in the seal so a fourth fails the build (G9).

| Function | Granted to | Why it is safe |
|---|---|---|
| `platform.count_ai_call(day, cap)` ([`22_ai_controls.sql`](../db/schema/22_ai_controls.sql)) | `munshi_app`, `munshi_jobs` | Increments one deployment-wide daily counter up to a validated cap and returns a boolean. It reads and writes nothing else |
| `ops.inbound_open(tenant)` ([`19_messaging.sql`](../db/schema/19_messaging.sql)) | `munshi_public` | Returns one boolean: whether the named shop, which must match the transaction's own shop setting, is open for messages. A caller holding a shop id can learn whether that shop has been accepted; this is accepted as low sensitivity and is not a boundary |
| `platform.purge_grants(tenant)` ([`09_idp_platform.sql`](../db/schema/09_idp_platform.sql)) | `munshi_jobs` | Only revokes channel grants, only for a sign-up that has lapsed, under its own shop context with no actor; it takes the platform lock before the shop lock, as approvals do, so it cannot deadlock with one |

## Agents and untrusted text

A model is treated as an untrusted component that may follow instructions hidden in a customer's message or a bill.

- **No write path.** Agent reads run as `munshi_agent`, which can write nothing. Everything else an agent does goes
  through a port bound to one shop and one run ([`apps/web/lib/server/agent-port.ts`](../apps/web/lib/server/agent-port.ts));
  its only route to the books is a draft that waits for a person.
- **Tools are named reads.** There is no free SQL. A model never sees a uuid; a tool takes back only a handle the run
  showed it. The person's role decides which reads and desks the run may use, and core refuses any other read too.
- **Tainted runs.** A run that reads untrusted text (a customer's words, a bill's lines) is marked tainted and may
  propose only the one recipe the person tapped ([`packages/agent/src/port.ts`](../packages/agent/src/port.ts)).
  Untrusted text reaches a prompt only inside delimited data blocks with control and bracket characters escaped. The
  vision call is offered no tools; an answer that tries one is discarded.
- **Numbers cannot come from the model.** A draft's numbers must each map to a stored cell holding exactly that number;
  an answer with a free digit or number word becomes "Cannot verify" ([`packages/agent/src/answer.ts`](../packages/agent/src/answer.ts)).
- **Traces hold no content.** Traces keep kinds, fixed labels, ids and timings; a label outside the fixed lists is
  stored as `unlisted` and a non-uuid id is dropped.

## Sessions and sign-in

- **Member cookie** `munshi_session` ([`apps/web/lib/server/session.ts`](../apps/web/lib/server/session.ts)): an
  HMAC-SHA-256-signed claim (shop, member, session row, how it was opened, expiry) under `MUNSHI_SESSION_SECRET`,
  verified timing-safe. `httpOnly`, `SameSite=Lax`, `Secure` in production. The server then checks the session row is
  not revoked or expired, the member is active, and the shop is open. Lifetimes: 12 hours for a demo session, 7 days
  for a sample shop of one's own, 14 days for a real shop. Signing out ends the row.
- **Passwords** ([`packages/adapters/identity/password.ts`](../packages/adapters/identity/password.ts)): scrypt, run
  on every attempt against the stored hash or a dummy, so a wrong password, an unknown email and a locked account take
  the same path and return the same answer. Failures are counted per (email HMAC, IP hash) pair; every fifth failure
  locks that pair for 15 minutes, doubling up to a day, so nobody can lock an owner out from another network.
- **Real-shop sign-up.** On a hosted or live deployment, a real shop signs up only through an email verified by
  Supabase Auth ([`packages/adapters/identity/supabase-email.ts`](../packages/adapters/identity/supabase-email.ts));
  the email link returns to the configured public origin, never to a request header. The shop then waits for the
  operator's acceptance, writing nothing but its own creation; a sign-up not accepted in 14 days is purged.
- **The demo picker** (`/demo`) lists the sample shops' people for anyone to pick, with no password. It is a demo, not
  authentication, and answers 404 on a live deployment.

## Rate limits

Counted in PostgreSQL (`ops.rate_counter`) as `munshi_public`, by a hash of the limit's name and the subject, so the
table holds no address and no key. IPs are keyed hashes (`MUNSHI_RATE_SECRET`).

| Limit | Where |
|---|---|
| Public API: 5 writes per 10 minutes and 120 reads a minute per IP; 300 writes a day per publishable key | [`packages/core/src/rate.ts`](../packages/core/src/rate.ts) |
| Sign-in (members and operators): 10 attempts per 10 minutes per IP | [`packages/core/src/logins.ts`](../packages/core/src/logins.ts) |
| Sample-shop sign-up: 5 a day per IP. Real-shop sign-up: 5 a day per IP and 3 a day per email | `logins.ts` |
| The Instagram card route counts each caller against the API read limit | [`apps/web/app/api/cards`](../apps/web/app/api/cards/[tenant]/[file]/route.ts) |

Public forms that store a person's details carry a bot-check token behind a port
([`packages/adapters/botcheck`](../packages/adapters/botcheck/index.ts)). **Only the recorded verifier exists today**;
a live challenge service is not wired.

## Webhooks

| Route | Verification |
|---|---|
| WhatsApp | `X-Hub-Signature-256` (HMAC-SHA-256 of the raw body under `WHATSAPP_APP_SECRET`), timing-safe, before parsing ([`whatsapp.ts`](../packages/adapters/channels/whatsapp.ts)) |
| Instagram | The same scheme under `INSTAGRAM_APP_SECRET`; the route answers 404 when Instagram is not configured |
| PayPal | PayPal's own `verify-webhook-signature` call for `PAYPAL_WEBHOOK_ID`; the certificate URL must be on PayPal's hosts ([`paypal.ts`](../packages/adapters/payments/paypal.ts)) |
| Jobs tick | `Authorization: Bearer <CRON_SECRET>`, compared as sha256 digests, timing-safe; an unset secret admits no one ([`tick/route.ts`](../apps/web/app/api/internal/tick/route.ts)) |

The subscription checks compare the verify token timing-safe. A failed check is an empty 404, as if the route did not
exist. A webhook runs as `munshi_public` with no actor: the database lets it insert a new inbound message and nothing
else, never a book row, and it never calls a model.

## HTTP headers and CSP

- **Per request** ([`apps/web/proxy.ts`](../apps/web/proxy.ts)): pages get a content-security policy with a fresh nonce,
  `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`. Inline style attributes are allowed (the app renders computed sizes). Route handlers and
  media get `default-src 'none'; frame-ancestors 'none'`, so nothing they serve can run. Every response carries an
  `x-request-id` the server chose.
- **Every response** ([`apps/web/next.config.ts`](../apps/web/next.config.ts)): `Strict-Transport-Security`
  (two years, subdomains), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera and microphone for this origin only, no geolocation). The `X-Powered-By` header is off.
- **Uploads.** Photos and pictures are typed by their first bytes, not their name or declared type. An Instagram
  card is re-encoded as a JPEG with metadata (such as location) dropped.

## Secrets and redaction

- **One reader of the environment.** [`packages/config`](../packages/config/src/index.ts) is the only module that reads
  `process.env`. Its errors name a setting, never its value, and never wrap a caught error, so a secret cannot ride in
  a message or a stack.
- **Provider keys** are scrubbed from every model error, along with any bearer token
  ([`packages/ai/src/providers/redact.ts`](../packages/ai/src/providers/redact.ts)).
- **Logs** carry codes and request ids. Webhook, tick and API failures log a code, never the payload.
- **Local secrets.** `pnpm dev` generates the database passwords and session secret under `.run/` and passes them to
  the app as environment variables; it never prints them. The deploy tooling checks that no two pool URLs share a
  password and prints only error codes ([`db/src/deploy-check.ts`](../db/src/deploy-check.ts)).
- **Recorded fixtures** contain no key or header; the recorded outbox keeps ids and body hashes only.

## Personal data

- A person's name reaches the agent's views only for a synthetic or showcase shop; on a real shop it is NULL (G1).
- IP addresses are stored only as keyed hashes; emails in the identity tables as HMACs.
- A photo sent for reading is not stored; only its sha256 and what the model read are kept. With a live model, the
  photo goes to the configured provider.
- Inbound messages are erased 30 days after they arrive; Ask answers' words after 30 days; traces after 90 days.
- Erasing a person's contact blanks the words of the memory notes about them.

## The superadmin console

`/platform` is the operators' console, served by the same app on the same site.

**What protects it**

- **Off unless configured.** It runs only where the deployment holds `PLATFORM_DATABASE_URL` and
  `MUNSHI_PLATFORM_SECRET`; otherwise every `/platform` page, the sign-in included, is a 404
  ([`apps/web/lib/server/platform-session.ts`](../apps/web/lib/server/platform-session.ts)). A live deployment refuses
  to boot without the key.
- **Unlinked and unindexed.** No page, nav, footer, sitemap or manifest of the site, the app, the demo, the developer
  docs or the shop sites names it (`UNLINKED1`, [`apps/web/test/unlinked.test.ts`](../apps/web/test/unlinked.test.ts)),
  `robots.txt` does not name it, and every `/platform` response carries `X-Robots-Tag: noindex, nofollow`.
- **Password and TOTP.** Sign-in is the password identity, then an RFC 6238 code (HMAC-SHA-1, 6 digits, 30-second
  steps, one step of drift); a code counts once ([`packages/core/src/platform-totp.ts`](../packages/core/src/platform-totp.ts)).
  TOTP secrets are sealed with AES-256-GCM under a key derived from `MUNSHI_PLATFORM_SECRET`, with the operator's
  subject as associated data, so a sealed secret copied to another operator's row does not open.
- **Its own cookie and role.** `munshi_operator` is a separate HMAC-signed cookie naming a 2-hour operator session,
  `httpOnly`, `SameSite=Strict`, sent only to `/platform`. Console queries run as `munshi_platform`, which has no grant
  on any shop's books, approvals, snapshots or audit chain.
- **Changes are approved.** Every platform setting changes only as a `platform.change`, proposed in one transaction and
  decided in a later one; the approver approves the exact diff they were shown. Approving a channel grant or an
  operator change needs a TOTP code from the last five minutes. Adding an operator can be proposed in the console
  but is approved from the platform CLI ([`db/src/platform-cli.ts`](../db/src/platform-cli.ts)).

**What it does not protect against**

- **Same origin as the app.** The console shares the app's origin. Script running on that origin (for example through
  an XSS bug in the app) could drive console requests while an operator is signed in in the same browser. The strict
  CSP is the mitigation, not origin isolation.
- **No second approver.** A platform change is decided in a later transaction than its proposal, but nothing stops the
  operator who proposed it from approving it. Only adding an operator is kept out of the console's approve action.
- **Unlinked is not secret.** The path is guessable; `noindex` and the absence of links keep it out of search and
  navigation, nothing more. The password, the second factor and the rate limits are the defence.
- **No per-operator TOTP failure counter.** Code guessing is bounded by the per-IP sign-in limit and the password
  lockout, not by a counter on the operator.
- **A compromised server** holds `MUNSHI_PLATFORM_SECRET` in its environment and could unseal TOTP secrets.

## Residual risks

Stated plainly; none lets an agent write the books.

- **The actor is trusted from the app.** A compromised application server could set any member as the actor.
- **The audit chain is unkeyed.** Anyone who can rewrite the table as the owner role or a superuser can re-hash the
  chain and it will verify, and `verify_chain` cannot detect removal of the newest entries. Publishing the chain head
  outside the database is planned, not done.
- **Advisory locks and NOTIFY.** Any role can take advisory locks, so the agent role could stall a shop's audit appends
  (a stall, not a write). Any role can `NOTIFY`; a notification is only ever a hint to re-read rows.
- **Large objects on a managed database.** The bootstrap revokes the large-object functions from PUBLIC; on an admin
  that is not a superuser (as on Supabase) that revoke only warns, and the bootstrap prints
  `agent_large_objects=possible`. Large objects are unlinked bytes, never table rows.
- **Managed-platform roles.** On Supabase, two platform-managed read roles with BYPASSRLS can read every table. The
  deploy check confirms Supabase's API roles reach no Munshi schema, and names these two as a known residual.
- **The shelf-count hash** binds the stored response to its count, not to the provider: whoever stores a count supplies
  both. The calling path is held by a source scan (gate H1).
- **Bot check** is recorded only; see [Rate limits](#rate-limits).

More limits of the product, beyond security: [limitations.md](limitations.md).
