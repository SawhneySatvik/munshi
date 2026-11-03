-- 29 · A pending shop's app writes nothing but its creation, so a real shop the operator has not accepted stores
-- nothing a person typed. ops.open_write (03) is attached as `a_open`,
-- before insert, to every tenant table munshi_app may insert into, but:
--   the creation transaction's own rows and the owner's session: ops.tenant, ops.tenant_directory, ops.member,
--     ops.login, ops.shop, ops.capability_switch, ops.login_session (their guards hold the rest of each rule);
--   the tables whose own guard refuses a pending shop (MS020): ops.member_invite, ops.reset_grant, ops.shop_hours,
--     approval.draft, approval.decision, snap.snapshot;
--   rows only a trigger writes beside those: audit.audit_log, snap.pin, ai.finding_event, and the creation's
--     ops.tenant_version (26);
--   the books, whose a_write guard refuses a pending shop itself.
-- So a later file's new app table takes the rule without a word, and 90_seal.sql fails the build if any table escapes it.
-- The attachment is read from the catalog here, by the build's own connection, as every file's DDL is: hand-written
-- intent, not a diff. No table of its own.
set local role munshi_owner;

do $$
declare
  rel regclass;
begin
  for rel in
    select c.oid::regclass from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('ops', 'ai', 'approval', 'snap', 'audit') and c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
       and has_table_privilege('munshi_app', c.oid, 'INSERT')
       and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'a_write')
       and c.oid::regclass::text not in ('ops.tenant', 'ops.tenant_directory', 'ops.member', 'ops.login', 'ops.shop', 'ops.capability_switch',
                                         'ops.login_session', 'ops.member_invite', 'ops.reset_grant', 'ops.shop_hours', 'approval.draft',
                                         'approval.decision', 'snap.snapshot', 'audit.audit_log', 'snap.pin', 'ai.finding_event',
                                         'ops.tenant_version')
     order by 1
  loop
    execute format('create trigger a_open before insert on %s for each row execute function ops.open_write()', rel);
  end loop;
end $$;
