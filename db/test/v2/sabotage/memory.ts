// Red-proofs of the memory gates (test/v2/gates/23-memory.test.ts, W2-A, M3). They join the registry through
// spend.ts's SPEND_CASES, so sabotage/index.ts is unchanged.
import type { Case } from './case.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const FILE = 'test/v2/gates/23-memory.test.ts';
const V2 = 'vitest.v2.config.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const STAMP = 'ai.memory_stamp()';
const END = 'ai.memory_end_stamp()';
const KEEP = 'ai.memory_text_keep()';
const READ = 'ai.memory_in_force()';
const NAMES = 'ai.memory_names_erased(uuid,jsonb)';
const GUARD = 'ops.message_text_guard()';

// Empties one line of the stamp's digit class (`|| '<ranges>' -- digits: <group>`), found by its marker; raises unless
// exactly one line matches, so a stale case is an ERROR.
const dropDigits = (group: string) => {
  const pattern = `'[^']*' -- digits: ${group}\n`;
  const to = `'' -- digits: ${group}\n`;
  return `do $sabotage$
declare
  def text := pg_get_functiondef(${q(STAMP)}::regprocedure);
begin
  if regexp_count(def, ${q(pattern)}) <> 1 then
    raise exception 'sabotage: % has no single line of % digits', ${q(STAMP)}, ${q(group)};
  end if;
  execute regexp_replace(def, ${q(pattern)}, ${q(to)});
end $sabotage$;`;
};

const MEM1 = 'MEM1 an owner or manager notes a decision of their shop: stamped with the writer, audited by ids, read in force with its words';
const MEM2 =
  "MEM2 a note holds no digit character of any script, raw or under NFKC; is 1 to 160 characters of the writer's own new text, not only spaces, naming each id once; holds at most a year from now; a declined note cites a rejection";
const MEM3 = "MEM3 a note citing another shop's decision is refused";
const MEM4 =
  'MEM4 staff, an inactive or other-shop member, a member who may not decide the command, the app with no actor, the jobs role and the agent cannot write or end a note';
const MEM5 = 'MEM5 no role updates or deletes a note or its end, and a note ends once';
const MEM6 = "MEM6 another shop cannot read a shop's notes or ends, the tables' owner included (RLS forced)";
const MEM7 = 'MEM7 the in-force read lists live notes newest first; an ended note, a note past valid_to and a note not yet valid are not in force';
const MEM8 =
  "MEM8 an owner's erasure (the contact first, then the words) leaves the name nowhere in ai.* and the note out of force; the jobs purge keeps an in-force note's words and takes them once it ends";
const MEM9 =
  'MEM9 an erasure the jobs runner completes (no actor, after an open balance) blanks the words of in-force notes about the erased person, by contact, customer or supplier id, and only theirs';
const MEM10 =
  'MEM10 only the owner forgets a note; superseding needs a member who may decide its command and a newer note of theirs in the same transaction';
const MEM11 = 'MEM11 at valid_to a note is out of force and the purge takes its words, as it takes an expired note';

const open = (table: string) => `drop policy tenant_isolation on ${table}; create policy tenant_isolation on ${table} using (true) with check (true);`;

export const MEMORY_CASES: Case[] = [
  t(MEM1, 'v2-mem-stamp-writer', mutate(STAMP, 'new.created_by := ctx_actor;', '')),
  t(MEM1, 'v2-mem-audit', asOwner('drop trigger audit on ai.memory;')),
  // One case per line of the digit class: each holds characters NFKC does not fold to ASCII, so each can fail.
  ...['ascii', 'arabic', 'indic', 'other-bmp', 'other-astral', 'forms-bmp', 'forms-astral'].map((g) => t(MEM2, `v2-mem-digits-${g}`, dropDigits(g))),
  t(MEM2, 'v2-mem-digits-nfkc', mutate(STAMP, ' or normalize(words.body, NFKC) ~ digits then', ' then')),
  t(MEM2, 'v2-mem-digits-raw', mutate(STAMP, 'if words.body ~ digits or ', 'if ')),
  t(MEM2, 'v2-mem-length', mutate(STAMP, 'not between 1 and 160', 'not between 1 and 200')),
  t(MEM2, 'v2-mem-blank', mutate(STAMP, "if normalize(words.body, NFKC) !~ '[^", "if false and normalize(words.body, NFKC) !~ '[^")),
  // A format character NFKC keeps (the word joiner): the blank test sees it as no word.
  t(MEM2, 'v2-mem-blank-unicode', mutate(STAMP, '\\u205F-\\u2060', '\\u205F')),
  t(MEM2, 'v2-mem-words-own', mutate(STAMP, ' or words.created_by is distinct from ctx_actor', '')),
  t(MEM2, 'v2-mem-words-new', mutate(STAMP, ' or words.created_at <> now()', '')),
  t(MEM2, 'v2-mem-words-member', mutate(STAMP, " or words.author <> 'member'", '')),
  t(MEM2, 'v2-mem-backdate', mutate(STAMP, 'if new.valid_from < now() then', 'if false then')),
  t(MEM2, 'v2-mem-window', dropCheck('ai.memory', '(valid_to > valid_from)')),
  t(MEM2, 'v2-mem-year', dropCheck('ai.memory', '365 days')),
  t(MEM2, 'v2-mem-valid-to-required', asOwner('alter table ai.memory alter column valid_to drop not null;')),
  t(MEM2, 'v2-mem-declined', mutate(STAMP, "if new.kind = 'declined' and verdict <> 'rejected' then", 'if false then')),
  t(MEM2, 'v2-mem-about', dropCheck('ai.memory', 'jsonb_array_length(about) <= 8')),
  t(MEM2, 'v2-mem-about-once', mutate(STAMP, '<> jsonb_array_length(new.about) then', '<> jsonb_array_length(new.about) and false then')),
  t(MEM3, 'v2-mem-decision-shop', mutate(STAMP, 'if not found then', 'if false then')),
  t(MEM4, 'v2-mem-writer-role', mutate(STAMP, "and m.active and m.role in ('owner', 'manager')", 'and m.active')),
  t(MEM4, 'v2-mem-writer-active', mutate(STAMP, 'm.id = ctx_actor and m.active and', 'm.id = ctx_actor and')),
  t(MEM4, 'v2-mem-writer-tenant', mutate(STAMP, 'where m.tenant_id = new.tenant_id and m.id = ctx_actor', 'where m.id = ctx_actor')),
  t(
    MEM4,
    'v2-mem-writer-actor',
    mutate(STAMP, "if current_user <> 'munshi_app' or writer_role is null then", "if current_user <> 'munshi_app' or (writer_role is null and ctx_actor is not null) then"),
  ),
  t(MEM4, 'v2-mem-authority', mutate(STAMP, 'if not exists (select 1 from ref.command_authority ca', 'if false and not exists (select 1 from ref.command_authority ca')),
  t(MEM4, 'v2-mem-jobs-grant', 'grant insert on ai.memory to munshi_jobs;'),
  // The agent is refused by the guard's own read of ops.member (42501) even with a grant, so the grant is G1's to catch.
  {
    sabotage: 'v2-mem-agent-grant',
    file: 'test/v2/gates/manifest.test.ts',
    test: 'G1 the agent holds no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any table or view',
    config: V2,
    sql: 'grant insert on ai.memory_end to munshi_agent;',
  },
  t(MEM4, 'v2-mem-end-role', mutate(END, "m.active and m.role in ('owner', 'manager')", 'm.active')),
  t(MEM4, 'v2-mem-end-active', mutate(END, 'm.id = ctx_actor and m.active and', 'm.id = ctx_actor and')),
  t(MEM4, 'v2-mem-end-stamp', mutate(END, 'new.ended_by := ctx_actor;', '')),
  t(MEM5, 'v2-mem-update', 'grant update (kind) on ai.memory to munshi_app;'),
  t(MEM5, 'v2-mem-end-delete', 'grant delete on ai.memory_end to munshi_app;'),
  t(MEM5, 'v2-mem-end-once', asOwner('alter table ai.memory_end drop constraint memory_end_pkey;')),
  t(MEM6, 'v2-mem-rls-policy', open('ai.memory')),
  t(MEM6, 'v2-mem-rls-force', asOwner('alter table ai.memory no force row level security;')),
  t(MEM6, 'v2-mem-end-rls-policy', open('ai.memory_end')),
  t(MEM6, 'v2-mem-end-rls-force', asOwner('alter table ai.memory_end no force row level security;')),
  t(MEM7, 'v2-mem-read-ended', mutate(READ, 'e.memory_id = n.id', 'false')),
  t(MEM7, 'v2-mem-read-expired', mutate(READ, 'and n.valid_to > now()', '')),
  t(MEM7, 'v2-mem-read-future', mutate(READ, 'n.valid_from <= now() and ', '')),
  t(MEM7, 'v2-mem-read-order', mutate(READ, 'order by n.valid_from desc, n.id desc', 'order by n.id')),
  t(MEM8, 'v2-mem-read-erased', mutate(READ, 'and t.erased_at is null', '')),
  t(MEM8, 'v2-mem-keep', asOwner('drop trigger memory_keep on ops.message_text;')),
  t(MEM8, 'v2-mem-keep-ended', mutate(KEEP, 'e.memory_id = n.id', 'false')),
  t(MEM8, 'v2-mem-keep-person', mutate(KEEP, "nullif(current_setting('munshi.actor_id', true), '') is null", 'true')),
  t(MEM8, 'v2-mem-names-contact', mutate(NAMES, 'p_about ? ct.id::text', 'false')),
  t(MEM9, 'v2-mem-purge-erased', mutate(GUARD, 'and ai.memory_names_erased(n.tenant_id, n.about))', 'and false)')),
  t(MEM9, 'v2-mem-keep-erased', mutate(KEEP, 'and not ai.memory_names_erased(n.tenant_id, n.about)', '')),
  t(MEM9, 'v2-mem-names-live', mutate(NAMES, 'and ct.erased_at is not null', '')),
  t(MEM9, 'v2-mem-names-customer', mutate(NAMES, 'p_about ? p.customer_id::text or ', '')),
  t(MEM9, 'v2-mem-names-supplier', mutate(NAMES, ' or p_about ? p.supplier_id::text', '')),
  t(MEM10, 'v2-mem-forget-owner', mutate(END, "if new.reason = 'forgotten' and ender_role <> 'owner' then", 'if false then')),
  t(MEM10, 'v2-mem-supersede-authority', mutate(END, 'if not exists (select 1 from ref.command_authority ca', 'if false and not exists (select 1 from ref.command_authority ca')),
  t(MEM10, 'v2-mem-supersede-newer', mutate(END, 'and n.id > new.memory_id) then', 'and n.id > new.memory_id) and false then')),
  t(MEM10, 'v2-mem-supersede-same-tx', mutate(END, ' and n.created_txid = txid_current()', '')),
  t(MEM10, 'v2-mem-supersede-own', mutate(END, 'n.created_by = ctx_actor and ', '')),
  t(MEM10, 'v2-mem-end-audit', asOwner('drop trigger audit on ai.memory_end;')),
  t(MEM11, 'v2-mem-read-boundary', mutate(READ, 'and n.valid_to > now()', 'and n.valid_to >= now()')),
  t(MEM11, 'v2-mem-keep-boundary', mutate(KEEP, 'n.valid_to > now()', 'n.valid_to >= now()')),
  t(MEM11, 'v2-mem-keep-expired', mutate(KEEP, 'n.valid_to > now()', 'true')),
];
