// Red-proofs: each case breaks one protection in a fresh test database (or in the harness) and names the gate test
// that must then fail. test/redproof.ts runs every case and also checks each named test passes when nothing is broken.

export type Case = { sabotage: string; file: string; test: string; sql?: string };

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

export const CASES: Case[] = [
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
  {
    sabotage: 'g3-authority-writable',
    file: g3,
    test: 'G3 no runtime role can change who holds which command',
    sql: 'grant insert on ops.command_authority to munshi_app;',
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
];

const HARNESS_ONLY = new Set(['g2-session-set', 'g8-exit-hook']);

export function sabotageSql(name: string): string | undefined {
  if (HARNESS_ONLY.has(name)) return undefined;
  const sql = CASES.find((c) => c.sabotage === name && c.sql)?.sql;
  if (!sql) throw new Error(`unknown sabotage ${name}`);
  return sql;
}
