-- 02 · Shared functions (BLUEPRINT §2.1, §2.4, §2.6, §2.7, §2.8). Only plpgsql functions with no row-type parameter
-- live here (R4 B1): a plpgsql body is resolved when it runs, so these may name tables of later files; a `language sql`
-- function, or one taking a row type, is created in its table's file (the audit functions in 08).
--
-- Every function: EXECUTE revoked from PUBLIC one by one (the ALTER DEFAULT PRIVILEGES … IN SCHEMA form does nothing),
-- search_path pinned, never SECURITY DEFINER (G9). Trigger functions run with the inserting role's rights and call no
-- other Munshi function, so no runtime role needs EXECUTE on any of them; the one exception is ops.uuidv7(), reached
-- through column defaults, which every inserting role executes (§2.10.11).
--
-- Advisory locks use the two-key form pg_advisory_xact_lock(class, hashtext(key)), one class per purpose (R4 W2). Every
-- trigger that takes a lock takes the tenant's chain lock (class 1) first, so no two transactions take two of them in
-- opposite orders. Classes: 1 a tenant's audit chain (also member and capability changes), 2 an offer, 3 a customer's
-- loyalty, 4 a package holding, 5 a staff member, 6 an invoice series, 7 a one-live key, 8 an IP's holds, 9 a stylist's
-- day, 10 the platform chain.
set local role munshi_owner;

-- A time-ordered UUID (RFC 9562 version 7): PostgreSQL 17 has no built-in uuidv7(), which arrives in 18. The 48-bit
-- Unix milliseconds come from clock_timestamp(), not now() (the transaction's start), so ids made in one transaction
-- still sort in the order they were made; the sub-millisecond fraction fills the 12 rand_a bits, and the rest is
-- gen_random_uuid()'s randomness. So `order by effective_from desc, created_at desc, id desc` breaks every tie (R4 K1).
create function ops.uuidv7() returns uuid language plpgsql volatile
  set search_path = pg_catalog, pg_temp as $$
declare
  t numeric := extract(epoch from clock_timestamp()) * 1000;
  ms bigint := floor(t);
  sub int := floor((t - ms) * 4096);
  b bytea := uuid_send(gen_random_uuid());
begin
  b := overlay(b placing decode(lpad(to_hex(ms), 12, '0'), 'hex') from 1 for 6);
  b := set_byte(b, 6, 112 | (sub >> 8));
  b := set_byte(b, 7, sub & 255);
  b := set_byte(b, 8, 128 | (get_byte(b, 8) & 63));
  return encode(b, 'hex')::uuid;
end $$;
revoke execute on function ops.uuidv7() from public;
grant execute on function ops.uuidv7() to munshi_app, munshi_public, munshi_jobs, munshi_idp, munshi_platform;

-- ops.only_erase(col, …), trigger `erase`, before update: the listed columns are a row's personal and identity columns.
-- They go to NULL only in the one UPDATE that moves erased_at from NULL to now(), and that UPDATE nulls every one of
-- them; otherwise they never change, so a NULL is never filled (a new phone is a new contact). An erased row never
-- changes again. A fill-once column is not listed here: ops.fill_once governs it, and erasure still nulls it there.
create function ops.only_erase() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  col text;
  erasing boolean;
begin
  if tg_op <> 'UPDATE' or tg_nargs = 0 or not (o ? 'erased_at') then
    raise exception 'only_erase: %.% needs an UPDATE trigger naming its personal columns, and an erased_at column', tg_table_schema, tg_table_name
      using errcode = 'MS011';
  end if;
  foreach col in array tg_argv loop
    if not (o ? col) then
      raise exception 'only_erase: %.% has no column %', tg_table_schema, tg_table_name, col using errcode = 'MS011';
    end if;
  end loop;
  if o ->> 'erased_at' is not null then
    raise exception 'erase refused: an erased %.% row never changes', tg_table_schema, tg_table_name using errcode = 'MS011';
  end if;
  erasing := n ->> 'erased_at' is not null;
  if erasing and (n ->> 'erased_at')::timestamptz is distinct from now() then
    raise exception 'erase refused: erased_at is set to now()' using errcode = 'MS011';
  end if;
  foreach col in array tg_argv loop
    if erasing and n ->> col is not null then
      raise exception 'erase refused: an erasure of %.% nulls every personal column, % too', tg_table_schema, tg_table_name, col
        using errcode = 'MS011';
    elsif not erasing and (o -> col) is distinct from (n -> col) then
      raise exception 'erase refused: %.%.% changes only to NULL, in the UPDATE that sets erased_at', tg_table_schema, tg_table_name, col
        using errcode = 'MS011';
    end if;
  end loop;
  return new;
end $$;
revoke execute on function ops.only_erase() from public;

-- ops.fill_once(col, stamp), trigger `fill_<col>`, before update: a column filled after insert (a transcript, a media
-- document). It goes from NULL to a value only in the UPDATE that moves its stamp from NULL to now(); the stamp is never
-- cleared, so it is filled once, never again even after a NULL. Otherwise it changes only to NULL, in an erasure, and an
-- erasure must null it. Name order puts `erase` first, so a frozen row is refused before this runs.
create function ops.fill_once() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  col text := tg_argv[0];
  stamp text := tg_argv[1];
begin
  if tg_op <> 'UPDATE' or tg_nargs <> 2 or not (o ? col and o ? stamp and o ? 'erased_at') then
    raise exception 'fill_once: %.% needs an UPDATE trigger naming a column and its stamp, and an erased_at column', tg_table_schema, tg_table_name
      using errcode = 'MS011';
  end if;
  if (o -> stamp) is distinct from (n -> stamp) then
    if o ->> stamp is not null or (n ->> stamp)::timestamptz is distinct from now() or o ->> col is not null or n ->> col is null
       or n ->> 'erased_at' is not null then
      raise exception 'fill refused: %.%.% is filled once, in the UPDATE that sets % from NULL to now()', tg_table_schema, tg_table_name, col, stamp
        using errcode = 'MS011';
    end if;
  elsif (o -> col) is distinct from (n -> col) then
    if n ->> col is not null or o ->> 'erased_at' is not null or n ->> 'erased_at' is null then
      raise exception 'fill refused: %.%.% is filled once, with %, and otherwise goes to NULL only in an erasure', tg_table_schema, tg_table_name, col, stamp
        using errcode = 'MS011';
    end if;
  elsif o ->> 'erased_at' is null and n ->> 'erased_at' is not null and n ->> col is not null then
    raise exception 'erase refused: an erasure of %.% nulls %', tg_table_schema, tg_table_name, col using errcode = 'MS011';
  end if;
  return new;
end $$;
revoke execute on function ops.fill_once() from public;

-- A row written only by another table's trigger (a snapshot pin, a finding event, a subject summary): refused unless a
-- trigger is running (pg_trigger_depth() > 1 inside this one).
create function ops.only_from_trigger() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if pg_trigger_depth() < 2 then
    raise exception '%.% is written only by its holder''s trigger', tg_table_schema, tg_table_name using errcode = 'MS018';
  end if;
  return new;
end $$;
revoke execute on function ops.only_from_trigger() from public;

-- books.write(), trigger `a_write` on every books table, before insert, update or delete (§2.4). In order:
--   1. UPDATE is refused, and DELETE too, but for one branch: the owner role and a sandbox tenant, synthetic by its own
--      rule on any deployment (the scheduled sandbox reset, one transaction per sandbox; R4 K5, D-080).
--   2. Only munshi_app writes, and only for the current tenant, once the tenant is open: a real shop the operator has
--      not accepted (platform.tenant_acceptance, 09) writes no book (MS020, D-080).
--   3. Admit under (a) an approved decision of this transaction, made by the acting member, an active member whose role
--      holds the draft's command, or (b) a direct command the acting member's role holds and ref.command does not mark
--      draft-only. Any role can set any setting, so each setting is checked against rows; the actor is trusted because
--      one module sets it from the session.
--   4. The admitting command writes this table (ref.command_table).
--   5. Stamp created_by, decision_id, created_txid and created_at, whatever the caller sent.
--   6. A child is accepted only in its parent's transaction (MS006), so a committed header never gains a line.
--   7. A reversal is the exact opposite of an unreversed original, once (MS013); a reversal child's parent is the
--      reversal header, and a child of a reversal header is itself a reversal (R4 K4). The reason's use is the table's
--      foreign key to ref.reason_use.
create function books.write() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ctx_decision uuid := nullif(current_setting('munshi.decision_id', true), '')::uuid;
  ctx_command text := nullif(current_setting('munshi.command', true), '');
  this_rel text := tg_table_schema || '.' || tg_table_name;
  bt ref.book_table;
  by_member uuid;
  by_command text;
  r jsonb;
  parent jsonb;
  orig jsonb;
  reversed boolean;
  col text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'book write refused: % is append-only', this_rel using errcode = 'MS001';
  end if;
  if tg_op = 'DELETE' then
    if current_user = 'munshi_owner' and exists (select 1 from ops.tenant t where t.tenant_id = old.tenant_id and t.sandbox) then
      return old;
    end if;
    raise exception 'book write refused: % is append-only (a delete only resets a sandbox, as the owner)', this_rel
      using errcode = 'MS001';
  end if;

  if current_user <> 'munshi_app' then
    raise exception 'book write refused: only munshi_app writes the books' using errcode = 'MS001';
  end if;
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'book write refused: the row is not for the current tenant' using errcode = 'MS001';
  end if;
  if not ops.tenant_open(new.tenant_id) then
    raise exception 'book write refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
  end if;
  select * into bt from ref.book_table b where b.rel = this_rel;
  if not found then
    raise exception 'book write refused: % has no ref.book_table row', this_rel using errcode = 'MS001';
  end if;

  if ctx_decision is not null then
    select d.decided_by, dr.command into by_member, by_command
      from approval.decision d
      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
      join ops.member m on m.tenant_id = d.tenant_id and m.id = d.decided_by and m.active
      join ref.command_authority ca on ca.command = dr.command and ca.role = m.role
     where d.tenant_id = new.tenant_id and d.id = ctx_decision and d.verdict = 'approved'
       and d.created_txid = txid_current() and d.decided_by = ctx_actor;
    if by_member is null then
      raise exception 'book write refused: no approved decision of this tenant, made in this transaction by the acting member, who may approve it'
        using errcode = 'MS001';
    end if;
  elsif ctx_command is not null and ctx_actor is not null then
    select m.id, c.command into by_member, by_command
      from ops.member m
      join ref.command_authority ca on ca.role = m.role and ca.command = ctx_command
      join ref.command c on c.command = ca.command and not c.draft_only
     where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
    if by_member is null then
      raise exception 'book write refused: the acting member may not run % directly', ctx_command using errcode = 'MS001';
    end if;
  else
    raise exception 'book write refused: no approved decision and no direct command' using errcode = 'MS001';
  end if;
  perform 1 from ref.command_table ct where ct.command = by_command and ct.rel = this_rel;
  if not found then
    raise exception 'book write refused: % does not write %', by_command, this_rel using errcode = 'MS001';
  end if;

  new := jsonb_populate_record(new, jsonb_build_object(
    'created_by', by_member, 'decision_id', ctx_decision, 'created_txid', txid_current(), 'created_at', now()));
  r := to_jsonb(new);

  if bt.parent_rel is not null then
    execute format('select to_jsonb(p) from %s p where p.tenant_id = $1 and p.id = $2', bt.parent_rel::regclass)
      into parent using new.tenant_id, (r ->> bt.parent_col)::uuid;
    if parent is null or (parent ->> 'created_txid')::bigint is distinct from txid_current() then
      raise exception 'book write refused: a % row is accepted only in its parent''s transaction', this_rel using errcode = 'MS006';
    end if;
  end if;

  if bt.reversible and r ->> 'reverses_id' is not null then
    execute format('select to_jsonb(o) from %s o where o.tenant_id = $1 and o.id = $2', this_rel::regclass)
      into orig using new.tenant_id, (r ->> 'reverses_id')::uuid;
    if orig is null or orig ->> 'reverses_id' is not null then
      raise exception 'reversal refused: % names no original, or names a reversal', this_rel using errcode = 'MS013';
    end if;
    execute format('select exists (select 1 from %s o where o.tenant_id = $1 and o.reverses_id = $2)', this_rel::regclass)
      into reversed using new.tenant_id, (r ->> 'reverses_id')::uuid;
    if reversed then
      raise exception 'reversal refused: the % row is already reversed', this_rel using errcode = 'MS013';
    end if;
    foreach col in array bt.signed_cols loop
      if (r ->> col)::numeric is distinct from -((orig ->> col)::numeric) then
        raise exception 'reversal refused: %.% is not the exact negation of the original', this_rel, col using errcode = 'MS013';
      end if;
    end loop;
    foreach col in array bt.match_cols loop
      if (r -> col) is distinct from (orig -> col) then
        raise exception 'reversal refused: %.% differs from the original', this_rel, col using errcode = 'MS013';
      end if;
    end loop;
    if bt.parent_rel is not null and (parent ->> 'reverses_id') is distinct from (orig ->> bt.parent_col) then
      raise exception 'reversal refused: a reversing % row belongs to the reversal of its original''s header', this_rel using errcode = 'MS013';
    end if;
  elsif bt.reversible and bt.parent_rel is not null and parent ->> 'reverses_id' is not null then
    raise exception 'reversal refused: every % row under a reversal header reverses a row of the original', this_rel using errcode = 'MS013';
  end if;
  return new;
end $$;
revoke execute on function books.write() from public;

-- books.audit_row(), trigger `z_audit`, after insert on every books table: the row's audit entry, with the sha256 of
-- its jsonb text as the digest and no payload (§2.7, R4 G3). jsonb's text renders timestamptz in the session's zone, so
-- the zone and interval style are pinned here and in audit.verify_books (VB1-TZ). After the row, not before: an insert
-- that ON CONFLICT DO NOTHING skips leaves no entry.
create function books.audit_row() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp
  set timezone = 'UTC'
  set intervalstyle = 'postgres' as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, decision_id, command, action, entity, entity_id, row_digest)
  values (new.tenant_id, new.created_by, new.decision_id,
          coalesce((select dr.command from approval.decision d
                      join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
                     where d.tenant_id = new.tenant_id and d.id = new.decision_id),
                   nullif(current_setting('munshi.command', true), '')),
          'insert', tg_table_schema || '.' || tg_table_name, new.id, sha256(convert_to(to_jsonb(new)::text, 'UTF8')));
  return null;
end $$;
revoke execute on function books.audit_row() from public;

-- books.check_balanced(), trigger `z_balance`, a deferred constraint trigger on books.journal_entry only (15): at commit
-- each entry has lines and sums to zero per currency (MS004). Lines cannot arrive in a later transaction (MS006), so one
-- check per entry suffices (R4 W3).
create function books.check_balanced() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if not exists (select 1 from books.journal_line l where l.tenant_id = new.tenant_id and l.entry_id = new.id)
     or exists (select 1 from books.journal_line l where l.tenant_id = new.tenant_id and l.entry_id = new.id
                 group by l.currency having sum(l.amount_minor) <> 0) then
    raise exception 'journal entry refused: it has no lines, or does not balance per currency' using errcode = 'MS004';
  end if;
  return null;
end $$;
revoke execute on function books.check_balanced() from public;

-- books.check_reversal(), trigger `z_reversal_complete`, a deferred constraint trigger on every reversible header with
-- children (R4 K4): at commit, a reversal header leaves no child of its original unreversed, in every child table
-- ref.book_table names for it (a later file's child, such as a sale discount, is covered by its row there). books.write
-- already holds that each reversing child sits under the reversal header and reverses once, so "none left" is "each
-- exactly once" (MS013).
create function books.check_reversal() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  child ref.book_table;
  left_over bigint;
begin
  if (to_jsonb(new) ->> 'reverses_id') is null then
    return null;
  end if;
  for child in select * from ref.book_table b where b.parent_rel = tg_table_schema || '.' || tg_table_name and b.reversible loop
    execute format(
      'select count(*) from %1$s o where o.tenant_id = $1 and o.%2$I = $2
          and not exists (select 1 from %1$s r where r.tenant_id = o.tenant_id and r.reverses_id = o.id and r.%2$I = $3)',
      child.rel::regclass, child.parent_col)
      into left_over using new.tenant_id, (to_jsonb(new) ->> 'reverses_id')::uuid, new.id;
    if left_over > 0 then
      raise exception 'reversal refused: % row(s) of % under the original are not reversed', left_over, child.rel using errcode = 'MS013';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function books.check_reversal() from public;

-- audit.chain(), trigger `chain`, before insert on audit.audit_log (§2.7): one gapless hash chain per tenant,
-- hash(n) = sha256(hash(n-1) ‖ canonical(entry n)). seq, prev_hash, created_at and hash are set here, never by the
-- caller, under the tenant's chain lock. The canonical text is written out here and again in audit.entry_hash (08):
-- calling that function from a trigger would need EXECUTE for every inserting role, and G7's verification proves the two
-- agree. An entry names the acting member; a book row's entry needs that row, written by that member under that
-- decision (its one entry is held by the unique index audit_book_row).
create function audit.chain() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  last_seq bigint;
  last_hash bytea;
  written boolean;
begin
  if new.actor_id is distinct from ctx_actor then
    raise exception 'audit refused: an entry names the acting member' using errcode = 'MS005';
  end if;
  if new.entity like 'books.%' then
    if not exists (select 1 from ref.book_table b where b.rel = new.entity) then
      raise exception 'audit refused: % is not a books table', new.entity using errcode = 'MS005';
    end if;
    execute format('select exists (select 1 from %s t where t.tenant_id = $1 and t.id = $2 and t.created_by = $3
                      and t.decision_id is not distinct from $4)', new.entity::regclass)
      into written using new.tenant_id, new.entity_id, new.actor_id, new.decision_id;
    if not written then
      raise exception 'audit refused: no % row by this member under this decision', new.entity using errcode = 'MS005';
    end if;
  end if;
  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  select a.seq, a.hash into last_seq, last_hash from audit.audit_log a where a.tenant_id = new.tenant_id order by a.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := sha256(coalesce(new.prev_hash, ''::bytea) || convert_to(concat_ws(chr(31),
    new.tenant_id::text, new.seq::text, new.actor_id::text, coalesce(new.decision_id::text, ''), coalesce(new.command, ''),
    new.action, new.entity, coalesce(new.entity_id::text, ''), coalesce(encode(new.row_digest, 'hex'), ''),
    coalesce(new.payload::text, ''), extract(epoch from new.created_at)::text), 'UTF8'));
  return new;
end $$;
revoke execute on function audit.chain() from public;

-- snap.snap_check(), trigger `snap_check`, before insert or update on snap.snapshot (§2.8). Snapshots are immutable.
-- Who mints: the app, as an active member, a display, evidence or release snapshot; the jobs role, with no actor, a
-- watch or evidence snapshot; the owner role, with no actor, a release snapshot (off live only the owner publishes, 14)
-- (§2.3's role shapes). The shape: 1 to 40 columns {n, k}; at most 500 rows, each an array
-- with one cell per column; each cell is {"k":"null"} or its column's kind carrying exactly its fields. The cells are
-- checked in one set-based query, not a per-cell loop (R4 W3). row_count, rows_sha256, params_sha256, actor_id,
-- created_txid and created_at are stamped here, so a caller cannot send a mismatched one (R4 I7).
create function snap.snap_check() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  ncols int;
  ok boolean;
begin
  if tg_op <> 'INSERT' then
    raise exception 'snapshot refused: a snapshot never changes' using errcode = 'MS010';
  end if;
  if current_user = 'munshi_app' then
    if new.purpose not in ('display', 'evidence', 'release')
       or not exists (select 1 from ops.member m where m.tenant_id = ctx_tenant and m.id = ctx_actor and m.active) then
      raise exception 'snapshot refused: the app mints a display, evidence or release snapshot as an active member' using errcode = 'MS018';
    end if;
    -- A pending real shop shows no number (D-080): its waiting page reads only its name, its status and the owner's row.
    if not ops.tenant_open(ctx_tenant) then
      raise exception 'snapshot refused: the shop waits for the operator''s acceptance' using errcode = 'MS020';
    end if;
  elsif current_user = 'munshi_jobs' then
    if new.purpose not in ('watch', 'evidence') or ctx_actor is not null then
      raise exception 'snapshot refused: the jobs role mints a watch or evidence snapshot, with no actor' using errcode = 'MS018';
    end if;
  elsif current_user = 'munshi_owner' then
    if new.purpose <> 'release' or ctx_actor is not null then
      raise exception 'snapshot refused: the owner role mints only a release snapshot, with no actor' using errcode = 'MS018';
    end if;
  else
    raise exception 'snapshot refused: % does not mint snapshots', current_user using errcode = 'MS018';
  end if;

  if jsonb_typeof(new.columns) is distinct from 'array' or jsonb_array_length(new.columns) not between 1 and 40
     or exists (select 1 from jsonb_array_elements(new.columns) c(v)
                 where jsonb_typeof(c.v) <> 'object' or c.v - array['n', 'k'] <> '{}'::jsonb
                    or jsonb_typeof(c.v -> 'n') is distinct from 'string' or (c.v ->> 'n') !~ '^[a-z_][a-z0-9_]{0,62}$'
                    or (c.v ->> 'k') is null or (c.v ->> 'k') not in ('money', 'qty', 'int', 'text', 'date', 'ts'))
     or (select count(distinct c.v ->> 'n') from jsonb_array_elements(new.columns) c(v)) <> jsonb_array_length(new.columns) then
    raise exception 'snapshot refused: columns are 1 to 40 distinct {n, k} of a known kind' using errcode = 'MS006';
  end if;
  ncols := jsonb_array_length(new.columns);
  if jsonb_typeof(new.rows) is distinct from 'array' or jsonb_array_length(new.rows) > 500
     or exists (select 1 from jsonb_array_elements(new.rows) r(v) where jsonb_typeof(r.v) <> 'array' or jsonb_array_length(r.v) <> ncols) then
    raise exception 'snapshot refused: rows are at most 500 arrays of one cell per column' using errcode = 'MS006';
  end if;
  -- coalesce(…, false) per cell: a missing field makes its test NULL, and bool_and would skip a NULL.
  select coalesce(bool_and(coalesce(case
           when cell.v = '{"k": "null"}'::jsonb then true
           when (cell.v ->> 'k') is distinct from (col.c ->> 'k') then false
           when col.c ->> 'k' = 'money' then cell.v - array['k', 'n', 'c'] = '{}'::jsonb and jsonb_typeof(cell.v -> 'n') = 'string'
             and (cell.v ->> 'n') ~ '^-?[0-9]{1,18}$' and jsonb_typeof(cell.v -> 'c') = 'string' and (cell.v ->> 'c') ~ '^[A-Z]{3}$'
           when col.c ->> 'k' = 'qty' then cell.v - array['k', 'n', 'u'] = '{}'::jsonb and jsonb_typeof(cell.v -> 'n') = 'string'
             and (cell.v ->> 'n') ~ '^-?[0-9]{1,18}$' and jsonb_typeof(cell.v -> 'u') = 'string' and (cell.v ->> 'u') ~ '^[a-z]{1,16}$'
           when col.c ->> 'k' = 'int' then cell.v - array['k', 'n'] = '{}'::jsonb and jsonb_typeof(cell.v -> 'n') = 'string'
             and (cell.v ->> 'n') ~ '^-?[0-9]{1,18}$'
           when col.c ->> 'k' = 'text' then cell.v - array['k', 't'] = '{}'::jsonb and jsonb_typeof(cell.v -> 't') = 'string'
             and char_length(cell.v ->> 't') <= 2000
           when col.c ->> 'k' = 'date' then cell.v - array['k', 'd'] = '{}'::jsonb and jsonb_typeof(cell.v -> 'd') = 'string'
             and (cell.v ->> 'd') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           when col.c ->> 'k' = 'ts' then cell.v - array['k', 'a'] = '{}'::jsonb and jsonb_typeof(cell.v -> 'a') = 'string'
             and (cell.v ->> 'a') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
           else false end, false)), true) into ok
    from jsonb_array_elements(new.rows) r(v),
         jsonb_array_elements(r.v) with ordinality cell(v, j),
         jsonb_array_elements(new.columns) with ordinality col(c, i)
   where col.i = cell.j;
  if not ok then
    raise exception 'snapshot refused: a cell does not hold its column''s kind with exactly its fields' using errcode = 'MS006';
  end if;
  if jsonb_typeof(new.params) is distinct from 'object' then
    raise exception 'snapshot refused: params is an object' using errcode = 'MS006';
  end if;
  new.row_count := jsonb_array_length(new.rows);
  new.rows_sha256 := sha256(convert_to(new.rows::text, 'UTF8'));
  new.params_sha256 := sha256(convert_to(new.params::text, 'UTF8'));
  new.actor_id := ctx_actor;
  new.created_txid := txid_current();
  new.created_at := now();
  return new;
end $$;
revoke execute on function snap.snap_check() from public;
