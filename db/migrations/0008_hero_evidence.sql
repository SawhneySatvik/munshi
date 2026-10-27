-- 0008 · The hero chain's evidence (MS-8): a shelf count read off a photo by the segment model, and a supplier's bill
-- read off a photo by the vision model. Both are ops rows (evidence, not books) that only core writes and that reach a
-- screen only as cells of a named read (count.shelf, bill.lines); a draft built from them still waits for a person.
-- Also item aliases (the catalogue's other spellings, a book), which a bill line's text is matched against by plain code.
set local role munshi_owner;

-- A photo run: the app starts one for a shelf or a bill photo, like a question.
alter table ops.run drop constraint run_trigger_check;
alter table ops.run add constraint run_trigger_check check (trigger in ('question', 'watcher', 'brief', 'photo'));

-- Another spelling of an item, as a supplier's bill prints it ("BUTTER 100G"). Catalogue, so a book: written only by the
-- item.alias command, which stores it normalised (NFKC, trimmed, inner whitespace collapsed, lower case); one item per
-- spelling.
create table books.item_alias (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  item_id uuid not null,
  alias text not null check (alias <> ''),
  created_by uuid not null,
  decision_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, alias),
  foreign key (tenant_id, item_id) references books.item,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create trigger guard before insert or update or delete on books.item_alias for each row execute function books.guard();
create trigger guard_audit after insert on books.item_alias for each row execute function books.audit_row();

insert into ops.command_authority (command, role) values ('item.alias', 'owner'), ('item.alias', 'manager');
insert into ops.command_table (command, rel) values ('item.alias', 'books.item_alias');

-- One catalogue item counted on one shelf photo by the segment model (one noun phrase per request): the phrase, the
-- model's raw response, that response's sha256 (taken where the response arrived), and its number of matches. The two
-- named checks tie them together, on insert and on any later update by the owner: a response edited after it was
-- hashed is refused (shelf_count_hashed), and so is a count that is not the number of box records in the response
-- (shelf_count_matches). The photo itself is named by its sha256.
create table ops.shelf_count (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  item_id uuid not null,
  photo_sha256 text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  phrase text not null,
  model text not null,
  raw text not null,
  raw_sha256 text not null,
  matches integer not null check (matches >= 0),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ops.run,
  foreign key (tenant_id, item_id) references books.item,
  constraint shelf_count_hashed check (raw_sha256 = encode(sha256(convert_to(raw, 'UTF8')), 'hex')),
  constraint shelf_count_matches check (
    matches = regexp_count(raw, '[0-9]+<\|box;x1=[0-9]+;y1=[0-9]+;x2=[0-9]+;y2=[0-9]+;w=[0-9]+;h=[0-9]+\|>'))
);

-- A supplier's bill as the vision model read it (no tools: quarantined), for the supplier the person named. The bill
-- number and date are as printed (untrusted text). created_txid is stamped by the trigger below: a line is accepted only
-- in the transaction that read the bill, so a stored bill cannot gain a figure later.
create table ops.bill_read (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  run_id uuid not null,
  supplier_id uuid not null,
  photo_sha256 text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  model text not null,
  bill_no text,
  bill_date date,
  created_txid bigint not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, run_id) references ops.run,
  foreign key (tenant_id, supplier_id) references books.supplier
);

-- One item line of a read bill: its text as printed (untrusted), the catalogue item core matched it to by plain code
-- (exact name or alias; none when no single item matches), and its two figures, each with its place on the page as
-- [x_min, y_min, x_max, y_max] on the 0–1000 grid. A figure with no place is refused (bill_line_placed).
create table ops.bill_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default gen_random_uuid(),
  bill_read_id uuid not null,
  line_no integer not null check (line_no > 0),
  item_text text not null,
  item_id uuid,
  qty_milli bigint not null check (qty_milli > 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  qty_box integer[],
  cost_box integer[],
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, bill_read_id, line_no),
  foreign key (tenant_id, bill_read_id) references ops.bill_read,
  foreign key (tenant_id, item_id) references books.item,
  constraint bill_line_placed check (
    qty_box is not null and cardinality(qty_box) = 4 and array_position(qty_box, null) is null
    and 0 <= all (qty_box) and 1000 >= all (qty_box) and qty_box[1] <= qty_box[3] and qty_box[2] <= qty_box[4]
    and cost_box is not null and cardinality(cost_box) = 4 and array_position(cost_box, null) is null
    and 0 <= all (cost_box) and 1000 >= all (cost_box) and cost_box[1] <= cost_box[3] and cost_box[2] <= cost_box[4])
);

create function ops.bill_read_txn() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'bill_read' then
    new.created_txid := txid_current();
    return new;
  end if;
  perform 1 from ops.bill_read b
   where b.tenant_id = new.tenant_id and b.id = new.bill_read_id and b.created_txid = txid_current();
  if not found then
    raise exception 'bill line refused: its bill was not read in this transaction' using errcode = 'MS006';
  end if;
  return new;
end $$;
revoke execute on function ops.bill_read_txn() from public;
create trigger txn before insert on ops.bill_read for each row execute function ops.bill_read_txn();
create trigger txn before insert on ops.bill_line for each row execute function ops.bill_read_txn();

alter table books.item_alias enable row level security;
alter table books.item_alias force row level security;
create policy tenant_isolation on books.item_alias
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.shelf_count enable row level security;
alter table ops.shelf_count force row level security;
create policy tenant_isolation on ops.shelf_count
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.bill_read enable row level security;
alter table ops.bill_read force row level security;
create policy tenant_isolation on ops.bill_read
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

alter table ops.bill_line enable row level security;
alter table ops.bill_line force row level security;
create policy tenant_isolation on ops.bill_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));

-- Append-only, like the books: the app inserts and reads; the agent reads none of it (only the cells of its reads).
revoke all on books.item_alias from public, munshi_app, munshi_agent;
grant select, insert on books.item_alias to munshi_app;

revoke all on ops.shelf_count from public, munshi_app, munshi_agent;
grant select, insert on ops.shelf_count to munshi_app;

revoke all on ops.bill_read from public, munshi_app, munshi_agent;
grant select, insert on ops.bill_read to munshi_app;

revoke all on ops.bill_line from public, munshi_app, munshi_agent;
grant select, insert on ops.bill_line to munshi_app;
