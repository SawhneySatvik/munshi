-- 0007 · Phase 2: UPI/card settlements, findings that point at their snapshot row, the snapshot's actor stamped by the
-- database, and who may add a member (ruling (b)).
set local role munshi_owner;

-- A payout from the UPI (or card) provider for one business day's counter takings, as recorded. Munshi never moves
-- money. A day is settled once (a correction is a reversal); the watcher compares it with the day's recorded receipts.
create table books.settlement (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  channel text not null check (channel in ('upi', 'card')),
  business_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reference text,
  received_on date not null,
  reverses_id uuid,
  reason text,
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, reverses_id),
  foreign key (tenant_id, reverses_id) references books.settlement,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((reverses_id is null) = (reason is null))
);

create trigger guard before insert or update or delete on books.settlement for each row execute function books.guard();
create trigger guard_audit after insert on books.settlement for each row execute function books.audit_row();

alter table books.settlement enable row level security;
alter table books.settlement force row level security;
create policy tenant_isolation on books.settlement
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

revoke all on books.settlement from public, munshi_app, munshi_agent;
grant select, insert on books.settlement to munshi_app;

create unique index settlement_day on books.settlement (tenant_id, channel, business_date) where reverses_id is null;

insert into ops.command_authority (command, role) values ('settlement.record', 'owner'), ('settlement.record', 'manager');
insert into ops.command_table (command, rel) values
  ('settlement.record', 'books.settlement'), ('settlement.record', 'books.journal_entry'), ('settlement.record', 'books.journal_line');

-- A finding is one row of its watcher's snapshot: ⟨snap:snapshot_id·snapshot_row·col⟩ are its numbers. No finding has
-- been written anywhere yet, so the column is added without a default (on a table with rows this fails, loudly).
alter table ops.finding add column snapshot_row integer not null check (snapshot_row >= 0);
create or replace view agent_view.finding as select tenant_id, id, kind, status, snapshot_id, snapshot_row from ops.finding;

-- The snapshot's actor is the acting member (none for a watcher), stamped here like created_txid, so a caller cannot
-- name someone else and a watcher's snapshots show that no actor was set.
create or replace function snap.snapshot_txn() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'snapshot' then
    new.created_txid := txid_current();
    new.actor_id := nullif(current_setting('munshi.actor_id', true), '')::uuid;
    return new;
  end if;
  perform 1 from snap.snapshot s
   where s.tenant_id = new.tenant_id and s.id = new.snapshot_id and s.created_txid = txid_current();
  if not found then
    raise exception 'snapshot cell refused: its snapshot was not created in this transaction' using errcode = 'MS006';
  end if;
  return new;
end $$;

-- Ruling (b): who may add a member. A tenant's first member is its owner adding themself (sign-up: the session's member
-- is the new row). After that only an active owner adds an owner or a manager, and an active owner or manager adds
-- staff. The acting member is trusted from the app (set in one place, from the session). Members are never updated
-- (no UPDATE grant), so a role cannot be raised later.
create function ops.member_guard() returns trigger language plpgsql as $$
declare
  ctx_tenant uuid := nullif(current_setting('munshi.tenant_id', true), '')::uuid;
  ctx_actor uuid := nullif(current_setting('munshi.actor_id', true), '')::uuid;
  actor_role text;
begin
  if new.tenant_id is distinct from ctx_tenant then
    raise exception 'member refused: the row is not for the current tenant' using errcode = 'MS007';
  end if;
  -- Two sign-ups at once would each see an empty tenant: serialise additions per tenant.
  perform pg_advisory_xact_lock(hashtextextended('munshi.member:' || new.tenant_id::text, 0));
  if not exists (select 1 from ops.member m where m.tenant_id = new.tenant_id) then
    if new.role <> 'owner' or not new.active or new.id is distinct from ctx_actor then
      raise exception 'member refused: a tenant''s first member is an active owner adding themself' using errcode = 'MS007';
    end if;
    return new;
  end if;
  select m.role into actor_role from ops.member m where m.tenant_id = new.tenant_id and m.id = ctx_actor and m.active;
  if actor_role is distinct from 'owner' and (new.role in ('owner', 'manager') or actor_role is distinct from 'manager') then
    raise exception 'member refused: an owner or manager is added by an active owner, staff by an active owner or manager'
      using errcode = 'MS007';
  end if;
  return new;
end $$;
revoke execute on function ops.member_guard() from public;

-- After the row, like books.audit_row: an addition skipped by ON CONFLICT DO NOTHING is not logged.
create function ops.member_audit() returns trigger language plpgsql as $$
begin
  insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload)
  values (new.tenant_id, nullif(current_setting('munshi.actor_id', true), '')::uuid, 'member.add', 'ops.member', new.id, to_jsonb(new));
  return null;
end $$;
revoke execute on function ops.member_audit() from public;

create trigger guard before insert on ops.member for each row execute function ops.member_guard();
create trigger guard_audit after insert on ops.member for each row execute function ops.member_audit();
