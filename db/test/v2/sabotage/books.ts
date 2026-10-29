// Red-proofs of the book guard, the audit digest and verify_books (test/v2/gates/02-books-guard.test.ts), each breaking
// one rule of books.write, books.audit_row or audit.verify_books in the clone, or the probe tables' triggers and grants.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/02-books-guard.test.ts';
const WRITE = 'books.write()';

export const BOOKS_CASES: Case[] = [
  {
    sabotage: 'v2-g2-no-command',
    file: FILE,
    test: 'G2 a book write with no decision and no direct command is refused',
    config: V2,
    sql: mutate(WRITE, "raise exception 'book write refused: no approved decision and no direct command' using errcode = 'MS001';", 'return new;'),
  },
  {
    // the caller's created_txid survives the stamp
    sabotage: 'v2-g2-stamp',
    file: FILE,
    test: 'G2 a direct command the acting member holds is accepted, stamped whatever the caller sent, and audited with the row digest',
    config: V2,
    sql: mutate(WRITE, "'created_txid', txid_current()", "'created_txid', new.created_txid"),
  },
  {
    sabotage: 'v2-g2-no-authority',
    file: FILE,
    test: 'G2 a member without the authority, an inactive member, a member of another tenant, and a draft-only command run directly are refused',
    config: V2,
    sql: mutate(WRITE, 'join ref.command_authority ca on ca.role = m.role and ca.command = ctx_command', 'join ref.command_authority ca on ca.command = ctx_command'),
  },
  {
    sabotage: 'v2-g2-other-tenant',
    file: FILE,
    test: 'G2 a row for another tenant is refused, and only munshi_app writes the books',
    config: V2,
    sql: mutate(WRITE, "if current_user <> 'munshi_app' then", 'if false then'),
  },
  {
    sabotage: 'v2-g2-table-scope',
    file: FILE,
    test: 'G2 an approved decision of this transaction, by the acting member, admits its draft-only command for its own tables only',
    config: V2,
    sql: mutate(WRITE, 'perform 1 from ref.command_table ct where ct.command = by_command and ct.rel = this_rel;', 'perform 1;'),
  },
  {
    sabotage: 'v2-g2-earlier-decision',
    file: FILE,
    test: 'G2 a decision from an earlier transaction, a rejected one, or one made by another member than the actor is refused',
    config: V2,
    sql: mutate(WRITE, 'and d.created_txid = txid_current() and d.decided_by = ctx_actor', ''),
  },
  {
    // the harness sets the context session-wide instead of transaction-local
    sabotage: 'v2-g2-session-set',
    file: FILE,
    test: 'G2 context does not survive the transaction on a pooled connection',
    config: V2,
    ts: { file: 'db/test/v2/db.ts', from: "'select set_config($1, $2, true)'", to: "'select set_config($1, $2, false)'" },
  },
  {
    sabotage: 'v2-g2-reversal-amount',
    file: FILE,
    test: 'G2 a reversal is the exact opposite of an unreversed original, once, and its children reverse the original children under the reversal header',
    config: V2,
    sql: mutate(WRITE, 'if (r ->> col)::numeric is distinct from -((orig ->> col)::numeric) then', 'if false then'),
  },
  {
    sabotage: 'v2-g11-parent-txid',
    file: FILE,
    test: 'G11 a child book row is accepted only in its parent transaction',
    config: V2,
    sql: mutate(WRITE, "(parent ->> 'created_txid')::bigint is distinct from txid_current()", 'false'),
  },
  {
    sabotage: 'v2-g5-update',
    file: FILE,
    test: 'G5 an UPDATE or DELETE of a book row is refused, even as the owner; the one delete is the sandbox reset, as the owner, on a sandbox, off live',
    config: V2,
    sql: mutate(WRITE, "if tg_op = 'UPDATE' then", "if tg_op = 'UPDATE' and false then"),
  },
  {
    // the sandbox delete branch without its sandbox clause (SANDBOX1's red-proof)
    sabotage: 'v2-g5-sandbox-clause',
    file: FILE,
    test: 'G5 an UPDATE or DELETE of a book row is refused, even as the owner; the one delete is the sandbox reset, as the owner, on a sandbox, off live',
    config: V2,
    sql: mutate(WRITE, 'and exists (select 1 from ops.tenant t where t.tenant_id = old.tenant_id and t.sandbox)', ''),
  },
  {
    sabotage: 'v2-g3-orphan-command',
    file: FILE,
    test: 'G3 every command held writes a books table and every books table is written by a command; no runtime role changes ref',
    config: V2,
    sql: asOwner("insert into ref.command (command, draft_only) values ('probe.orphan', false);"),
  },
  {
    sabotage: 'v2-trg1-stray',
    file: FILE,
    test: 'TRG1 every books table has exactly its declared triggers, in a_, b_, z_ order, and its b_ rules are its ref.book_table rules',
    config: V2,
    sql: asOwner('create trigger b_stray before insert on books.probe for each row execute function ops.only_from_trigger();'),
  },
  {
    sabotage: 'v2-trg1-rename',
    file: FILE,
    test: 'TRG1 every books table has exactly its declared triggers, in a_, b_, z_ order, and its b_ rules are its ref.book_table rules',
    config: V2,
    sql: asOwner('alter trigger a_write on books.probe_line rename to guard;'),
  },
  {
    sabotage: 'v2-j1-jobs-insert',
    file: FILE,
    test: 'J1 the jobs role holds no INSERT on any books table, and every insert it attempts is refused',
    config: V2,
    sql: 'grant insert on books.probe to munshi_jobs;',
  },
  {
    sabotage: 'v2-vb1-no-digest',
    file: FILE,
    test: 'VB1 verify_books finds a row edited with triggers disabled, a deleted row and a row with no entry, and nothing in a clean table',
    config: V2,
    sql: mutate(
      'audit.verify_books(uuid,text,uuid,uuid)',
      "or a.row_digest is distinct from sha256(convert_to(to_jsonb(t)::text, ''UTF8''))",
      '',
    ),
  },
  {
    sabotage: 'v2-vb1-tz',
    file: FILE,
    test: 'VB1-TZ digests written under one session zone verify under another (UTC, New York, Kolkata)',
    config: V2,
    sql: 'alter function books.audit_row() reset timezone;',
  },
];
