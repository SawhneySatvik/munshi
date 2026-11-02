-- 23 · Memory (W2-A, M3): short notes Munshi's agents may read as context, each derived from one decision and citing
-- it. A note is not the books: it changes no ledger and is never executed; it is context, written by a person.
--
-- A note's words live in ops.message_text (05), never in ai.*, as an answer's do (review B2): ai.memory keeps ids,
-- codes and times only, so the note is append-only and a person's erasure blanks its words through message_text's own
-- erasure path, while the note's row and its decision stay. ops.message_text_guard() is redefined here (create or
-- replace, as 19 redefines 05's) to let the jobs runner blank a note's words once a person it is about is erased, so no
-- earlier file names ai.memory and every prefix purges as it did. The jobs purge's 30-day sweep of texts nothing names
-- (19) is held off a note's words while the note is in force (ai.memory_text_keep, below).
-- No column here names a table of a later file.
set local role munshi_owner;

-- One note. Written by the app as an active owner or manager of the shop, whose role may decide the cited decision's
-- command (ref.command_authority, as stamp_decision and the book guard read it). The writer's contract:
--   kind         'preference' (a standing wish), 'declined' (why a draft was turned down; its decision is a rejection),
--                'note' (anything else worth keeping)
--   text_id      the note's words: an ops.message_text the same member wrote in this same transaction (author 'member',
--                created_at = now()), 1 to 160 characters, not only spaces. One note per text.
--                No digit character at all: memory never stores a number. The schema refuses, in the words as written and
--                in their NFKC form (㈠ folds to Han, so only the raw words show it), every Unicode decimal digit (Nd: ASCII, Arabic-Indic, every Indic script, Thai, Tibetan,
--                Myanmar, Ol Chiki, Meetei, full-width, the mathematical digits, …) and every other number character
--                that survives NFKC (No: circled, parenthesised and dingbat numbers, fractions and number signs of
--                many scripts); superscripts, subscripts, circled numbers to fifty, fractions like ½ and the
--                mathematical digits fold to ASCII digits under NFKC and are refused there.
--                Number words ("five", "पाँच"), Roman and Han numerals, emoji and keycaps are NOT refused here. The
--                builder's contract: the app runs a note's words through its number grammar (packages/core/src/
--                numbers.ts: NUMBERISH, the number words, the scale and unit words) and refuses any hit before the
--                insert, exactly as for an answer's prose. This check is the second line, not the first.
--   decision_id  the decision it derives from, of this shop (the tenant-scoped key)
--   about        what the note is about: at most 8 distinct ids, as ai.trace.ids. A note that names a person lists that
--                person's ops.contact id, or the id of the customer, supplier or staff member a contact is linked to
--                (books.party_contact); ai.memory_names_erased() resolves both, so a person's erasure finds the note
--   created_by   stamped from the actor
--   created_txid stamped txid_current(): what lets a newer note supersede an older one in the same transaction
--   valid_from   when the note starts to hold: now() or later, never backdated
--   valid_to     when it stops holding: required, after valid_from and at most 365 days after it, so no note (and no
--                word in one) outlives a year unrenewed
create table ai.memory (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  kind text not null check (kind in ('preference', 'declined', 'note')),
  text_id uuid not null,
  decision_id uuid not null,
  about jsonb not null default '[]' check (jsonb_typeof(about) = 'array' and jsonb_array_length(about) <= 8 and not jsonb_path_exists(about,
    'strict $[*] ? (!(@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"))')),
  created_by uuid not null,
  created_txid bigint not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, text_id) references ops.message_text,
  foreign key (tenant_id, decision_id) references approval.decision,
  foreign key (tenant_id, created_by) references ops.member,
  check (valid_to > valid_from),
  check (valid_to - valid_from <= interval '365 days')
);

create function ai.memory_stamp() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  writer_role text;
  verdict text;
  decided_command text;
  words ops.message_text;
  -- One group of ranges per line (the red-proofs drop a line at a time); the escapes are the regex engine's.
  digits text := '['
    || '0-9' -- digits: ascii
    || '\u0660-\u0669\u06F0-\u06F9' -- digits: arabic
    || '\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F\u0DE6-\u0DEF' -- digits: indic
    || '\uFF10-\uFF19' -- digits: fullwidth
    || '\u07C0-\u07C9\u0E50-\u0E59\u0ED0-\u0ED9\u0F20-\u0F29\u1040-\u1049\u1090-\u1099\u17E0-\u17E9\u1810-\u1819\u1946-\u194F\u19D0-\u19D9\u1A80-\u1A89\u1A90-\u1A99\u1B50-\u1B59\u1BB0-\u1BB9\u1C40-\u1C49\u1C50-\u1C59\uA620-\uA629\uA8D0-\uA8D9\uA900-\uA909\uA9D0-\uA9D9\uA9F0-\uA9F9\uAA50-\uAA59\uABF0-\uABF9' -- digits: other-bmp
    || '\U000104A0-\U000104A9\U00010D30-\U00010D39\U00010D40-\U00010D49\U00011066-\U0001106F\U000110F0-\U000110F9\U00011136-\U0001113F\U000111D0-\U000111D9\U000112F0-\U000112F9\U00011450-\U00011459\U000114D0-\U000114D9\U00011650-\U00011659\U000116C0-\U000116C9\U000116D0-\U000116E3\U00011730-\U00011739\U000118E0-\U000118E9\U00011950-\U00011959\U00011BF0-\U00011BF9\U00011C50-\U00011C59\U00011D50-\U00011D59\U00011DA0-\U00011DA9\U00011DE0-\U00011DE9\U00011F50-\U00011F59\U00016130-\U00016139\U00016A60-\U00016A69\U00016AC0-\U00016AC9\U00016B50-\U00016B59\U00016D70-\U00016D79\U0001CCF0-\U0001CCF9\U0001D7CE-\U0001D7FF\U0001E140-\U0001E149\U0001E2F0-\U0001E2F9\U0001E4F0-\U0001E4F9\U0001E5F1-\U0001E5FA\U0001E950-\U0001E959\U0001FBF0-\U0001FBF9' -- digits: other-astral
    || '\u09F4-\u09F9\u0B72-\u0B77\u0BF0-\u0BF2\u0C78-\u0C7E\u0D58-\u0D5E\u0D70-\u0D78\u0F2A-\u0F33\u1369-\u137C\u17F0-\u17F9\u19DA\u24EB-\u24FF\u2776-\u2793\u2CFD\u3192-\u3195\u3220-\u3229\u3248-\u324F\u3280-\u3289\uA830-\uA835' -- digits: forms-bmp
    || '\U00010107-\U00010133\U00010175-\U00010178\U0001018A-\U0001018B\U000102E1-\U000102FB\U00010320-\U00010323\U00010858-\U0001085F\U00010879-\U0001087F\U000108A7-\U000108AF\U000108FB-\U000108FF\U00010916-\U0001091B\U000109BC-\U000109BD\U000109C0-\U000109CF\U000109D2-\U000109FF\U00010A40-\U00010A48\U00010A7D-\U00010A7E\U00010A9D-\U00010A9F\U00010AEB-\U00010AEF\U00010B58-\U00010B5F\U00010B78-\U00010B7F\U00010BA9-\U00010BAF\U00010CFA-\U00010CFF\U00010E60-\U00010E7E\U00010F1D-\U00010F26\U00010F51-\U00010F54\U00010FC5-\U00010FCB\U00011052-\U00011065\U000111E1-\U000111F4\U0001173A-\U0001173B\U000118EA-\U000118F2\U00011C5A-\U00011C6C\U00011FC0-\U00011FD4\U00016B5B-\U00016B61\U00016E80-\U00016E96\U0001D2C0-\U0001D2D3\U0001D2E0-\U0001D2F3\U0001D360-\U0001D378\U0001E8C7-\U0001E8CF\U0001EC71-\U0001ECAB\U0001ECAD-\U0001ECAF\U0001ECB1-\U0001ECB4\U0001ED01-\U0001ED2D\U0001ED2F-\U0001ED3D\U0001F10B-\U0001F10C' -- digits: forms-astral
    || ']';
begin
  select m.role into writer_role from ops.member m
   where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active and m.role in ('owner', 'manager');
  if current_user <> 'munshi_app' or writer_role is null then
    raise exception 'memory refused: an active owner or manager of the shop writes a note, through the app' using errcode = 'MS007';
  end if;
  select d.verdict, dr.command into verdict, decided_command
    from approval.decision d join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
   where d.tenant_id = new.tenant_id and d.id = new.decision_id;
  if not found then
    raise exception 'memory refused: a note cites a decision of this shop' using errcode = '23503';
  end if;
  if not exists (select 1 from ref.command_authority ca where ca.command = decided_command and ca.role = writer_role) then
    raise exception 'memory refused: the writer may not decide % drafts, so may not note one', decided_command using errcode = 'MS007';
  end if;
  if new.kind = 'declined' and verdict <> 'rejected' then
    raise exception 'memory refused: a declined note cites a rejection' using errcode = '23514';
  end if;
  -- No row, or an erased one, reads a NULL body (an erasure nulls the body, only_erase).
  select * into words from ops.message_text t where t.tenant_id = new.tenant_id and t.id = new.text_id;
  if words.body is null or words.author <> 'member' or words.created_by is distinct from ctx_actor
     or words.created_at <> now() then
    raise exception 'memory refused: a note''s words are a text the writer wrote in this transaction' using errcode = '23514';
  end if;
  if char_length(words.body) not between 1 and 160 then
    raise exception 'memory refused: a note is 1 to 160 characters' using errcode = '23514';
  end if;
  if normalize(words.body, NFKC) !~ '[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u180E\u2000-\u200D\u2028-\u2029\u202F\u205F-\u2060\u3000\uFEFF]' then
    raise exception 'memory refused: a note holds words, not only spaces' using errcode = '23514';
  end if;
  if words.body ~ digits or normalize(words.body, NFKC) ~ digits then
    raise exception 'memory refused: a note holds no digit; memory never stores a number' using errcode = '23514';
  end if;
  if (select count(distinct a.v) from jsonb_array_elements_text(new.about) a(v)) <> jsonb_array_length(new.about) then
    raise exception 'memory refused: a note names each id it is about once' using errcode = '23514';
  end if;
  if new.valid_from < now() then
    raise exception 'memory refused: a note holds from now or later, never backdated' using errcode = '23514';
  end if;
  new.created_by := ctx_actor;
  new.created_txid := txid_current();
  return new;
end $$;
revoke execute on function ai.memory_stamp() from public;
create trigger stamp before insert on ai.memory for each row execute function ai.memory_stamp();

-- Ids and codes only, never the words (the chain is permanent).
create function ai.memory_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, new.created_by, 'memory.write', 'ai.memory', new.id,
          jsonb_build_object('kind', new.kind, 'decision_id', new.decision_id));
  return null;
end $$;
revoke execute on function ai.memory_audit() from public;
create trigger audit after insert on ai.memory for each row execute function ai.memory_audit();

-- A note's end: one per note, ever, through the app, by an active member:
--   'forgotten'   the owner's command alone: drop the note
--   'superseded'  an owner or manager whose role may decide the note's decision command, who has written a newer note
--                 in this same transaction (ai.memory.created_txid): write the new note, then end the old one
create table ai.memory_end (
  tenant_id uuid not null references ops.tenant,
  memory_id uuid not null,
  ended_by uuid not null,
  reason text not null check (reason in ('forgotten', 'superseded')),
  at timestamptz not null default now(),
  primary key (tenant_id, memory_id),
  foreign key (tenant_id, memory_id) references ai.memory,
  foreign key (tenant_id, ended_by) references ops.member
);

create function ai.memory_end_stamp() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ender_role text;
  noted_command text;
begin
  select m.role into ender_role from ops.member m
   where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active and m.role in ('owner', 'manager');
  if current_user <> 'munshi_app' or ender_role is null then
    raise exception 'memory refused: an active owner or manager of the shop ends a note, through the app' using errcode = 'MS007';
  end if;
  if new.reason = 'forgotten' and ender_role <> 'owner' then
    raise exception 'memory refused: forgetting a note is the owner''s command' using errcode = 'MS007';
  end if;
  if new.reason = 'superseded' then
    select dr.command into noted_command
      from ai.memory n
      join approval.decision d on d.tenant_id = n.tenant_id and d.id = n.decision_id
      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
     where n.tenant_id = new.tenant_id and n.id = new.memory_id;
    if not exists (select 1 from ref.command_authority ca where ca.command = noted_command and ca.role = ender_role) then
      raise exception 'memory refused: the member may not decide % drafts, so may not supersede a note of one', noted_command using errcode = 'MS007';
    end if;
    if not exists (select 1 from ai.memory n
                    where n.tenant_id = new.tenant_id and n.created_by = ctx_actor and n.created_txid = txid_current()
                      and n.id > new.memory_id) then
      raise exception 'memory refused: a note is superseded by a newer note the member wrote in this transaction' using errcode = '23514';
    end if;
  end if;
  new.ended_by := ctx_actor;
  new.at := now();
  return new;
end $$;
revoke execute on function ai.memory_end_stamp() from public;
create trigger stamp before insert on ai.memory_end for each row execute function ai.memory_end_stamp();

create function ai.memory_end_audit() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, new.ended_by, 'memory.end', 'ai.memory', new.memory_id, jsonb_build_object('reason', new.reason));
  return null;
end $$;
revoke execute on function ai.memory_end_audit() from public;
create trigger audit after insert on ai.memory_end for each row execute function ai.memory_end_audit();

-- Whether a note's `about` names a person whose contact is erased: the contact's own id, or a customer, supplier or
-- staff member any erased contact of theirs was linked to (books.party_contact keeps the link as ids after the erasure).
-- Invoker: RLS keeps it to the transaction's shop.
--
-- A contact's erasure, the builder's contract (core does not do this yet; W2-A's builder adds it to contact.erase and
-- to the jobs runner that completes a held erasure). In the erasure's own transaction, FIRST erase the contact row,
-- THEN blank the words of every note about an erased person:
--   update ops.message_text x set body = null, erased_at = now() from ai.memory n
--    where n.tenant_id = x.tenant_id and n.text_id = x.id and x.erased_at is null and ai.memory_names_erased(n.tenant_id, n.about)
-- The owner does it as the actor (message_text's owner erasure). The jobs runner, with no actor, may only because the
-- contact is already erased (the guard below and ai.memory_text_keep both ask this function); in the other order an
-- in-force note's words are refused (MS007).
create function ai.memory_names_erased(p_tenant uuid, p_about jsonb) returns boolean language sql stable
  set search_path = pg_catalog, pg_temp as $$
  select exists (
    select 1 from ops.contact ct
     where ct.tenant_id = p_tenant and ct.erased_at is not null
       and (p_about ? ct.id::text
            or exists (select 1 from books.party_contact p
                        where p.tenant_id = ct.tenant_id and p.contact_id = ct.id
                          and (p_about ? p.customer_id::text or p_about ? p.supplier_id::text or p_about ? p.staff_id::text))))
$$;
revoke execute on function ai.memory_names_erased(uuid, jsonb) from public;
grant execute on function ai.memory_names_erased(uuid, jsonb) to munshi_app, munshi_jobs;

-- 19's text guard, with one more purge rule: the jobs role (no actor) erases a memory note's words once a person the
-- note is about is erased (an erasure held for an open balance completes with no actor). The rest is 19's, unchanged.
create or replace function ops.message_text_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if ctx_actor is not null and current_user <> 'munshi_app' then
    raise exception 'message text refused: an actor is set only by munshi_app' using errcode = 'MS018';
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if tg_op = 'INSERT' then
    if current_user = 'munshi_app' then
      if actor_role is null then
        raise exception 'message text refused: the app writes a text as an active member' using errcode = 'MS018';
      end if;
    elsif current_user <> 'munshi_jobs' or new.author = 'member' then
      raise exception 'message text refused: the jobs role writes only a run''s or a template''s text' using errcode = 'MS018';
    end if;
    if new.erased_at is not null then
      raise exception 'message text refused: a new text is not erased' using errcode = 'MS007';
    end if;
    new.created_by := ctx_actor;
    new.body_sha256 := sha256(convert_to(new.body, 'UTF8'));
    new.created_at := now();
    return new;
  end if;
  if old.erased_at is null and new.erased_at is not null then
    if ctx_actor is not null then
      if actor_role is distinct from 'owner' then
        raise exception 'message text refused: a person''s erasure of a text is an active owner''s' using errcode = 'MS007';
      end if;
    elsif current_user <> 'munshi_jobs' then
      raise exception 'message text refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';
    elsif not (
           exists (select 1 from ai.answer a
                    where a.tenant_id = new.tenant_id and a.text_id = new.id and a.kind = 'ask'
                      and a.created_at < now() - interval '30 days')
        or (exists (select 1 from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
                     where d.tenant_id = new.tenant_id and new.id in (m.text_id, d.test_text_id))
            and not exists (select 1 from ops.delivery d left join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id
                             where d.tenant_id = new.tenant_id and new.id in (m.text_id, d.test_text_id)
                               and (d.final_at is null or d.final_at > now() - interval '30 days')))
        or exists (select 1 from ai.answer a join ops.inbound_message i on i.tenant_id = a.tenant_id and i.id = a.inbound_message_id
                    where a.tenant_id = new.tenant_id and a.text_id = new.id and i.erased_at is not null)
        or exists (select 1 from ai.memory n
                    where n.tenant_id = new.tenant_id and n.text_id = new.id and ai.memory_names_erased(n.tenant_id, n.about))
        or (old.created_at < now() - interval '30 days'
            and not exists (select 1 from books.outbound_message m where m.tenant_id = new.tenant_id and m.text_id = new.id)
            and not exists (select 1 from ops.delivery d where d.tenant_id = new.tenant_id and d.test_text_id = new.id)
            and not exists (select 1 from ai.answer a where a.tenant_id = new.tenant_id and a.text_id = new.id)
            and not exists (select 1 from ops.campaign c where c.tenant_id = new.tenant_id and c.copy_text_id = new.id
                               and c.status in ('composing', 'proposed', 'approved'))
            and not exists (select 1 from books.order_line l where l.tenant_id = new.tenant_id and l.note_text_id = new.id))) then
      raise exception 'message text refused: the purge erases a text 30 days after its Ask answer or its last final delivery, with its source message, or 30 days after it was written if nothing names it'
        using errcode = 'MS007';
    end if;
  end if;
  return new;
end $$;

-- The jobs purge (no actor) never sweeps away the words of a note still to hold: one not ended whose valid_to is still
-- ahead. A person's erasure (an owner, as the actor) always may, and so may the jobs runner once a person the note is
-- about is erased (ai.memory_names_erased). An ended or expired note's words fall to the purge's 30-day rule (19).
create function ai.memory_text_keep() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if old.erased_at is null and new.erased_at is not null and nullif(current_setting('munshi.actor_id', true), '') is null
     and exists (select 1 from ai.memory n
                  where n.tenant_id = old.tenant_id and n.text_id = old.id and n.valid_to > now()
                    and not exists (select 1 from ai.memory_end e where e.tenant_id = n.tenant_id and e.memory_id = n.id)
                    and not ai.memory_names_erased(n.tenant_id, n.about)) then
    raise exception 'message text refused: the purge keeps the words of a note still in force' using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ai.memory_text_keep() from public;
create trigger memory_keep before update on ops.message_text for each row execute function ai.memory_text_keep();

-- The notes in force for the shop the transaction names, newest first: valid_from <= now() < valid_to, not ended, words
-- not erased. Invoker: RLS on ai.memory, ai.memory_end and ops.message_text applies, so a caller reads its own shop's
-- notes only, and none with no shop in context. `text` is the note's words.
create function ai.memory_in_force()
  returns table (id uuid, kind text, text text, decision_id uuid, about jsonb, created_by uuid, valid_from timestamptz,
                 valid_to timestamptz)
  language sql stable
  set search_path = pg_catalog, pg_temp as $$
  select n.id, n.kind, t.body, n.decision_id, n.about, n.created_by, n.valid_from, n.valid_to
    from ai.memory n
    join ops.message_text t on t.tenant_id = n.tenant_id and t.id = n.text_id
   where n.tenant_id = nullif(current_setting('munshi.tenant_id', true), '')::uuid
     and n.valid_from <= now() and n.valid_to > now()
     and t.erased_at is null
     and not exists (select 1 from ai.memory_end e where e.tenant_id = n.tenant_id and e.memory_id = n.id)
   order by n.valid_from desc, n.id desc
$$;
revoke execute on function ai.memory_in_force() from public;
grant execute on function ai.memory_in_force() to munshi_app, munshi_jobs;

-- Indexes, one per statement, each asserted in pg_index (G10).
create unique index memory_text on ai.memory (tenant_id, text_id);
create index memory_decision on ai.memory (tenant_id, decision_id);

-- RLS and the grants. Append-only: no role updates or deletes a note or its end; the agent has no grant.
alter table ai.memory enable row level security;
alter table ai.memory force row level security;
create policy tenant_isolation on ai.memory
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.memory from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.memory to munshi_app;
grant select on ai.memory to munshi_jobs;

alter table ai.memory_end enable row level security;
alter table ai.memory_end force row level security;
create policy tenant_isolation on ai.memory_end
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ai.memory_end from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ai.memory_end to munshi_app;
grant select on ai.memory_end to munshi_jobs;
