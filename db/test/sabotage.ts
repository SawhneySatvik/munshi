// Red-proofs: each case breaks one protection and names the gate test that must then fail. test/redproof.ts runs every
// case and also checks each named test passes when nothing is broken. A case breaks exactly one of:
//   sql  — run as superuser in the test file's fresh database, at the end of its beforeAll (TestDb.sabotage);
//   ts   — a source-text mutation applied as vitest loads the module (sabotagePlugin, in each vitest config);
//   none — harness-level: the code under test asks sabotageIs(name).
// Every path reports `applied` or `failed` to MUNSHI_SABOTAGE_REPORT; redproof calls a case that did not apply ERROR,
// never RED (a beforeAll that throws on a stale sabotage otherwise looks like a broken gate).
import { appendFileSync } from 'node:fs';

export type Mutation = { file: string; from: string; to: string }; // file relative to the repo root
export type Case = { sabotage: string; file: string; test: string; dir?: string; config?: string; sql?: string; ts?: Mutation }; // dir: default 'db'; config: relative to dir

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

// Rewrites a function's body text; raises if the text is not found, so a stale red-proof cannot silently no-op.
function mutate(fn: string, from: string, to: string): string {
  return `do $sabotage$
declare
  def text := pg_get_functiondef(${q(fn)}::regprocedure);
  broken text := replace(def, ${q(from)}, ${q(to)});
begin
  if broken = def then raise exception 'sabotage: % does not contain the text to break', ${q(fn)}; end if;
  execute broken;
end $sabotage$;`;
}

const asOwner = (sql: string) => `set role munshi_owner; ${sql} reset role;`;
const G = (n: number, name: string) => `test/g${n}-${name}.test.ts`;
const g1 = G(1, 'agent-cannot-write');
const g2 = G(2, 'book-guard');
const g3 = G(3, 'direct-command');
const g4 = G(4, 'rls');
const g5 = G(5, 'append-only');
const g6 = G(6, 'journal-balance');
const g7 = G(7, 'audit-chain');
const g9 = G(9, 'function-execute');
const g10 = G(10, 'indexes');
const g11 = G(11, 'same-transaction');
const g12 = G(12, 'members');
const C = (n: number, name: string) => `test/c${n}-${name}.test.ts`;
const c1 = C(1, 'commands');
const c2 = C(2, 'errors');
const c3 = C(3, 'snapshots');
const c4 = C(4, 'approvals');
const c5 = C(5, 'watchers');
const COMMANDS = 'packages/core/src/commands.ts';
const SNAPSHOTS = 'packages/core/src/snapshots.ts';
const APPROVALS = 'packages/core/src/approvals.ts';
const QUERIES = 'packages/core/src/queries.ts';
const WATCHERS = 'packages/core/src/watchers.ts';
const G12_OWNER_ONLY = 'G12 only an active owner adds an owner or a manager';
const C5_FOUND = 'C5 the watchers find 5 of 5 planted kinds (8 of 8 situations) and nothing else';
const C5_TWICE = 'C5 re-running the watchers raises nothing twice, the same day or the next';
const PLANT_KINDS = ['shrinkage', 'price_creep', 'expiry', 'overdue_credit', 'short_settlement'];
const B1 = 'B1 packages/agent imports no app pool, no core writer and no db, and never names the app connection';
const B0 = 'B0 the import scanner sees every form of import, follows them to their files, and lets the read entry point through';
const BOUNDARY_TEST = 'packages/core/test/boundary.test.ts';
const C1_RESULT = 'C1 a command result carrying a number is refused: a number to show comes from a snapshot cell';
const C4_PAYLOAD = "C4 every number in a draft's payload is mapped to a cell of its kind holding that number, and basedOn is never empty";
const C4_PAYLOAD_RECHECK = 'C4 a cell a payload number came from is re-checked at approval like basedOn';
const C4_CURRENT = "C4 a stock or money draft must cite the current on-hand of every item it names; a watcher's dated read is not enough";
const C4_AFTER_AS_OF = "C4 a write-off recorded after a watcher's as_of makes a draft cited from it stale";
const C4_AUTHORITY = 'C4 only an active member allowed to approve a command may reject it or have it marked stale';
const RECHECK = 'const changed = await recheck(c, [...draft.based_on, ...Object.values(draft.payload_refs)]);';
const h1 = 'test/h1-shelf-count.test.ts';
const h2 = 'test/h2-bill-read.test.ts';
const h3 = 'test/h3-voice.test.ts';
const c7 = C(7, 'current-state');
const PHOTO = 'packages/agent/src/photo.ts';
const BILL = 'packages/agent/src/bill.ts';
const VOICE = 'packages/agent/src/voice.ts';
const H1_FORGED = "H1 a forged count is refused: a response edited after it was hashed, or a count that is not the response's";
const H1_CELLS = 'H1 the count draft needs both cells: the count of that item from count.shelf, and its on-hand';
const H1_STILL = 'H1 only a still photo is sent: anything else is refused before any model is asked';
const H2_UNMATCHED = 'H2 an unmatched bill line never becomes a book line';
const H2_UNPLACED = 'H2 a bill number with no page position is refused';
const H2_LATE = "H2 a bill's lines are accepted only in the transaction that read it";
const H2_MATCH = "H2 a line's text is matched by plain code: one item's exact name or alias, else none";
const H3_TRACE = 'H3 the voice transcript never appears in a trace';
const C7_WASTE = 'C7 a write-off cannot take on-hand below zero';
const C7_COUNT = 'C7 a count in the past cannot take on-hand below zero once the moves after it are added';
const C7_RACE = 'C7 a count waits for a write-off in flight, so it never states books that have just changed';
const C7_CREDIT = "C7 a credit draft cites the customer's current balance from credit.balance, and goes stale when it moves";
const EXPECTED_CHECK =
  "if (i.expectedQtyMilli !== undefined && i.expectedQtyMilli !== Number(expected)) throw new CoreError('conflict', { fields: ['expectedQtyMilli'] });";
const COUNT_LOCK = 'const countedAt = at(i.countedAt);\n      await lockStock(ctx, i.itemId);';
const ANSWER = 'packages/agent/src/answer.ts';
const NUMBERS = 'packages/core/src/numbers.ts'; // the detector and its word lists, moved from answer.ts and words.ts (MS-22b)
const AGENT_CONFIG = '../../db/test/agent.vitest.config.ts'; // packages/agent's own config may not import this file (B1)
const RUN_TS = 'packages/agent/src/run.ts';
const a1 = 'test/a1-agent.test.ts';
const FC1_GLUE = 'FC1 two handles run together or joined only by glue are refused, and so is anything glued onto a handle';
const FC1_UNIT = 'FC1 a currency sign or a unit beside a handle is refused: the cell renders its own';
const FC1_NAME = "FC1 a text cell's digits render only when it is cited as a name, and a name never carries a currency sign";
const FC1_DATA = "RUN a read's names reach the model only inside a data block, without control characters, and an answer that obeys one abstains";
const A1_STALE = 'A1 a finding the latest watcher run still sees stays current; one it no longer sees is refused';
const SHELF = 'packages/agent/src/shelf.ts';
const MS8_HI = "MS8 Hindi numbers 1–100 are refused in CLDR's spelling and the review's, with their ordinal and plural endings, and the scales";
const MS8_LATN = "MS8 Hindi numbers in Latin letters are refused: every CLDR word romanised, long and short, with ordinal endings, and the review's";
const MS8_ROMAN = 'MS8 Roman numerals in any case, letters passing for digits, and number symbols are refused';
const MS8_SCRIPT = 'MS8 a letter outside the Latin and Devanagari scripts is refused, and so are Latin look-alikes outside ASCII';
const MS8_NAMES = "MS8 a text cell with no letter is no name, and a person's or firm's name may not carry a figure standing alone";
const MS8_PROBE = "MS8 every attack of the review's second probe is refused";
const MS12_CLEAN = 'MS12 the clean corpus: no ordinary answer abstains, in English, Hindi or Hinglish';
const MS12_ATTACKS = 'MS12 the attack corpus: every probe and probe2 attack and every homograph in a quantity context is refused';
const MS12_DROPPED = 'MS12 the sentences dropped from clean need a hole to pass, so they stay refused';
const MS12_RUN_NAMES = "RUN the names in a run's reads reach the validator: a homograph beside one abstains";
const B5_CORPUS = "B5 the precision corpus passes unchanged through core's detector, line for line as through the agent's validator";
const EX2_REFUSED = "EX2 the span parser refuses what it cannot read, with the reason, and never guesses: 'बीस प्रतिशत' and '1,5' among them";
const EX2_HINDI = "EX2 every Hindi cardinal the detector lists reads to its value in the hand-written key and ICU's Hindi numerals";
const EX2_DATES = 'EX2 date words and forms read to the hand-written key, from Wednesday 28 Oct 2026';
const MS12_SHELF = 'MS12 shelf phrases (textRules) still read every homograph as a number: the context reading is for answers only';
const MS12_ONE_BILL = 'H2 a bill read backs one executed purchase: a second draft of it goes stale at approval, and a third is refused at proposal';
const H1_FORGE = 'H1 a catalogue name cannot forge a catalogue line: names reach the vision model quoted and escaped, one item a line';
const H1_QUARANTINE = 'H1 the vision call is quarantined: no tools are offered, and an answer with a tool call is refused whole';
const H2_QUARANTINE = 'H2 the vision call is quarantined: no tools are offered, and an answer with a tool call is refused whole';
const H1_PHRASES = 'H1 a phrase for a product outside the catalogue leaves the agent with no figure in it';
const H1_AGE = "H1 a count carries counted_at, and one older than the shop's count_max_age (6 hours by default) cannot back a draft, at proposal or at approval";
const H1_WRITERS =
  "H1 only the shelf flow stores a count: the port's recordCount is called only in shelf.ts with segment()'s response, and core's writer only through a pass-through binding";
const H2_ONE_BILL = "H2 a bill draft is one bill as read: the bill's own supplier, number and date, each line's figures from one bill line, no bill line twice";
const LOOK = 'const r = await generate({ ...req, role: "vision" }, o.deps);';
const TOOL_CALL = 'if (r.toolCalls.length > 0 || r.json === undefined) return "tool_call";';
export const BOUNDARY: [string, string][] = [
  ['b1-agent-imports-pool', B1],
  ['b1-agent-imports-command', B1],
  ['b1-agent-database-url', B1],
  // The MS-5 review's bypasses: a directory import of core, the app's pool, a computed import in a fixture, createRequire.
  ['b1-agent-dir-import', B1],
  ['b1-agent-via-app', B1],
  ['b1-agent-computed-import', B1],
  ['b1-agent-create-require', B1],
  ['b2-read-imports-writer', 'B2 @munshi/core/read reaches only read.ts, money.ts and errors.ts, and none writes or sets context'],
  ['b3-actor-set-elsewhere', 'B3 only withTx in packages/core/src/session.ts names the acting-member setting'],
  ['b4-snap-written-elsewhere', 'B4 only mintSnapshot writes snap.*'],
];
const G1_CREATE = 'G1 the agent can create nothing: no temporary table, no object in any schema, no large object';
const G3_WRITABLE = 'G3 no runtime role can change who holds which command, or which tables a command writes';
// The guard's ops.command_table lookup always finds a row: any admitted command may write any book table.
const anyTable = mutate(
  'books.guard()',
  "perform 1 from ops.command_table ct where ct.command = by_command and ct.rel = tg_table_schema || '.' || tg_table_name;",
  'perform 1;',
);

// ---- MS-19a: migrations 0010–0013 (tenancy, items, people, sign-in) ---------------------------------------------------
const TENANCY = 'test/tenancy.test.ts';
const PEOPLE = 'test/people.test.ts';
const SIGN_IN = 'test/sign-in.test.ts';
const T0 = 'T0 the ops.member_audit 0010 installs chains a member as {member_id, role}; the one 0007 installed chained the name';
const T1_CLASS = 'T1 a live tenant only in a live database, and no other kind there';
const T1_FIXED = 'T1 business_type and data_class never change, even for the owner';
const T1_DEPLOYMENT = 'T1 ops.deployment is one row and never changes, even for the owner';
const T2_WRITES = "T2 the app cannot write either global table, nor change a tenant's business_type or data_class";
const G13 = 'G13 the global tables are exactly the munshi tables with no tenant policy; the app holds exactly their declared privileges, the agent none';
const G9_DEFINER = 'G9 no function in the munshi schemas is SECURITY DEFINER, and every one written from 0010 pins its search_path';
const PII1_VAULT =
  'PII1 a showcase or live tenant names a customer, staff member or supplier only through the vault; the synthetic kirana keeps its names';
const PII1_BALANCE =
  'PII1 the retention purge never erases a person a credit balance holds; an erasure the owner requested completes once it clears';
const PII1_CONSENT =
  'PII1 consent is a book: consent.record writes it for any member role, a reply names its message, it is never dated ahead, and nothing changes it';
const T1_FIRST = 'T1 the deployment row comes before any tenant: a database holding tenants is never given a kind';
const F5_PURGE = 'F5 the purge erases a member only a year after deactivation and with no live login, leaving no audit entry';
const PII1_CONTACT =
  "PII1 a contact is added by an active member, and erased only as an active owner's request or the retention purge, audited by id alone";
const OE1_PHONE = "OE1 a contact's phone never moves to another number: not directly, and not by emptying it and filling another";
const OE1_ERASE = 'OE1 an erasure nulls every personal column with erased_at = now() in one UPDATE, and the erased row never changes again';
const OE1_FILL =
  'OE1 a fill-once column fills once, in the UPDATE that sets its stamp, never again even after a NULL; an erasure still nulls it and freezes the row';
const OE1_SUBJECT =
  "OE1 a login's Google subject is never refilled: emptying it and filling another account is refused, and an erased binding stays erased";
const OE1_MEMBER = 'OE1 a member is erased whole: name and phone with erased_at, once deactivated, by an active owner, and the row then never changes';
const F4_BIND = 'F4 a login is bound only by the member, in the transaction that used the invite it names, and an invite binds once';
const F4_INVITE =
  'F4 an invite is made by an active owner (or a manager, for staff), used once by the invited member before it expires; the purge erases only an expired one';
const F5_SESSION = 'F5 a session is opened by its own member, signed out once by that member or an active owner, and never signed back in';
const F5_MEMBER = 'F5 a member is deactivated once, by an active owner, never the last active owner, and never re-activated';
const F7_VIA = 'F7 a demo sign-in opens no session on a live tenant; a Google one needs the live deployment and a live binding';
const F7_RACE = 'F7 two owners deactivating each other at once leave one active owner';
const F7_EMAIL = 'F7 no email survives a used invite: using one without erasing its email is refused';
const PII3 =
  'PII3 a live staff member added, invited, bound, deactivated and erased leaves no name, phone or email in the audit chain or a global table';
// The rule the fix-2 review broke (MERCHANTS-DESIGN §2.0, finding 1): a personal column may go to NULL, or from NULL to a
// value, at any time; only a value replaced by another is refused. Null-then-fill swaps a phone, a subject or a sender.
const FIX1_ONLY_ERASE = asOwner(`create or replace function ops.only_erase() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $f$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  col text;
begin
  foreach col in array tg_argv loop
    if o ->> col is not null and n ->> col is not null and (o -> col) is distinct from (n -> col) then
      raise exception 'fix-1: a value changes only to or from NULL' using errcode = 'MS011';
    end if;
  end loop;
  return new;
end $f$;`);
const MS19A: Case[] = [
  { sabotage: 't0-member-unaudited', file: TENANCY, test: T0, sql: 'drop trigger guard_audit on ops.member;' },
  { sabotage: 't1-no-class-trigger', file: TENANCY, test: T1_CLASS, sql: 'drop trigger tenant_class on ops.tenant;' },
  {
    sabotage: 't1-class-mutable',
    file: TENANCY,
    test: T1_FIXED,
    sql: mutate(
      'ops.tenant_class()',
      'if new.business_type is distinct from old.business_type or new.data_class is distinct from old.data_class then',
      'if false then',
    ),
  },
  { sabotage: 't1-deployment-mutable', file: TENANCY, test: T1_DEPLOYMENT, sql: 'drop trigger fixed on ops.deployment;' },
  { sabotage: 't1-deployment-truncate', file: TENANCY, test: T1_DEPLOYMENT, sql: 'drop trigger fixed_truncate on ops.deployment;' },
  { sabotage: 't2-directory-writable', file: TENANCY, test: T2_WRITES, sql: 'grant insert on ops.tenant_directory to munshi_app;' },
  { sabotage: 't2-directory-writable', file: TENANCY, test: G13 },
  { sabotage: 't2-class-writable', file: TENANCY, test: T2_WRITES, sql: 'grant update (data_class) on ops.tenant to munshi_app;' },
  { sabotage: 'g13-agent-reads', file: TENANCY, test: G13, sql: 'grant select on ops.member_login to munshi_agent;' },
  { sabotage: 'g13-policy-missing', file: TENANCY, test: G13, sql: 'drop policy tenant_isolation on ops.contact;' },
  { sabotage: 'g9-security-definer', file: TENANCY, test: G9_DEFINER, sql: 'alter function books.pii() security definer;' },
  { sabotage: 'g9-search-path', file: TENANCY, test: G9_DEFINER, sql: 'alter function ops.only_erase() reset search_path;' },
  { sabotage: 'pii1-no-customer-trigger', file: PEOPLE, test: PII1_VAULT, sql: 'drop trigger pii on books.customer;' },
  { sabotage: 'pii1-no-staff-trigger', file: PEOPLE, test: PII1_VAULT, sql: 'drop trigger pii on books.staff;' },
  {
    sabotage: 'pii1-showcase-exempt',
    file: PEOPLE,
    test: PII1_VAULT,
    sql: mutate('books.pii()', "if cls is distinct from 'synthetic' and new.contact_id is null then", "if cls = 'live' and new.contact_id is null then"),
  },
  {
    sabotage: 'pii1-erase-anyone',
    file: PEOPLE,
    test: PII1_CONTACT,
    sql: mutate('ops.contact_guard()', "if coalesce(actor_role = 'owner' and new.erased_by = ctx_actor and new.erase_reason = 'request', false) then", 'if true then'),
  },
  // Fix cycle 1 (B): the purge's condition is checked by the database, not trusted.
  {
    sabotage: 'contact-purge-unbounded',
    file: PEOPLE,
    test: PII1_CONTACT,
    sql: mutate('ops.contact_guard()', 'if old.erase_requested_at is null and (', 'if false and ('),
  },
  { sabotage: 'contact-purge-balance', file: PEOPLE, test: PII1_BALANCE, sql: mutate('ops.contact_guard()', 'having sum(ce.amount_minor) <> 0) then', 'having false) then') },
  // Fix cycle 1 (A, D).
  { sabotage: 'consent-future', file: PEOPLE, test: PII1_CONSENT, sql: 'alter table books.customer_consent drop constraint consent_not_future;' },
  { sabotage: 'pii1-no-supplier-trigger', file: PEOPLE, test: PII1_VAULT, sql: 'drop trigger pii on books.supplier;' },
  {
    sabotage: 'pii1-request-anyone',
    file: PEOPLE,
    test: PII1_CONTACT,
    sql: mutate('ops.contact_guard()', " or actor_role is distinct from 'owner') then", ') then'),
  },
  ...[OE1_PHONE, OE1_ERASE, OE1_FILL].map((test) => ({ sabotage: 'oe1-fix1-rule', file: PEOPLE, test, sql: FIX1_ONLY_ERASE })),
  { sabotage: 'oe1-fix1-rule', file: SIGN_IN, test: OE1_SUBJECT },
  ...[OE1_ERASE].map((test) => ({ sabotage: 'oe1-no-freeze', file: PEOPLE, test, sql: mutate('ops.only_erase()', "if o ->> 'erased_at' is not null then", 'if false then') })),
  ...[OE1_SUBJECT, OE1_MEMBER, F4_INVITE].map((test) => ({ sabotage: 'oe1-no-freeze', file: SIGN_IN, test })),
  {
    sabotage: 'oe1-erase-partial',
    file: SIGN_IN,
    test: OE1_MEMBER,
    sql: mutate('ops.only_erase()', 'if erasing and n ->> col is not null then', 'if false then'),
  },
  {
    sabotage: 'oe1-erase-not-now',
    file: PEOPLE,
    test: OE1_ERASE,
    sql: mutate('ops.only_erase()', "if erasing and (n ->> 'erased_at')::timestamptz is distinct from now() then", 'if false then'),
  },
  { sabotage: 'oe1-fill-twice', file: PEOPLE, test: OE1_FILL, sql: mutate('ops.fill_once()', 'if o ->> stamp is not null or ', 'if ') },
  {
    sabotage: 'oe1-fill-unstamped',
    file: PEOPLE,
    test: OE1_FILL,
    sql: mutate('ops.fill_once()', "if n ->> col is not null or o ->> 'erased_at' is not null or n ->> 'erased_at' is null then", 'if false then'),
  },
  {
    sabotage: 'oe1-fill-erase-kept',
    file: PEOPLE,
    test: OE1_FILL,
    sql: mutate('ops.fill_once()', "elsif o ->> 'erased_at' is null and n ->> 'erased_at' is not null and n ->> col is not null then", 'elsif false then'),
  },
  { sabotage: 'f4-no-bind-trigger', file: SIGN_IN, test: F4_BIND, sql: 'drop trigger bind on ops.member_login;' },
  {
    sabotage: 'f4-any-txid',
    file: SIGN_IN,
    test: F4_BIND,
    sql: mutate('ops.login_bind()', 'and i.used_txid = txid_current();', 'and i.used_txid is not null;'),
  },
  { sabotage: 'f4-caller-txid', file: SIGN_IN, test: F4_BIND, sql: mutate('ops.invite_guard()', 'new.used_txid := txid_current();', '') },
  {
    sabotage: 'f4-login-other-tenant',
    file: SIGN_IN,
    test: OE1_SUBJECT,
    sql: mutate(
      'ops.login_bind()',
      "if new.tenant_id is distinct from ctx_tenant or (tg_op = 'UPDATE' and old.tenant_id is distinct from ctx_tenant) then",
      'if false then',
    ),
  },
  { sabotage: 'f4-invite-expiry', file: SIGN_IN, test: F4_INVITE, sql: mutate('ops.invite_guard()', 'elsif now() >= old.expires_at then', 'elsif false then') },
  {
    sabotage: 'f4-invite-anyone',
    file: SIGN_IN,
    test: F4_INVITE,
    sql: mutate('ops.invite_guard()', "raise exception 'invite refused: an active owner invites, or an active manager invites staff' using errcode = 'MS007';", 'null;'),
  },
  {
    sabotage: 'f4-manager-invites-manager',
    file: SIGN_IN,
    test: F4_INVITE,
    sql: mutate('ops.invite_guard()', "(actor_role = 'manager' and invited_role = 'staff')", "actor_role = 'manager'"),
  },
  { sabotage: 'f4-invite-rebind', file: SIGN_IN, test: F4_BIND, sql: 'drop index ops.member_login_invite;' },
  { sabotage: 'f4-invite-stand-in', file: SIGN_IN, test: F4_BIND, sql: mutate('ops.login_bind()', 'i.id = new.invite_id and ', '') },
  { sabotage: 'f4-subject-unique', file: SIGN_IN, test: F4_BIND, sql: 'drop index ops.member_login_subject;' },
  {
    sabotage: 't1-deployment-late',
    file: TENANCY,
    test: T1_FIRST,
    sql: mutate('ops.deployment_fixed()', "if pg_relation_size('ops.tenant') > 0 then", 'if false then'),
  },
  {
    sabotage: 'f7-google-unchecked',
    file: SIGN_IN,
    test: F7_VIA,
    sql: mutate('ops.login_session_via()', "if new.via = 'google' and ((select d.kind", "if false and ((select d.kind"),
  },
  // The orchestrator's ruling: the member purge, fenced by the database.
  {
    sabotage: 'member-purge-early',
    file: SIGN_IN,
    test: F5_PURGE,
    sql: mutate('ops.member_deactivate()', "and a.action = 'member.deactivate' and a.created_at < now() - interval '365 days')", "and a.action = 'member.deactivate')"),
  },
  {
    sabotage: 'member-purge-live-login',
    file: SIGN_IN,
    test: F5_PURGE,
    sql: mutate('ops.member_deactivate()', 'or exists (select 1 from ops.member_login l', 'or false and exists (select 1 from ops.member_login l'),
  },
  {
    sabotage: 'member-purge-anyone',
    file: SIGN_IN,
    test: OE1_MEMBER,
    sql: mutate('ops.member_deactivate()', "elsif ctx_actor is not null and actor_role is distinct from 'owner' then", 'elsif false then'),
  },
  {
    sabotage: 'f5-revoke-twice',
    file: SIGN_IN,
    test: F5_SESSION,
    sql: mutate('ops.login_session_via()', 'if old.revoked_at is not null or new.revoked_at is distinct from now()', 'if new.revoked_at is distinct from now()'),
  },
  {
    sabotage: 'f5-session-anyone',
    file: SIGN_IN,
    test: F5_SESSION,
    sql: mutate('ops.login_session_via()', 'if new.member_id is distinct from ctx_actor or new.revoked_at is not null then', 'if new.revoked_at is not null then'),
  },
  {
    sabotage: 'f5-last-owner',
    file: SIGN_IN,
    test: F5_MEMBER,
    sql: mutate('ops.member_deactivate()', "if old.role = 'owner' and not exists (", 'if false and not exists ('),
  },
  {
    sabotage: 'f5-reactivate',
    file: SIGN_IN,
    test: F5_MEMBER,
    sql: mutate('ops.member_deactivate()', "if new.active or actor_role is distinct from 'owner' then", "if actor_role is distinct from 'owner' then"),
  },
  { sabotage: 'f7-no-via-trigger', file: SIGN_IN, test: F7_VIA, sql: 'drop trigger via on ops.login_session;' },
  {
    sabotage: 'f7-deactivate-unlocked',
    file: SIGN_IN,
    test: F7_RACE,
    sql: mutate('ops.member_deactivate()', "perform pg_advisory_xact_lock(hashtextextended('munshi.member:' || new.tenant_id::text, 0));", ''),
  },
  { sabotage: 'f7-invite-email-kept', file: SIGN_IN, test: F7_EMAIL, sql: mutate('ops.invite_guard()', 'elsif new.erased_at is null then', 'elsif false then') },
  {
    sabotage: 'pii3-member-chained',
    file: SIGN_IN,
    test: PII3,
    sql: mutate('ops.member_audit()', "jsonb_build_object('member_id', new.id, 'role', new.role)", 'to_jsonb(new)'),
  },
];

export const CASES: Case[] = [
  {
    sabotage: 'c4-two-open-drafts',
    file: c4,
    test: 'C4 a finding has at most one open draft: a second proposal conflicts until the first is decided',
    sql: asOwner('drop index approval.draft_open_per_finding;'),
  },
  {
    sabotage: 'g1-stray-table',
    file: g1,
    test: 'G1 the manifest lists exactly the tables and views in the munshi schemas',
    sql: asOwner('create table ops.stray (tenant_id uuid);'),
  },
  {
    sabotage: 'g1-agent-insert',
    file: g1,
    test: 'G1 the agent holds no INSERT, UPDATE, DELETE or TRUNCATE privilege on any table or view',
    sql: 'grant usage on schema books to munshi_agent; grant insert on books.item to munshi_agent;',
  },
  { sabotage: 'g1-agent-insert', file: g1, test: 'G1 the agent is refused INSERT, UPDATE and DELETE on every table' },
  {
    sabotage: 'g1-agent-column-update',
    file: g1,
    test: 'G1 the agent holds no INSERT, UPDATE, DELETE or TRUNCATE privilege on any table or view',
    sql: 'grant usage on schema ops to munshi_agent; grant update (name) on ops.shop to munshi_agent;',
  },
  {
    sabotage: 'g1-agent-temp',
    file: g1,
    test: G1_CREATE,
    sql: `do $$ begin execute format('grant temporary on database %I to public', current_database()); end $$;`,
  },
  { sabotage: 'g1-agent-large-object', file: g1, test: G1_CREATE, sql: 'grant execute on function lo_from_bytea(oid, bytea) to public;' },
  { sabotage: 'g1-agent-create', file: g1, test: G1_CREATE, sql: 'grant create on schema public to munshi_agent;' },
  {
    sabotage: 'g2-no-guard',
    file: g2,
    test: 'G2 every book table refuses a write with no decision and no command',
    sql: 'drop trigger guard on books.outbound_message;',
  },
  {
    sabotage: 'g2-other-tenant',
    file: g2,
    test: 'G2 a decision of another tenant is refused',
    sql: `create policy leak on approval.decision using (true); create policy leak on approval.draft using (true);
          create policy leak on ops.member using (true);
          ${mutate('books.guard()', 'd.tenant_id = new.tenant_id and ', '')}`,
  },
  {
    sabotage: 'g2-earlier-txn',
    file: g2,
    test: 'G2 a decision from an earlier transaction is refused',
    sql: mutate('books.guard()', 'd.created_txid = txid_current()', 'true'),
  },
  {
    sabotage: 'g2-rejected',
    file: g2,
    test: 'G2 a rejected decision is refused',
    sql: mutate('books.guard()', "d.verdict = 'approved'", 'true'),
  },
  {
    sabotage: 'g2-approver-authority',
    file: g2,
    test: 'G2 a decision by a member whose role cannot run the command is refused',
    sql: mutate('books.guard()', 'join ops.command_authority ca on ca.role = m.role and ca.command = dr.command_type', ''),
  },
  {
    sabotage: 'g2-decider-not-actor',
    file: g2,
    test: 'G2 a decision must be made by the acting member',
    sql: mutate('approval.stamp_decision()', 'if new.decided_by is distinct from', 'if false and new.decided_by is distinct from'),
  },
  {
    sabotage: 'g2-forged-txid',
    file: g2,
    test: 'G2 a caller-supplied created_txid is overwritten with the current transaction',
    sql: mutate('approval.stamp_decision()', 'new.created_txid := txid_current();', ''),
  },
  { sabotage: 'g2-command-table', file: g2, test: 'G2 an approved price.set decision cannot write books.sale', sql: anyTable },
  {
    sabotage: 'g2-executed-unchecked',
    file: g2,
    test: 'G2 a draft is marked executed only under an approved decision made in this transaction',
    sql: mutate(
      'approval.draft_status()',
      "new.status = 'executed' and (verdict is distinct from 'approved' or decided_txid is distinct from txid_current())",
      'false',
    ),
  },
  {
    sabotage: 'g2-executed-earlier-txn',
    file: g2,
    test: 'G2 a draft is marked executed only under an approved decision made in this transaction',
    sql: mutate('approval.draft_status()', ' or decided_txid is distinct from txid_current()', ''),
  },
  {
    sabotage: 'g2-rejected-unchecked',
    file: g2,
    test: 'G2 a draft is marked rejected only under a rejected decision',
    sql: mutate('approval.draft_status()', "new.status = 'rejected' and verdict is distinct from 'rejected'", 'false'),
  },
  {
    sabotage: 'g2-stale-unchecked',
    file: g2,
    test: 'G2 only an undecided draft can be marked stale or failed',
    sql: mutate('approval.draft_status()', "new.status in ('stale', 'failed') and verdict is not null", 'false'),
  },
  {
    sabotage: 'g2-new-draft-decided',
    file: g2,
    test: 'G2 a new draft starts proposed',
    sql: mutate('approval.stamp_draft()', "if new.status <> 'proposed' then", 'if false then'),
  },
  {
    sabotage: 'g2-same-txn-draft',
    file: g2,
    test: 'G2 a decision on a draft proposed in the same transaction is refused',
    sql: mutate('approval.stamp_decision()', 'if draft_txid = txid_current() then', 'if false then'),
  },
  // Harness-level: the test context is set session-wide instead of transaction-local (see setCtx in db.ts).
  { sabotage: 'g2-session-set', file: g2, test: 'G2 context does not survive the transaction on a pooled connection' },
  {
    sabotage: 'g3-no-authority',
    file: g3,
    test: 'G3 a member without the authority is refused',
    sql: mutate('books.guard()', 'and ca.command = ctx_command', ''),
  },
  {
    sabotage: 'g3-other-tenant',
    file: g3,
    test: 'G3 a member of another tenant is refused',
    sql: `create policy leak on ops.member using (true); ${mutate('books.guard()', 'm.tenant_id = new.tenant_id and ', '')}`,
  },
  {
    sabotage: 'g3-inactive',
    file: g3,
    test: 'G3 an inactive member is refused',
    sql: mutate('books.guard()', 'and m.id = ctx_actor and m.active', 'and m.id = ctx_actor'),
  },
  { sabotage: 'g3-authority-writable', file: g3, test: G3_WRITABLE, sql: 'grant insert on ops.command_authority to munshi_app;' },
  { sabotage: 'g3-command-table', file: g3, test: 'G3 staff holding sale.record cannot write books.price', sql: anyTable },
  { sabotage: 'g3-command-table-writable', file: g3, test: G3_WRITABLE, sql: 'grant insert on ops.command_table to munshi_app;' },
  {
    sabotage: 'g3-command-unmapped',
    file: g3,
    test: 'G3 every held command writes named book tables, and every book table has a command',
    sql: "delete from ops.command_table where command = 'attendance.record';",
  },
  {
    sabotage: 'g4-view-owner',
    file: g4,
    test: 'G4 no munshi role is a superuser or bypasses RLS, and munshi_owner owns every object',
    sql: 'alter view agent_view.item owner to postgres;',
  },
  { sabotage: 'g4-view-owner', file: g4, test: 'G4 the agent sees only its own tenant through snapshots and views' },
  {
    sabotage: 'g4-no-force',
    file: g4,
    test: 'G4 every tenant table has RLS enabled and forced with a policy, and only those tables carry tenant_id',
    sql: 'alter table books.sale no force row level security;',
  },
  {
    sabotage: 'g4-leak-read',
    file: g4,
    test: "G4 tenant A sees its own rows and none of tenant B's on every tenant table",
    sql: 'create policy leak on books.customer using (true);',
  },
  {
    sabotage: 'g4-leak-write',
    file: g4,
    test: "G4 tenant A cannot write tenant B's rows on any tenant table",
    sql: 'create policy leak on ops.shop for insert with check (true);',
  },
  {
    sabotage: 'g4-null-context',
    file: g4,
    test: 'G4 a transaction with no tenant context sees no rows',
    sql: `alter policy tenant_isolation on books.item using (nullif(current_setting('munshi.tenant_id', true), '') is null
            or tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));`,
  },
  {
    sabotage: 'g5-grant-update',
    file: g5,
    test: 'G5 munshi_app holds no UPDATE, DELETE or TRUNCATE privilege on any append-only table',
    sql: 'grant update on books.sale to munshi_app;',
  },
  { sabotage: 'g5-grant-update', file: g5, test: 'G5 UPDATE and DELETE on every append-only table are refused for munshi_app' },
  {
    sabotage: 'g6-no-balance',
    file: g6,
    test: 'G6 an unbalanced journal entry fails at commit',
    sql: 'drop trigger balanced on books.journal_line; drop trigger balanced on books.journal_entry;',
  },
  {
    sabotage: 'g6-overall-only',
    file: g6,
    test: 'G6 an entry balanced overall but not per currency fails at commit',
    sql: mutate('books.check_balanced()', 'group by l.currency ', ''),
  },
  {
    sabotage: 'g7-hash-unchecked',
    file: g7,
    test: 'G7 the chain verifies, then finds a tampered row',
    sql: mutate('audit.verify_chain(uuid)', ' or e.hash is distinct from audit.entry_hash(prev, e)', ''),
  },
  {
    sabotage: 'g7-blind',
    file: g7,
    test: 'G7 a deleted row is found',
    sql: mutate(
      'audit.verify_chain(uuid)',
      'e.seq <> expected or e.prev_hash is distinct from prev or e.hash is distinct from audit.entry_hash(prev, e)',
      'false',
    ),
  },
  {
    sabotage: 'g7-any-tenant',
    file: g7,
    test: 'G7 verify_chain refuses to answer for another tenant',
    sql: mutate('audit.verify_chain(uuid)', 'if p_tenant is distinct from', 'if false and p_tenant is distinct from'),
  },
  {
    sabotage: 'g7-caller-seq',
    file: g7,
    test: 'G7 caller-supplied seq and hash are replaced by the chain',
    sql: mutate('audit.chain()', 'new.seq := coalesce(last_seq, 0) + 1;', ''),
  },
  {
    sabotage: 'g7-any-actor',
    file: g7,
    test: 'G7 an entry must name the acting member',
    sql: mutate('audit.chain()', 'if new.actor_id is distinct from', 'if false and new.actor_id is distinct from'),
  },
  {
    sabotage: 'g7-unwritten-row',
    file: g7,
    test: 'G7 an entry for a book row that was never written is refused',
    sql: mutate('audit.chain()', 'if not written then', 'if false then'),
  },
  {
    sabotage: 'g7-second-entry',
    file: g7,
    test: 'G7 a book row has one audit entry; a second, however spelled, is refused',
    sql: 'drop index audit.audit_book_row;',
  },
  {
    sabotage: 'g7-entity-spelling',
    file: g7,
    test: 'G7 a book row has one audit entry; a second, however spelled, is refused',
    sql: 'alter table audit.audit_log drop constraint audit_log_entity_check;',
  },
  // The audit entry is written BEFORE the row again (the original bug). The one-entry index is dropped too, so the
  // test sees the bug itself (a second entry for a skipped insert) rather than a unique violation.
  {
    sabotage: 'g7-audit-before',
    file: g7,
    test: 'G7 an insert skipped by ON CONFLICT DO NOTHING leaves no audit entry',
    sql: `drop trigger guard_audit on books.item; drop index audit.audit_book_row;
          create trigger guard_audit before insert on books.item for each row execute function books.audit_row();`,
  },
  // Harness-level: the embedded-postgres exit hook is left in place (see global-setup.ts).
  { sabotage: 'g8-exit-hook', file: 'test/g8-exit-code.test.ts', test: 'G8 a failing test run exits non-zero, a passing one exits 0' },
  {
    sabotage: 'g9-public-execute',
    file: g9,
    test: 'G9 no function in the munshi schemas grants EXECUTE to PUBLIC',
    sql: 'grant execute on function audit.verify_chain(uuid) to public;',
  },
  {
    sabotage: 'g9-stray-function',
    file: g9,
    test: 'G9 no function in the munshi schemas grants EXECUTE to PUBLIC',
    sql: asOwner(`create function ops.stray() returns int language sql as 'select 1'; revoke execute on function ops.stray() from public;`),
  },
  {
    sabotage: 'g9-app-execute',
    file: g9,
    test: 'G9 the app executes only what it is granted, and the guard triggers still fire without EXECUTE',
    sql: 'grant execute on function books.guard() to munshi_app;',
  },
  {
    sabotage: 'g10-wrong-columns',
    file: g10,
    test: 'G10 every declared index exists in pg_index with its columns',
    sql: 'drop index books.sale_sold_at; create index sale_sold_at on books.sale (tenant_id, customer_id);',
  },
  {
    sabotage: 'g10-tenant-not-leading',
    file: g10,
    test: 'G10 tenant_id leads every index and foreign key on every tenant table',
    sql: 'create index sale_customer_only on books.sale (customer_id);',
  },
  {
    sabotage: 'g11-late-line',
    file: g11,
    test: 'G11 a later transaction cannot add a line to a committed journal entry',
    sql: mutate('books.entry_txn()', 'e.created_txid = txid_current()', 'true'),
  },
  {
    sabotage: 'g11-late-cell',
    file: g11,
    test: 'G11 a later transaction cannot add a cell to a committed snapshot',
    sql: mutate('snap.snapshot_txn()', 's.created_txid = txid_current()', 'true'),
  },
  {
    sabotage: 'g11-forged-entry-txid',
    file: g11,
    test: 'G11 a caller-supplied created_txid on an entry or a snapshot is overwritten',
    sql: mutate('books.entry_txn()', 'new.created_txid := txid_current();', ''),
  },
  {
    sabotage: 'g11-forged-snapshot-txid',
    file: g11,
    test: 'G11 a caller-supplied created_txid on an entry or a snapshot is overwritten',
    sql: mutate('snap.snapshot_txn()', 'new.created_txid := txid_current();', ''),
  },
  // ---- phase 2 -------------------------------------------------------------------------------------------------------
  {
    sabotage: 'g12-first-member-anyone',
    file: g12,
    test: "G12 a tenant's first member is an owner adding themself",
    sql: mutate('ops.member_guard()', "if new.role <> 'owner' or not new.active or new.id is distinct from ctx_actor then", 'if false then'),
  },
  {
    sabotage: 'g12-manager-adds-manager',
    file: g12,
    test: G12_OWNER_ONLY,
    sql: mutate('ops.member_guard()', "(new.role in ('owner', 'manager') or actor_role is distinct from 'manager')", "(actor_role is distinct from 'manager')"),
  },
  {
    sabotage: 'g12-inactive-owner',
    file: g12,
    test: G12_OWNER_ONLY,
    sql: mutate('ops.member_guard()', 'and m.id = ctx_actor and m.active;', 'and m.id = ctx_actor;'),
  },
  {
    sabotage: 'g12-staff-adds-staff',
    file: g12,
    test: 'G12 staff are added by an active owner or manager',
    sql: mutate('ops.member_guard()', "or actor_role is distinct from 'manager')", 'or actor_role is null)'),
  },
  {
    sabotage: 'g12-no-audit',
    file: g12,
    test: 'G12 every member added is audited under the member who added them',
    sql: 'drop trigger guard_audit on ops.member;',
  },
  {
    sabotage: 'c1-stored-total',
    file: c1,
    test: 'C1 a counter sale is priced from the books, takes the rest as credit, balances and is audited under the seller',
    ts: { file: COMMANDS, from: '[t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total, t.currency]', to: '[t.tenantId, saleId, i.shopId, soldAt, i.customerId ?? null, total + 1, t.currency]' },
  },
  {
    sabotage: 'c1-overpayment',
    file: c1,
    test: 'C1 a sale paying more than the books price is refused, and an unpaid rest needs a customer',
    ts: { file: COMMANDS, from: "if (credit < 0) throw new CoreError('invalid', { fields: ['payments'] });", to: '' },
  },
  {
    sabotage: 'c1-count-not-rederived',
    file: c1,
    test: 'C1 a stock count writes the difference from the books as one adjustment, and nothing when it agrees',
    ts: { file: COMMANDS, from: 'const delta = i.countedQtyMilli - Number(expected);', to: 'const delta = i.countedQtyMilli;' },
  },
  {
    sabotage: 'c1-result-number',
    file: c1,
    test: C1_RESULT,
    ts: { file: COMMANDS, from: "if (Object.values(result).some((v) => v !== null && typeof v !== 'string')) throw new CoreError('internal');", to: '' },
  },
  {
    sabotage: 'c2-raw-error',
    file: c2,
    test: 'C2 a database error reaches the caller as a code, never with row values',
    ts: { file: 'packages/core/src/session.ts', from: 'throw toCoreError(err);', to: 'throw err;' },
  },
  {
    sabotage: 'c3-any-name',
    file: c3,
    test: 'C3 an unregistered name is refused and writes nothing',
    ts: { file: SNAPSHOTS, from: "if (!q) throw new CoreError('unknown_query');", to: "if (!q) return QUERIES.get('stock.on_hand') as NamedQuery;" },
  },
  {
    sabotage: 'c3-read-writable',
    file: c3,
    test: 'C3 a named read cannot write, even a registered one',
    ts: { file: SNAPSHOTS, from: "await c.query('set transaction read only');", to: '' },
  },
  {
    sabotage: 'c3-cell-leak',
    file: c3,
    test: "C3 a ref resolves only in its own tenant; anything else is 'Cannot verify'",
    sql: 'create policy leak on snap.snapshot_cell using (true);',
  },
  {
    sabotage: 'c3-actor-unstamped',
    file: c3,
    test: "C3 a snapshot's actor is stamped by the database: the minting member, or none for a system scope",
    sql: mutate('snap.snapshot_txn()', "new.actor_id := nullif(current_setting('munshi.actor_id', true), '')::uuid;", ''),
  },
  {
    sabotage: 'c4-no-decision',
    file: c4,
    test: 'C4 a draft approved by the owner executes under the owner in one transaction, and its audit chain verifies',
    ts: { file: APPROVALS, from: "await c.query(`select set_config('munshi.decision_id', $1, true)`, [decisionId]);", to: '' },
  },
  {
    sabotage: 'c4-no-recheck',
    file: c4,
    test: 'C4 a draft whose evidence changed goes stale, and nothing executes',
    ts: { file: APPROVALS, from: RECHECK, to: 'const changed: string[] = [];' },
  },
  // The MS-5 review's probe: without the re-check, the write-off after as_of and the approved draft take on-hand to −8.
  { sabotage: 'c4-no-recheck', file: c4, test: C4_AFTER_AS_OF },
  {
    sabotage: 'c4-unchecked-refs',
    file: c4,
    test: 'C4 a draft must cite cells that exist in this tenant, and a payload its command accepts',
    ts: { file: APPROVALS, from: 'if (!(await resolveRef(c, ref)))', to: 'if (!ref)' },
  },
  // ---- MS-1 fix cycle 2 (the MS-5 review) -------------------------------------------------------------------------
  {
    sabotage: 'c4-empty-basedon',
    file: c4,
    test: C4_PAYLOAD,
    ts: { file: APPROVALS, from: 'basedOn: z.array(refSchema).min(1).max(50),', to: 'basedOn: z.array(refSchema).max(50),' },
  },
  { sabotage: 'c4-payload-unmapped', file: c4, test: C4_PAYLOAD, ts: { file: APPROVALS, from: 'if (unmapped.length) throw', to: 'if (false) throw' } },
  {
    sabotage: 'c4-payload-value',
    file: c4,
    test: C4_PAYLOAD,
    ts: { file: APPROVALS, from: "'num' in cell && cell.num === String(n)", to: "'num' in cell" },
  },
  { sabotage: 'c4-payload-kind', file: c4, test: C4_PAYLOAD, ts: { file: APPROVALS, from: 'cell.kind === kind && ', to: '' } },
  {
    sabotage: 'c4-payload-unchecked',
    file: c4,
    test: C4_PAYLOAD_RECHECK,
    ts: { file: APPROVALS, from: RECHECK, to: 'const changed = await recheck(c, draft.based_on);' },
  },
  {
    sabotage: 'c4-dated-evidence',
    file: c4,
    test: C4_CURRENT,
    ts: { file: APPROVALS, from: "if (!current) throw new CoreError('invalid', { fields: ['basedOn'] });", to: '' },
  },
  { sabotage: 'c4-any-item', file: c4, test: C4_CURRENT, ts: { file: APPROVALS, from: ' && snap.params[cur.param] === id', to: '' } },
  {
    sabotage: 'c4-no-item-needed',
    file: c4,
    test: C4_CURRENT,
    ts: { file: APPROVALS, from: 'let current = touched.length > 0;', to: 'let current = true;' },
  },
  {
    sabotage: 'c4-reject-authority',
    file: c4,
    test: C4_AUTHORITY,
    sql: mutate('approval.stamp_decision()', "if new.verdict = 'rejected' and not exists (", 'if false and not exists ('),
  },
  {
    sabotage: 'c4-reject-inactive',
    file: c4,
    test: C4_AUTHORITY,
    sql: mutate('approval.stamp_decision()', 'and m.id = new.decided_by and m.active)', 'and m.id = new.decided_by)'),
  },
  {
    sabotage: 'c4-stale-authority',
    file: c4,
    test: C4_AUTHORITY,
    sql: mutate('approval.draft_status()', "elsif new.status in ('stale', 'failed') and not exists (", 'elsif false and not exists ('),
  },
  {
    sabotage: 'c4-stale-inactive',
    file: c4,
    test: C4_AUTHORITY,
    sql: mutate('approval.draft_status()', '::uuid and m.active) then', '::uuid) then'),
  },
  {
    sabotage: 'c4-session-inactive',
    file: c4,
    test: 'C4 a Session opens only for an active member of its own tenant',
    ts: { file: 'packages/core/src/session.ts', from: "'select 1 from ops.member where id = $1 and active'", to: "'select 1 from ops.member where id = $1'" },
  },
  ...PLANT_KINDS.map((p) => ({ sabotage: `c5-omit-${p}`, file: c5, test: C5_FOUND })),
  {
    sabotage: 'c5-shrinkage-threshold',
    file: c5,
    test: C5_FOUND,
    ts: { file: QUERIES, from: 'and (v.missing * v.unit_cost + 500) / 1000 >= 5000', to: 'and (v.missing * v.unit_cost + 500) / 1000 >= 0' },
  },
  {
    sabotage: 'c5-creep-threshold',
    file: c5,
    test: C5_FOUND,
    ts: { file: QUERIES, from: 'and r.bills >= 2', to: 'and r.bills >= 5' },
  },
  {
    sabotage: 'c5-dedupe-per-run',
    file: c5,
    test: C5_TWICE,
    ts: { file: WATCHERS, from: '[w.kind, dedupeKey, snap.id, i, runId]', to: '[w.kind, dedupeKey + runId, snap.id, i, runId]' },
  },
  // A key that drifts by the day: the same-day re-run cannot see it, the next morning's must.
  {
    sabotage: 'c5-dedupe-drifts',
    file: c5,
    test: C5_TWICE,
    ts: { file: WATCHERS, from: '[w.kind, dedupeKey, snap.id, i, runId]', to: '[w.kind, dedupeKey + day, snap.id, i, runId]' },
  },
  {
    sabotage: 'c5-watcher-actor',
    file: c5,
    test: 'C5 watchers run with no actor and write no book row',
    ts: {
      file: WATCHERS,
      from: "const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');",
      to: "await c.query(\"select set_config('munshi.actor_id', (select id::text from ops.member where role = 'owner' limit 1), true)\"); const { rows: t } = await c.query<{ time_zone: string }>('select time_zone from ops.tenant');",
    },
  },
  // ---- MS-8: the hero chain (shelf count, bill reading, voice) and the two core rules ---------------------------------
  { sabotage: 'h1-count-unhashed', file: h1, test: H1_FORGED, sql: 'alter table ops.shelf_count drop constraint shelf_count_hashed;' },
  { sabotage: 'h1-count-unmatched', file: h1, test: H1_FORGED, sql: 'alter table ops.shelf_count drop constraint shelf_count_matches;' },
  {
    sabotage: 'h1-evidence-optional',
    file: h1,
    test: H1_CELLS,
    ts: { file: APPROVALS, from: 'const bad = rules.filter((r) => !numbers.some(([at]) => general(at) === r.at)).map((r) => r.at);', to: 'const bad: string[] = [];' },
  },
  { sabotage: 'h1-evidence-any-read', file: h1, test: H1_CELLS, ts: { file: APPROVALS, from: 'rows[0]?.query_name !== rule.query || ', to: '' } },
  { sabotage: 'h1-evidence-any-item', file: h1, test: H1_CELLS, ts: { file: APPROVALS, from: " || item?.kind !== 'text' || item.txt !== itemBeside(payload, at)", to: '' } },
  { sabotage: 'h1-evidence-any-item', file: h2, test: H2_UNMATCHED },
  { sabotage: 'h1-expected-unchecked', file: h1, test: H1_CELLS, ts: { file: COMMANDS, from: EXPECTED_CHECK, to: '' } },
  { sabotage: 'h1-expected-unchecked', file: c7, test: C7_RACE },
  { sabotage: 'h1-any-photo', file: h1, test: H1_STILL, ts: { file: PHOTO, from: '  return null;\n}', to: '  return "image/png";\n}' } },
  { sabotage: 'h2-unplaced-sent', file: h2, test: H2_UNPLACED, ts: { file: BILL, from: 'if (!l.qtyAt || !l.rateAt) return refuse("unplaced");', to: '' } },
  { sabotage: 'h2-unplaced-stored', file: h2, test: H2_UNPLACED, sql: 'alter table ops.bill_line drop constraint bill_line_placed;' },
  { sabotage: 'h2-late-line', file: h2, test: H2_LATE, sql: mutate('ops.bill_read_txn()', 'b.created_txid = txid_current()', 'true') },
  { sabotage: 'h2-ambiguous-match', file: h2, test: H2_MATCH, ts: { file: COMMANDS, from: 'return ids.length === 1 ? ids[0] : null;', to: 'return ids[0] ?? null;' } },
  { sabotage: 'h3-transcript-traced', file: h3, test: H3_TRACE, ts: { file: VOICE, from: 'await trace("model", "voice");', to: 'await trace("model", transcript);' } },
  { sabotage: 'c7-waste-below-zero', file: c7, test: C7_WASTE, ts: { file: COMMANDS, from: "await keepsStock(ctx, i.itemId, 'qtyMilli');", to: '' } },
  { sabotage: 'c7-count-below-zero', file: c7, test: C7_COUNT, ts: { file: COMMANDS, from: "if (delta < 0) await keepsStock(ctx, i.itemId, 'countedQtyMilli');", to: '' } },
  { sabotage: 'c7-count-unlocked', file: c7, test: C7_RACE, ts: { file: COMMANDS, from: COUNT_LOCK, to: 'const countedAt = at(i.countedAt);' } },
  {
    sabotage: 'c7-credit-not-current',
    file: c7,
    test: C7_CREDIT,
    ts: { file: APPROVALS, from: "  customerId: { query: 'credit.balance', param: 'customer_id', col: 'balance' },\n", to: '' },
  },
  // packages/core: source-scanning gates (harness-level: a planted file joins the scan) and the pure modules.
  ...BOUNDARY.map(([sabotage, test]) => ({ sabotage, file: 'test/boundary.test.ts', test, dir: 'packages/core' })),
  // B0's own proof of the walk and the follow: the scanner is mutated as vitest loads the gate.
  {
    sabotage: 'b0-walk-skips-fixtures',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: "const AGENT_SKIP = ['node_modules'];", to: "const AGENT_SKIP = ['node_modules', 'fixtures'];" },
  },
  {
    sabotage: 'b0-walk-no-mts',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: 'const CODE = /\\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;', to: 'const CODE = /\\.(ts|tsx|js|jsx|mjs)$/;' },
  },
  {
    sabotage: 'b0-no-follow',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: 'else queue.push(found);', to: 'else continue;' },
  },
  {
    sabotage: 'b0-no-follow-read',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: "if (spec === '@munshi/core/read') queue.push(READ_ENTRY);", to: "if (spec === '@munshi/core/read') void 0;" },
  },
  {
    sabotage: 'u-money-rounding',
    file: 'test/money.test.ts',
    dir: 'packages/core',
    test: 'money: a line amount rounds half away from zero, once',
    ts: { file: 'packages/core/src/money.ts', from: 'Math.floor((Math.abs(exact) + 500) / 1000)', to: 'Math.floor(Math.abs(exact) / 1000)' },
  },
  {
    sabotage: 'u-time-zone',
    file: 'test/time.test.ts',
    dir: 'packages/core',
    test: 'time: a business date is the Asia/Kolkata calendar date',
    ts: { file: 'packages/core/src/time.ts', from: "export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';", to: "export const DEFAULT_TIME_ZONE = 'UTC';" },
  },
  // ---- MS-6 fix cycle 1: cite-or-abstain in packages/agent (a handle is one whole number; units and currency belong to
  // the cell; numbers in words; ids and names), the data blocks, the hard time budget, and the finding checks ----------
  ...(
    [
      ['fc1-handles-joined', FC1_GLUE, NUMBERS, 'if (!/\\p{L}/u.test(gap) && !(GAP_MARK.test(gap) && LIST_GAP.test(gap))) out.add("handle_glue");', 'void gap;'],
      ['fc1-glue-after', FC1_GLUE, NUMBERS, 'if (!CLOSERS.test(gluedAfter)) {', 'if (false) {'],
      ['fc1-scale-beside', 'FC1 a scale or magnitude word or symbol beside a handle is refused, in any case, width or script', NUMBERS, '    if (SCALE.has(w)) out.add("scale_word");\n', ''],
      ['fc1-unit-beside', FC1_UNIT, NUMBERS, '    if (UNIT.has(w)) out.add("unit_or_currency");\n', ''],
      ['fc1-currency-beside', FC1_UNIT, NUMBERS, '    if (/\\p{Sc}/u.test(ch)) out.add("unit_or_currency");\n', ''],
      [
        'fc1-unit-not-rendered',
        'FC1 a money cell renders with its currency sign and a quantity cell with its unit',
        'packages/core/src/read.ts',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of read.ts, not a template
        "return counted ? `${n} ${cell.unit}${Number(cell.num) === 1000 ? '' : 's'}` : n;",
        'return n;',
      ],
      [
        'fc1-number-words',
        'FC1 English number words are refused: cardinals, ordinals, fractions, multiplicatives, compounds, Roman numerals',
        NUMBERS,
        '  if (numberWord(text, names)) out.add("number_word");\n',
        '',
      ],
      ['fc1-hindi-nukta', 'FC1 Hindi number words are refused, with or without the nukta and either nasal mark', NUMBERS, '.replace(/\\u093c/g, "")', ''],
      ['fc1-cjk', 'FC1 CJK numerals are refused', NUMBERS, '  if (CJK.test(plain)) return true;\n', ''],
      ['fc1-id-ref', 'FC1 a ref to an id column is refused, and so is a uuid-shaped text cell', ANSWER, '      if (idRef(ref)) failures.push({ segment: i, rule: "id_ref", ref: k });\n', ''],
      ['fc1-name-digits', FC1_NAME, NUMBERS, '  if (!NAME_COLUMNS.includes(ref.col) && (NUMBERISH.test(t) || numberWord(t))) return "not_a_name";\n', ''],
      [
        'fc1-name-currency',
        FC1_NAME,
        NUMBERS,
        '  if (/\\p{Sc}/u.test(cell.txt + t) || (fold(t).match(WORD) ?? []).some((w) => CURRENCY.has(w))) return "not_a_name";\n',
        '',
      ],
      ['fc1-data-unescaped', FC1_DATA, 'packages/agent/src/tools.ts', '.replace(/[<>⟦⟧]/g, (c) =>', '.replace(/[⟦⟧]/g, (c) =>'],
      ['fc1-data-controls', FC1_DATA, 'packages/agent/src/tools.ts', '    .replace(/\\p{Cf}/gu, "")\n', ''],
      ['fc1-no-deadline', "RUN a model that hangs is cut off at the run's deadline", RUN_TS, 'const r = await generate({ ...req, signal: AbortSignal.timeout(left) }, run.o.deps);', 'const r = await generate(req, run.o.deps);'],
      ['fc1-narrate-overrun', 'RUN narrate is given the time left and no more', RUN_TS, '    run.deadline,\n  );', '    run.deadline + 60_000,\n  );'],
    ] as const
  ).map(([sabotage, test, file, from, to]) => ({ sabotage, file: `test/${file === RUN_TS || file.endsWith('tools.ts') ? 'run' : 'answer'}.test.ts`, test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file, from, to } })),
  { sabotage: 'fc1-stale-finding', file: a1, test: A1_STALE, ts: { file: RUN_TS, from: '  if (!f.current) return abstain(run, null, ["finding_stale"]);\n', to: '' } },
  { sabotage: 'fc1-dedupe-not-current', file: a1, test: A1_STALE, ts: { file: WATCHERS, from: '= cardinality($4::text[])', to: '= -1' } },
  {
    sabotage: 'fc1-closed-finding',
    file: a1,
    test: 'A1 a dismissed or resolved finding is neither explained nor drafted',
    ts: { file: RUN_TS, from: '  if (f.status !== "open") return abstain(run, null, ["finding_closed"]);\n', to: '' },
  },
  // ---- MS-8 fix cycle 1 (the fa53b7d review failed clause 2): number words checked against independent tables, other
  // scripts, Roman numerals in any case, look-alike letters, number symbols, signs and decimals beside a handle, names
  // with no letter; the shelf prompt's names as data; the vision quarantine; a phrase's figures; the count's age; one
  // bill per purchase draft; who stores a count ---------------------------------------------------------------------
  ...(
    [
      ['ms8-hindi-word', MS8_HI, NUMBERS, '"छत्तीस", ', ''],
      ['ms8-hindi-endings', MS8_HI, NUMBERS, '  if (HINDI_ENDS.some((e) => w.endsWith(e) && HINDI.has(w.slice(0, -e.length)))) return true;\n', ''],
      ['ms8-latin-word', MS8_LATN, NUMBERS, '"chalis", ', ''],
      ['ms8-latin-skeleton', MS8_LATN, NUMBERS, '  const s = skeleton(w);\n', '  const s = w;\n'],
      ['ms8-latin-endings', MS8_LATN, NUMBERS, ' || HINDI_LATIN_ENDINGS.some((e) => s.endsWith(e) && LATIN_CARDINAL.has(skeleton(s.slice(0, -e.length))))', ''],
      ['ms8-accents', MS8_LATN, NUMBERS, 'shown(text).normalize("NFD").replace(/([A-Za-z])\\p{M}+/gu, "$1")', 'shown(text)'],
      ['ms8-roman-any-case', MS8_ROMAN, NUMBERS, '    if (!elided && ROMAN.test(w.toUpperCase()) && !ROMAN_WORDS.includes(w)) return true;\n', '    if (w.length > 1 && w === w.toUpperCase() && ROMAN.test(w)) return true;\n'],
      ['ms8-digit-like', MS8_ROMAN, NUMBERS, ' && [...w].every((c) => DIGIT_LIKE.includes(c)) && ', ' && false && '],
      ['ms8-number-symbols', MS8_ROMAN, NUMBERS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ms8-number-symbols', MS8_PROBE, NUMBERS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ms8-other-script', MS8_SCRIPT, NUMBERS, '  if (otherScript(text)) out.add("other_script");\n', ''],
      ['ms8-other-script', MS8_PROBE, NUMBERS, '  if (otherScript(text)) out.add("other_script");\n', ''],
      ['ms8-signs-beside', 'MS8 a sign, a decimal or a fraction word beside a handle is refused as a scale', NUMBERS, '  if (!/\\p{L}/u.test(chunk) && [...chunk].some((ch) => SIGNS.includes(ch))) out.add("scale_word");\n', ''],
      ['ms8-scale-words', 'MS8 a sign, a decimal or a fraction word beside a handle is refused as a scale', NUMBERS, '  "minus", "negative", "neg", "point", "decimal", "dot", "ऋण", "दशमलव", "बिंदु", "माइनस", "नेगेटिव", "पॉइंट",\n', ''],
      ['ms8-name-no-letter', MS8_NAMES, NUMBERS, '  if (!/\\p{L}/u.test(t)) return "not_a_name"; // "15000" is no name\n', ''],
      ['ms8-name-lone-figure', MS8_NAMES, NUMBERS, '  if (PARTY_COLUMNS.includes(ref.col) && loneFigure(t)) return "not_a_name";\n', ''],
    ] as const
  ).map(([sabotage, test, file, from, to]) => ({ sabotage, file: 'test/answer.test.ts', test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file, from, to } })),
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of shelf.ts, not a template
  { sabotage: 'h1-shelf-raw-names', file: h1, test: H1_FORGE, ts: { file: SHELF, from: '${asData(JSON.stringify(txt(row.item) ?? ""))}', to: '${txt(row.item) ?? ""}' } },
  { sabotage: 'h1-shelf-unescaped', file: h1, test: H1_FORGE, ts: { file: SHELF, from: 'asData(JSON.stringify(txt(row.item)', to: '(JSON.stringify(txt(row.item)' } },
  ...[h1, h2].flatMap((file) => [
    {
      sabotage: 'vision-tools-offered',
      file,
      test: file === h1 ? H1_QUARANTINE : H2_QUARANTINE,
      ts: { file: PHOTO, from: LOOK, to: 'const r = await generate({ ...req, role: "vision", tools: [{ name: "items_list", description: "x", parameters: { type: "object", properties: {} } }] }, o.deps);' },
    },
    { sabotage: 'vision-tool-call-used', file, test: file === h1 ? H1_QUARANTINE : H2_QUARANTINE, ts: { file: PHOTO, from: TOOL_CALL, to: 'if (r.json === undefined) return "tool_call";' } },
  ]),
  { sabotage: 'h1-phrase-digits', file: h1, test: H1_PHRASES, ts: { file: SHELF, from: 'p.phrase.replace(/\\p{N}/gu, "")', to: 'p.phrase' } },
  { sabotage: 'h1-phrase-words', file: h1, test: H1_PHRASES, ts: { file: SHELF, from: 'if (phrase && textRules(phrase).length === 0) unrecognised.push(phrase);', to: 'if (phrase) unrecognised.push(phrase);' } },
  { sabotage: 'h1-count-age-proposal', file: h1, test: H1_AGE, ts: { file: APPROVALS, from: 'return [...new Set([...bad, ...(await tooOld(c, command, refs))])];', to: 'return bad;' } },
  {
    sabotage: 'h1-count-age-approval',
    file: h1,
    test: H1_AGE,
    ts: { file: APPROVALS, from: '    for (const at of await tooOld(c, draft.command_type, draft.payload_refs)) changed.push(formatRef(draft.payload_refs[at] as CellRef));\n', to: '' },
  },
  { sabotage: 'h1-count-age-default', file: h1, test: H1_AGE, sql: "alter table ops.tenant alter column count_max_age set default interval '1 day';" },
  { sabotage: 'h1-count-stamp-now', file: h1, test: H1_AGE, ts: { file: 'packages/core/src/queries-count.ts', from: 'sc.created_at as counted_at', to: 'now() as counted_at' } },
  // Harness-level: a planted source file joins the scan.
  { sabotage: 'h1-count-writer-elsewhere', file: h1, test: H1_WRITERS },
  { sabotage: 'h1-count-binding-forged', file: h1, test: H1_WRITERS },
  { sabotage: 'h1-count-core-elsewhere', file: h1, test: H1_WRITERS },
  { sabotage: 'h2-bill-header-supplier', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: "supplierId: 'supplier_id', ", to: '' } },
  { sabotage: 'h2-bill-header-number', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: "billNo: 'bill_no', ", to: '' } },
  { sabotage: 'h2-bill-header-date', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: " billDate: 'bill_date' ", to: ' ' } },
  { sabotage: 'h2-bill-line-split', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: '    if ((lineOf.get(n) ?? source) !== source) bad.add(', to: '    if (false) bad.add(' } },
  { sabotage: 'h2-bill-line-twice', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: ' || new Set(lineOf.values()).size < lineOf.size', to: '' } },
  { sabotage: 'h2-bill-two-reads', file: h2, test: H2_ONE_BILL, ts: { file: APPROVALS, from: 'if (bills.size > 1 || ', to: 'if (' } },
  // ---- MS-12: homographs are numbers only in a quantity context (the precision corpus flips both ways: a homograph read
  // as a number anywhere fails clean; each context switched off lets an attack through), the run's names reach the
  // validator, and a bill backs one purchase ---------------------------------------------------------------------------
  ...(
    [
      ['ms12-homograph-anywhere', MS12_CLEAN, '  if (!names) return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));', '  return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));'],
      ['ms12-no-do-not', MS12_CLEAN, '    if (w === "do" && n !== null && toks[n]?.w === "not" && SPACED.test(after(i))) continue;\n', ''],
      ['ms12-no-light-verb', MS12_CLEAN, ' && LIGHT_VERB.has(verb.w) && ', ' && false && '],
      ['ms12-no-abbreviation', MS12_CLEAN, '(_, i) => (i ? "ie" : "eg")', '(m) => m'],
      ['ms12-no-tin-container', MS12_CLEAN, ' && (COLLECTIVE.has(w) || !DETERMINER.has(toks[p ?? -1]?.w ?? ""))', ''],
      ['ms12-no-context', MS12_ATTACKS, ' || quantityContext(text, names);', ';'],
      ['ms12-ctx-beside', MS12_ATTACKS, '    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;\n', ''],
      ['ms12-ctx-beside', MS12_DROPPED, '    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;\n', ''],
      ['ms12-ctx-count-noun', MS12_ATTACKS, '    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;\n', ''],
      ['ms12-ctx-count-noun', MS12_DROPPED, '    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;\n', ''],
      ['ms12-ctx-modifiers', MS12_ATTACKS, '      while (chained(j) && MODIFIER.has(toks[j]?.w ?? "")) j++;\n', ''],
      ['ms12-ctx-of', MS12_ATTACKS, '        if (chained(j) && OF_PRONOUN.has(toks[j]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-label', MS12_ATTACKS, '    if (/[:=\\-–—]\\s*$/u.test(before(i)) && /^\\s*(?:[.!?;।॥…,]|$)/u.test(after(i))) return true;\n', ''],
      ['ms12-ctx-quantifier', MS12_ATTACKS, '    if (QUANTIFIED.has(w) && p !== null && QUANTIFIER.has(toks[p]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-mein-se', MS12_ATTACKS, '    if (w === EK && p !== null && toks[p]?.w === "से" && /में$/u.test(toks[p - 1]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-after-ek', MS12_ATTACKS, '    if (w === EK && n !== null && AFTER_ONE.has(toks[n]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-hindi', MS12_ATTACKS, '    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;\n', ''],
      ['ms12-ctx-hindi', MS12_DROPPED, '    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;\n', ''],
      ['ms12-ctx-light-verb-follow', MS12_ATTACKS, '      if (n !== null && SPACED.test(after(i)) && (amount(n) || COUNT.has(toks[n]?.w ?? ""))) return true;\n', ''],
      ['ms12-names-dropped', MS12_ATTACKS, '    for (const w of fold(name).match(WORD) ?? []) {', '    for (const w of [] as string[]) {'],
      ['ms12-ctx-glued', MS12_ATTACKS, '  if (words.some(glued)) return true;\n', ''],
      ['ms12-ctx-alone', MS12_ATTACKS, '    if (p === null && n === null) return true;\n', ''],
      ['ms12-shelf-contextual', MS12_SHELF, 'export const textRules = (text: string): Rule[] => rulesOf(text);', 'export const textRules = (text: string): Rule[] => rulesOf(text, new Set());'],
    ] as const
  ).map(([sabotage, test, from, to]) => ({ sabotage, file: 'test/corpus.test.ts', test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file: NUMBERS, from, to } })),
  {
    sabotage: 'ms12-run-names',
    file: 'test/run.test.ts',
    dir: 'packages/agent',
    config: AGENT_CONFIG,
    test: MS12_RUN_NAMES,
    ts: { file: RUN_TS, from: '(ref) => run.o.port.resolve(ref), namesRead(run));', to: '(ref) => run.o.port.resolve(ref));' },
  },
  {
    sabotage: 'ms12-bill-twice-approval',
    file: h2,
    test: MS12_ONE_BILL,
    ts: {
      file: APPROVALS,
      from: "    if (draft.command_type === 'purchase.record' && (await billRecorded(c, draft.payload))) changed.push(...Object.values(draft.payload_refs).map(formatRef));\n",
      to: '',
    },
  },
  {
    sabotage: 'ms12-bill-twice-proposal',
    file: h2,
    test: MS12_ONE_BILL,
    ts: { file: APPROVALS, from: "    if (d.command === 'purchase.record' && (await billRecorded(c, payload))) throw new CoreError('conflict', { fields: ['billNo'] });\n", to: '' },
  },
  {
    sabotage: 'fc1-second-draft',
    file: a1,
    test: 'A1 one draft per finding awaits a decision: draftFix proposes no second one',
    ts: { file: RUN_TS, from: '  if (f.openDraft) return { kind: "none", reason: "open_draft" };\n', to: '' },
  },
  ...MS19A,
  // ---- MS-22b: one number detector for core and the agent (B5), and the span parser (EX2) ----------------------------
  ...(
    [
      ['ms22b-core-number-word', B5_CORPUS, '"चौबीस", ', ''],
      ['ms22b-core-numberish', B5_CORPUS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ex2-percent', EX2_REFUSED, '  if (/[%‰‱٪]/u.test(folded) || (folded.match(WORD) ?? []).some((w) => PERCENT.has(wordKey(w)))) return refuse("percent");\n', ''],
      ['ex2-grouping', EX2_REFUSED, '  if (ascii.includes(",") && !/^(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}(?:,\\d{2})+,\\d{3})(?:\\.\\d+)?$/.test(ascii)) return refuse("grouping");\n', ''],
      ['ex2-mixed-script', EX2_REFUSED, '    if (zero !== undefined && z !== zero) return { refusal: "mixed_script" };\n', ''],
      ['ex2-hindi-value', EX2_HINDI, '36 छत्तीस chhattis', '37 छत्तीस chhattis'],
      ['ex2-falling-scales', EX2_REFUSED, ' || scale >= above || q * scale >= above * 4', ''],
      ['ex2-weekday-today', EX2_DATES, 'ahead === 0 ? refuse("ambiguous") : ', ''],
      ['ex2-year-roll', EX2_DATES, '  if (!c && sign * (day < ask.today ? -1 : day > ask.today ? 1 : 0) < 0) day = on(thisYear + sign);\n', ''],
    ] as const
  ).map(([sabotage, test, from, to]) => ({ sabotage, file: 'test/numbers.test.ts', test, dir: 'packages/core', ts: { file: NUMBERS, from, to } })),
];

// Planted cases that cannot apply: redproof runs them first and must call each ERROR (its own red-proof).
export const PLANTED: Case[] = [
  {
    sabotage: 'planted-unappliable-sql',
    file: g2,
    test: 'G2 a rejected decision is refused',
    sql: mutate('books.guard()', 'text that books.guard does not contain', ''),
  },
  {
    sabotage: 'planted-unappliable-ts',
    file: g2,
    test: 'G2 a rejected decision is refused',
    ts: { file: 'db/test/db.ts', from: 'text that db.ts does not contain', to: '' },
  },
  // Harness-level, but no code asks for it: nothing applies, which is what a deleted sabotage hook looks like.
  { sabotage: 'planted-unapplied', file: g2, test: 'G2 a rejected decision is refused' },
];

const ALL = [...CASES, ...PLANTED];
const known = (name: string) => ALL.filter((c) => c.sabotage === name);

export function reportSabotage(name: string, outcome: 'applied' | 'failed', detail = ''): void {
  const file = process.env.MUNSHI_SABOTAGE_REPORT;
  if (file) appendFileSync(file, `${outcome} ${name}${detail ? ` ${detail.replace(/\s+/g, ' ')}` : ''}\n`);
}

// Harness-level sabotage: true when `name` is the current sabotage (and reports it applied).
export function sabotageIs(name: string): boolean {
  const cases = known(name);
  if (cases.length === 0 || cases.some((c) => c.sql || c.ts)) throw new Error(`${name} is not a harness-level sabotage`);
  if (process.env.MUNSHI_SABOTAGE !== name) return false;
  reportSabotage(name, 'applied');
  return true;
}

// The SQL of an sql case; undefined for ts and harness-level cases; throws for an unknown name.
export function sabotageSql(name: string): string | undefined {
  const cases = known(name);
  if (cases.length === 0) throw new Error(`unknown sabotage ${name}`);
  return cases.find((c) => c.sql)?.sql;
}

// A vite plugin applying the current ts case to its module's source as vitest loads it. The text must occur exactly
// once; otherwise the case reports failed (and the import throws), so a stale mutation is an ERROR, not a red.
export function sabotagePlugin(repoRoot: string) {
  const name = process.env.MUNSHI_SABOTAGE;
  const m = name ? known(name).find((c) => c.ts)?.ts : undefined;
  const target = m ? `${repoRoot.replace(/\/$/, '')}/${m.file}` : undefined;
  return {
    name: 'munshi-sabotage',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!name || !m || id.split('?')[0] !== target) return null;
      if (code.split(m.from).length !== 2) {
        reportSabotage(name, 'failed', `${m.file} does not contain the text to break exactly once`);
        throw new Error(`sabotage ${name}: ${m.file} does not contain the text to break exactly once`);
      }
      reportSabotage(name, 'applied');
      return code.replace(m.from, m.to);
    },
  };
}
