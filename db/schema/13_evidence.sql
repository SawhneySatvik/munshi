-- 13 · Photo evidence: a shelf count read from a photo, and a supplier bill read into lines. Ops,
-- append-only, written by the app as a member; a bill's lines only in the transaction that read it (MS006). The model's
-- raw answer is kept with its sha256 so a count can be re-derived from it; the agent sees these only as cells of
-- count.shelf and bill.lines. No column here names a table of a later file.
set local role munshi_owner;

-- matches is the number of boxed counts in the raw answer, so a stored count can be checked against it.
create table ops.shelf_count (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  item_id uuid not null,
  photo_sha256 bytea not null check (octet_length(photo_sha256) = 32),
  phrase text not null check (char_length(phrase) between 1 and 200),
  model text not null check (model ~ '^[A-Za-z0-9._:/-]{1,80}$'),
  raw text not null check (char_length(raw) <= 20000),
  raw_sha256 bytea not null,
  matches int not null check (matches >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, item_id) references books.item,
  constraint shelf_count_hashed check (raw_sha256 = sha256(convert_to(raw, 'UTF8'))),
  constraint shelf_count_matches check (
    matches = regexp_count(raw, '[0-9]+<\|box;x1=[0-9]+;y1=[0-9]+;x2=[0-9]+;y2=[0-9]+;w=[0-9]+;h=[0-9]+\|>'))
);

-- A bill as printed: number and date read from the photo, the supplier chosen by the person.
create table ops.bill_read (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  run_id uuid not null,
  supplier_id uuid not null,
  photo_sha256 bytea not null check (octet_length(photo_sha256) = 32),
  model text not null check (model ~ '^[A-Za-z0-9._:/-]{1,80}$'),
  bill_no text check (char_length(bill_no) between 1 and 40),
  bill_date date,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ai.run,
  foreign key (tenant_id, supplier_id) references books.supplier
);

-- A bill line as printed, with each figure's place on the photo's 0–1000 grid; a line with no place is refused.
create table ops.bill_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  bill_read_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  item_text text not null check (char_length(item_text) between 1 and 200),
  item_id uuid,
  qty_milli bigint not null check (qty_milli > 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  qty_box int[] not null,
  cost_box int[] not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, bill_read_id) references ops.bill_read,
  foreign key (tenant_id, item_id) references books.item,
  constraint bill_line_placed check (
    cardinality(qty_box) = 4 and array_position(qty_box, null) is null and 0 <= all (qty_box) and 1000 >= all (qty_box)
    and qty_box[1] <= qty_box[3] and qty_box[2] <= qty_box[4]
    and cardinality(cost_box) = 4 and array_position(cost_box, null) is null and 0 <= all (cost_box) and 1000 >= all (cost_box)
    and cost_box[1] <= cost_box[3] and cost_box[2] <= cost_box[4])
);

-- Written by the app as an active member; a bill read stamps its transaction, and its lines are accepted only in it.
create function ops.evidence_guard() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if current_user <> 'munshi_app' or not exists (
       select 1 from ops.member m
        where m.tenant_id = new.tenant_id and m.id = nullif(current_setting('munshi.actor_id', true), '')::uuid and m.active) then
    raise exception '%.% refused: evidence is stored by an active member, as munshi_app', tg_table_schema, tg_table_name using errcode = 'MS018';
  end if;
  if tg_table_name = 'bill_read' then
    new := jsonb_populate_record(new, jsonb_build_object('created_txid', txid_current()));
  elsif tg_table_name = 'bill_line' and not exists (
          select 1 from ops.bill_read b
           where b.tenant_id = new.tenant_id and b.id = (to_jsonb(new) ->> 'bill_read_id')::uuid and b.created_txid = txid_current()) then
    raise exception 'bill line refused: its bill was not read in this transaction' using errcode = 'MS006';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object('created_at', now()));
  return new;
end $$;
revoke execute on function ops.evidence_guard() from public;
create trigger guard before insert on ops.shelf_count for each row execute function ops.evidence_guard();
create trigger guard before insert on ops.bill_read for each row execute function ops.evidence_guard();
create trigger guard before insert on ops.bill_line for each row execute function ops.evidence_guard();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create index shelf_count_item on ops.shelf_count (tenant_id, item_id, created_at);
create index bill_read_supplier on ops.bill_read (tenant_id, supplier_id, created_at);
create unique index bill_line_no on ops.bill_line (tenant_id, bill_read_id, line_no);

-- RLS and the grants: the app's alone.
alter table ops.shelf_count enable row level security;
alter table ops.shelf_count force row level security;
create policy tenant_isolation on ops.shelf_count
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.shelf_count from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.shelf_count to munshi_app;

alter table ops.bill_read enable row level security;
alter table ops.bill_read force row level security;
create policy tenant_isolation on ops.bill_read
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.bill_read from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.bill_read to munshi_app;

alter table ops.bill_line enable row level security;
alter table ops.bill_line force row level security;
create policy tenant_isolation on ops.bill_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on ops.bill_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on ops.bill_line to munshi_app;
