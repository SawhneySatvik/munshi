-- 0004 · The audit log: append-only, one gapless hash chain per tenant.
-- hash(n) = sha256(hash(n-1) || canonical text of entry n). seq, prev_hash, hash and created_at are set by the
-- trigger, never by the caller. audit.verify_chain(tenant) recomputes the chain and returns the first broken seq.
set local role munshi_owner;

create table audit.audit_log (
  tenant_id uuid not null references ops.tenant,
  seq bigint not null check (seq > 0),
  actor_id uuid not null,
  decision_id uuid,
  command text,
  action text not null,
  entity text not null,
  entity_id uuid,
  payload jsonb not null,
  created_at timestamptz not null,
  prev_hash bytea,
  hash bytea not null,
  primary key (tenant_id, seq),
  foreign key (tenant_id, actor_id) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- One definition of the canonical entry text, shared by the insert trigger and the verifier. created_at is hashed as
-- epoch seconds so the text does not depend on the session time zone; chr(31) separates fields; NULL becomes ''.
create function audit.entry_hash(prev bytea, e audit.audit_log) returns bytea language sql stable as $$
  select sha256(coalesce(prev, ''::bytea) || convert_to(concat_ws(chr(31),
    e.tenant_id::text, e.seq::text, e.actor_id::text, coalesce(e.decision_id::text, ''), coalesce(e.command, ''),
    e.action, e.entity, coalesce(e.entity_id::text, ''), e.payload::text, extract(epoch from e.created_at)::text
  ), 'UTF8'))
$$;
revoke execute on function audit.entry_hash(bytea, audit.audit_log) from public;
grant execute on function audit.entry_hash(bytea, audit.audit_log) to munshi_app;

create function audit.chain() returns trigger language plpgsql as $$
declare
  last_seq bigint;
  last_hash bytea;
begin
  -- Serialises appends per tenant so seq stays gapless and each entry links to the true previous one.
  perform pg_advisory_xact_lock(hashtextextended('munshi.audit:' || new.tenant_id::text, 0));
  select a.seq, a.hash into last_seq, last_hash
    from audit.audit_log a where a.tenant_id = new.tenant_id order by a.seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.prev_hash := last_hash;
  new.created_at := now();
  new.hash := audit.entry_hash(new.prev_hash, new);
  return new;
end $$;
revoke execute on function audit.chain() from public;
create trigger chain before insert on audit.audit_log for each row execute function audit.chain();

create function audit.verify_chain(p_tenant uuid) returns bigint language plpgsql stable as $$
declare
  e audit.audit_log;
  expected bigint := 1;
  prev bytea;
begin
  -- Under RLS another tenant's chain would look empty and "verify"; refuse instead of answering vacuously.
  if p_tenant is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid then
    raise exception 'verify_chain: the tenant is not the current tenant' using errcode = 'MS003';
  end if;
  for e in select * from audit.audit_log a where a.tenant_id = p_tenant order by a.seq loop
    if e.seq <> expected or e.prev_hash is distinct from prev or e.hash is distinct from audit.entry_hash(prev, e) then
      return expected;
    end if;
    prev := e.hash;
    expected := expected + 1;
  end loop;
  return null;
end $$;
revoke execute on function audit.verify_chain(uuid) from public;
grant execute on function audit.verify_chain(uuid) to munshi_app;

alter table audit.audit_log enable row level security;
alter table audit.audit_log force row level security;
create policy tenant_isolation on audit.audit_log
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- Append-only: no UPDATE or DELETE grant to any runtime role.
revoke all on audit.audit_log from public, munshi_app, munshi_agent;
grant select, insert on audit.audit_log to munshi_app;

create index audit_entity on audit.audit_log (tenant_id, entity, entity_id);
