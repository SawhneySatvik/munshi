-- 90 · The seal (BLUEPRINT §3.1): always the last file. It asserts the build from the catalog and the ref tables and
-- raises, naming every problem, so a build that breaks a rule fails as a whole. The gates hold the same rules against
-- the merged manifest, an independent list; this file holds them against whatever the files made.
set local role munshi_owner;

do $$
declare
  schemas text[] := array['ref', 'ops', 'books', 'approval', 'snap', 'audit', 'ai', 'agent_view', 'idp', 'platform'];
  definers text[] := array['platform.count_ai_call(date,integer)', 'ops.inbound_open(uuid)', 'platform.purge_grants(uuid)'];
  problems text[];
begin
  -- Every table: owned by munshi_owner, RLS enabled and forced, at least one policy.
  problems := array(
    select format('%s.%s: %s', n.nspname, c.relname, concat_ws(', ',
             case when pg_get_userbyid(c.relowner) <> 'munshi_owner' then 'not owned by munshi_owner' end,
             case when not c.relrowsecurity then 'RLS not enabled' end,
             case when not c.relforcerowsecurity then 'RLS not forced' end,
             case when not exists (select 1 from pg_policy p where p.polrelid = c.oid) then 'no policy' end))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any (schemas) and c.relkind in ('r', 'p')
       and (pg_get_userbyid(c.relowner) <> 'munshi_owner' or not c.relrowsecurity or not c.relforcerowsecurity
            or not exists (select 1 from pg_policy p where p.polrelid = c.oid)));

  -- Every books table has its ref.book_table row, and every row a table; its declared columns exist; a reversible table
  -- has reverses_id and reason; it carries a_write and z_audit.
  problems := problems || array(
    select format('%s: no ref.book_table row', n.nspname || '.' || c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'books' and c.relkind in ('r', 'p')
       and not exists (select 1 from ref.book_table b where b.rel = n.nspname || '.' || c.relname));
  problems := problems || array(
    select format('ref.book_table %s: %s', b.rel, concat_ws(', ',
             case when to_regclass(b.rel) is null then 'no such table' end,
             (select string_agg('no column ' || col, ', ')
                from unnest(b.signed_cols || b.match_cols || array_remove(array[b.parent_col], null)
                            || case when b.reversible then array['reverses_id', 'reason'] else '{}' end) col
               where to_regclass(b.rel) is not null
                 and not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(b.rel) and a.attname = col and not a.attisdropped)),
             (select string_agg('no trigger ' || t, ', ') from unnest(array['a_write', 'z_audit']) t
               where to_regclass(b.rel) is not null
                 and not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(b.rel) and g.tgname = t))))
      from ref.book_table b
     where to_regclass(b.rel) is null
        or exists (select 1 from unnest(b.signed_cols || b.match_cols || array_remove(array[b.parent_col], null)
                                        || case when b.reversible then array['reverses_id', 'reason'] else '{}' end) col
                    where not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(b.rel) and a.attname = col and not a.attisdropped))
        or exists (select 1 from unnest(array['a_write', 'z_audit']) t
                    where not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(b.rel) and g.tgname = t)));

  -- Reversals (R4 K4): a child of a reversible header reverses too, a reversible header with children checks at commit
  -- that a reversal left none of them unreversed, and each declared b_ rule is a trigger on its table. Two children of a
  -- sale do not reverse, by BLUEPRINT's text: an invoice, whose reversal is a credit note under the reversal sale (§2.9),
  -- and a package holding, which is not [R] and closes through its entries (§2.10.5).
  problems := problems || array(
    select format('ref.book_table %s: a child of reversible %s that does not reverse', c.rel, c.parent_rel)
      from ref.book_table c join ref.book_table p on p.rel = c.parent_rel
     where p.reversible and not c.reversible and c.rel not in ('books.invoice', 'books.package_holding'));
  problems := problems || array(
    select format('ref.book_table %s: reversible with children, but no z_reversal_complete trigger', p.rel)
      from ref.book_table p
     where p.reversible and exists (select 1 from ref.book_table c where c.parent_rel = p.rel)
       and not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(p.rel) and g.tgname = 'z_reversal_complete'));
  problems := problems || array(
    select format('ref.book_table %s: rule %s has no trigger', b.rel, r)
      from ref.book_table b, unnest(b.rules) r
     where not exists (select 1 from pg_trigger g where g.tgrelid = to_regclass(b.rel) and g.tgname = r));

  -- Keys a later file adds by alter table (R4 B1) exist once that file has run: 19 keys ai.answer.inbound_message_id; 21
  -- keys the order columns of 15, 19 and its own request.
  problems := problems || array(
    select format('%s.%s: the key a later file adds is missing', k.rel, k.col)
      from (values ('ai.answer', 'inbound_message_id'), ('books.sale', 'order_id'), ('books.sale_line', 'order_line_id'),
                   ('books.payment', 'order_id'), ('books.outbound_message', 'order_id'), ('ops.order_request', 'order_id')) k(rel, col)
     where not exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                        where c.conrelid = k.rel::regclass and c.contype = 'f' and a.attname = k.col));

  -- Command totality (G3) and capabilities (CAP1): every command writes a books table and has a capability row; every
  -- books table is written by some command; every pack is closed under its requirements. The two PayPal commands (24)
  -- write no books table: their effect is the ops.paypal_link outbox row, which its own guard admits.
  problems := problems || array(
    select format('command %s: %s', c.command, concat_ws(', ',
             case when c.command not in ('paypal.request', 'paypal.cancel') and not exists (select 1 from ref.command_table t where t.command = c.command) then 'writes no books table' end,
             case when not exists (select 1 from ref.command_capability k where k.command = c.command) then 'no ref.command_capability row' end))
      from ref.command c
     where (c.command not in ('paypal.request', 'paypal.cancel') and not exists (select 1 from ref.command_table t where t.command = c.command))
        or not exists (select 1 from ref.command_capability k where k.command = c.command));
  problems := problems || array(
    select format('ref.book_table %s: no command writes it', b.rel)
      from ref.book_table b where not exists (select 1 from ref.command_table t where t.rel = b.rel));
  problems := problems || array(
    select format('pack %s: %s requires %s, which the pack lacks', p.business_type, p.capability, r.requires)
      from ref.pack_capability p join ref.capability_requires r on r.capability = p.capability
     where not exists (select 1 from ref.pack_capability q where q.business_type = p.business_type and q.capability = r.requires));

  -- Functions are invoker by default. Three are SECURITY DEFINER, each owned by munshi_owner with a pinned path and
  -- exact EXECUTE grants (G9), each a narrow door: the deployment-wide AI counter (22, an atomic boolean), the webhook's
  -- read of whether its shop is open (19, ops.inbound_open, a boolean), and the purge's revocation of a lapsed sign-up's
  -- channel grants (09, platform.purge_grants, revocations only).
  problems := problems || array(
    select format('function %s: %s', p.oid::regprocedure, concat_ws(', ',
             case when p.prosecdef and p.oid::regprocedure::text <> all (definers) then 'SECURITY DEFINER' end,
             case when not coalesce('search_path=pg_catalog, pg_temp' = any (p.proconfig), false) then 'search_path not pinned' end,
             case when has_function_privilege('public', p.oid, 'EXECUTE') then 'executable by PUBLIC' end))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any (schemas)
       and ((p.prosecdef and p.oid::regprocedure::text <> all (definers))
            or not coalesce('search_path=pg_catalog, pg_temp' = any (p.proconfig), false)
            or has_function_privilege('public', p.oid, 'EXECUTE')));

  problems := problems || array(
    select format('%s: SECURITY DEFINER owner is not munshi_owner', p.oid::regprocedure)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any (schemas) and p.oid::regprocedure::text = any (definers)
       and pg_get_userbyid(p.proowner) <> 'munshi_owner');

  -- A pending shop's app writes nothing but its creation (29_open.sql, D-080): every tenant table munshi_app inserts into
  -- carries a_open, but the books (a_write) and the tables whose own guard asks, or that hold the creation's rows.
  problems := problems || array(
    select format('%s: munshi_app inserts into it, and it has no a_open trigger', c.oid::regclass)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('ops', 'ai', 'approval', 'snap', 'audit') and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
       and has_table_privilege('munshi_app', c.oid, 'INSERT')
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname in ('a_write', 'a_open'))
       and c.oid::regclass::text not in ('ops.tenant', 'ops.tenant_directory', 'ops.member', 'ops.login', 'ops.shop', 'ops.capability_switch',
                                         'ops.login_session', 'ops.member_invite', 'ops.reset_grant', 'ops.shop_hours', 'approval.draft',
                                         'approval.decision', 'snap.snapshot', 'audit.audit_log', 'snap.pin', 'ai.finding_event',
                                         'ops.tenant_version'));

  -- The data version (26_version_push.sql, D-080): every table holding a shop's book or ops state carries z_version, the
  -- deferred per-row bump of ops.tenant_version, so no write leaves a cached read reachable. The exclusions are 26's
  -- list: the counter, sign-in sessions, idempotency keys, what a model call or a read leaves behind (its words
  -- too), and proposals.
  problems := problems || array(
    select format('%s: holds book or ops state, and has no deferred z_version trigger', c.oid::regclass)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('ops', 'books', 'approval', 'ai', 'platform') and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
       and c.oid::regclass::text not in ('ops.tenant_version', 'ops.login_session', 'ops.idempotency', 'ai.run', 'ai.trace', 'ai.answer',
                                         'ai.usage', 'ai.spend', 'platform.change', 'ops.message_text')
       and not exists (select 1 from pg_trigger g
                        where g.tgrelid = c.oid and g.tgname = 'z_version' and g.tgdeferrable and g.tginitdeferred
                          and g.tgfoid = 'ops.version_bump()'::regprocedure
                          and g.tgtype = 29)); -- row, after, insert or delete or update

  -- Every id column defaults to ops.uuidv7(), so the K1 tie-break `id desc` follows the order rows were made.
  problems := problems || array(
    select format('%s.%s.id: defaults to %s, not ops.uuidv7()', n.nspname, c.relname, coalesce(pg_get_expr(d.adbin, d.adrelid), 'nothing'))
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = any (schemas) and c.relkind in ('r', 'p') and a.attname = 'id' and not a.attisdropped
       and pg_get_expr(d.adbin, d.adrelid) is distinct from 'ops.uuidv7()');

  if cardinality(problems) > 0 then
    raise exception 'seal: % problem(s): %', cardinality(problems), array_to_string(problems, '; ');
  end if;
end $$;
