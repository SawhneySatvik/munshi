-- 18 · GST: the registration and the invoice (BLUEPRINT §2.10.9, §8.9). Books, through books.write. An invoice is a
-- child of its sale, written by the sale's own command in the sale's transaction; it never reverses: a sale.reverse
-- writes a credit note under the reversal sale, naming the original invoice. b_invoice_number numbers each kind in its
-- own series per shop and financial year, gapless, and dates it from the clock after the series lock (R4 M1, W4); a
-- registered shop's sale is dated now (MS016). z_invoice_total checks at commit that the invoice's totals are its
-- lines' and each line its sale line's, taxed on the discounted price (D-052): the line shows its discounts, its total
-- is the sale line's gross less them, and its taxable value and tax are §8.9's split of that total at the stored rate
-- (R4 N2, MS004). Tax rates live in the country pack, never here (R21): the database checks only that the stored figures
-- agree.
-- No column here names a table of a later file.
set local role munshi_owner;

-- One registration per state, the latest in effect winning; a shop's is the one whose state is the shop's (R4 N3).
create table books.tax_registration (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  scheme text not null check (scheme in ('regular', 'composition', 'unregistered')),
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  state_code text not null check (state_code ~ '^[0-9]{2}$'),
  effective_from date not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((scheme = 'unregistered') = (gstin is null)),
  check (gstin is null or left(gstin, 2) = state_code)
);

-- series, fy, number, issued_at, registration_id, seller_gstin and place_of_supply are b_invoice_number's; a caller's
-- values are overwritten. Intra-state only in v1, so igst is zero.
create table books.invoice (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  sale_id uuid not null,
  shop_id uuid not null,
  registration_id uuid not null,
  kind text not null check (kind in ('tax_invoice', 'bill_of_supply', 'credit_note')),
  series text not null check (series ~ '^[A-Z0-9]{1,8}$'),
  fy text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  number int not null check (number > 0),
  issued_at timestamptz not null,
  seller_gstin text not null check (seller_gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  buyer_gstin text check (buyer_gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  place_of_supply text not null check (place_of_supply ~ '^[0-9]{2}$'),
  taxable_minor bigint not null,
  cgst_minor bigint not null,
  sgst_minor bigint not null,
  igst_minor bigint not null default 0 check (igst_minor = 0),
  total_minor bigint not null,
  currency char(3) not null,
  original_invoice_id uuid,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, sale_id, currency) references books.sale (tenant_id, id, currency),
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, registration_id) references books.tax_registration,
  foreign key (tenant_id, original_invoice_id) references books.invoice,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (total_minor = taxable_minor + cgst_minor + sgst_minor),
  check (kind <> 'bill_of_supply' or (cgst_minor = 0 and sgst_minor = 0)),
  check ((kind = 'credit_note') = (original_invoice_id is not null))
);

-- A line is its sale line's, once (R4 N2): the key names the sale line, and one invoice line per sale line. It shows the
-- line's discounts (D-052); its total is what the customer paid for the line, GST inside it.
create table books.invoice_line (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  invoice_id uuid not null,
  line_no int not null check (line_no between 1 and 500),
  sale_line_id uuid not null,
  description text not null check (char_length(description) between 1 and 120),
  hsn_sac text check (hsn_sac ~ '^[0-9]{4,8}$'),
  qty_milli bigint not null,
  discount_minor bigint not null default 0,
  taxable_minor bigint not null,
  rate_bp int not null check (rate_bp >= 0),
  cgst_minor bigint not null,
  sgst_minor bigint not null,
  total_minor bigint not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, invoice_id) references books.invoice,
  foreign key (tenant_id, sale_line_id) references books.sale_line,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (total_minor = taxable_minor + cgst_minor + sgst_minor)
);

-- b_invoice_number. The sale is dated now for a registered shop (MS016), the kind fits the sale (a credit note only
-- under a reversal sale, naming the original's invoice) and the registration in effect for the shop's state, whose
-- GSTIN is the seller's. Then, under the series lock (the chain lock first, R4 W2), the time and the financial year come
-- from clock_timestamp() in the tenant's zone and the number is the series' committed max + 1: book commands run at READ
-- COMMITTED, so the max sees the last committed number, and a rolled-back sale frees its number (gapless, R4 M1, W4).
-- The lock names the shop, series and kind but not the year, which is read from the clock only once the lock is held.
create function books.invoice_number() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  shop ops.shop;
  sold books.sale;
  reg books.tax_registration;
  tz text;
  local_day date;
begin
  select * into shop from ops.shop s where s.tenant_id = new.tenant_id and s.id = new.shop_id;
  select * into sold from books.sale s where s.tenant_id = new.tenant_id and s.id = new.sale_id;
  if sold.shop_id is distinct from new.shop_id or shop.invoice_series is null or shop.state_code is null then
    raise exception 'invoice refused: an invoice is its sale''s shop''s, which has an invoice series and a state' using errcode = 'MS007';
  end if;
  if sold.sold_at < now() - interval '10 minutes' or sold.sold_at > now() + interval '10 minutes' then
    raise exception 'invoice refused: a registered shop''s sale is dated now' using errcode = 'MS016';
  end if;
  if (new.kind = 'credit_note') is distinct from (sold.reverses_id is not null)
     or (new.kind = 'credit_note' and new.original_invoice_id is distinct from (
           select i.id from books.invoice i where i.tenant_id = new.tenant_id and i.sale_id = sold.reverses_id)) then
    raise exception 'invoice refused: a credit note is the reversal sale''s, naming the original sale''s invoice' using errcode = 'MS013';
  end if;

  perform pg_advisory_xact_lock(1, hashtext(new.tenant_id::text));
  perform pg_advisory_xact_lock(6, hashtext(new.tenant_id::text || new.shop_id::text || shop.invoice_series || new.kind));
  tz := (select t.time_zone from ops.tenant t where t.tenant_id = new.tenant_id);
  new.issued_at := clock_timestamp();
  local_day := (new.issued_at at time zone tz)::date;
  new.fy := to_char(local_day - interval '3 months', 'YYYY') || '-' || to_char(local_day + interval '9 months', 'YY');
  new.series := shop.invoice_series;
  new.place_of_supply := shop.state_code;
  select * into reg from books.tax_registration r
   where r.tenant_id = new.tenant_id and r.state_code = shop.state_code and r.effective_from <= local_day
   order by r.effective_from desc, r.created_at desc, r.id desc limit 1;
  if reg.id is null or reg.scheme = 'unregistered'
     or (reg.scheme = 'regular' and new.kind = 'bill_of_supply') or (reg.scheme = 'composition' and new.kind = 'tax_invoice') then
    raise exception 'invoice refused: a % needs the shop''s registration in effect to allow it', new.kind using errcode = 'MS007';
  end if;
  new.registration_id := reg.id;
  new.seller_gstin := reg.gstin;
  new.number := coalesce((select max(i.number) from books.invoice i
                           where i.tenant_id = new.tenant_id and i.shop_id = new.shop_id and i.series = new.series
                             and i.kind = new.kind and i.fy = new.fy), 0) + 1;
  return new;
end $$;
revoke execute on function books.invoice_number() from public;

-- z_invoice_total: at commit, the invoice has lines; its totals are their sums; each line is a line of the invoice's sale,
-- once, and every sale line is on it. Each line is taxed on the discounted price (D-052, CGST Act s.15(3)(a) as read):
-- its discount is its sale line's discounts, its total that line's gross less them, its rate the sale line's, its
-- taxable value round(total × 10000 ÷ (10000 + rate)) half away from zero (§8.9), its CGST + SGST the rest, which is
-- the sale line's tax, and its CGST half the tax truncated toward zero (§8.9's floor, mirrored for a credit note), SGST
-- the remainder. A discount on an invoiced sale names its line, so each line's discount is known; the invoice then
-- totals the sale. A bill of supply's lines carry no tax (R4 N2, W3, MS004).
create function books.invoice_total() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
declare
  lines int;
  sums record;
begin
  select count(*) as n, sum(l.taxable_minor) as taxable, sum(l.cgst_minor) as cgst, sum(l.sgst_minor) as sgst, sum(l.total_minor) as total
    into sums from books.invoice_line l where l.tenant_id = new.tenant_id and l.invoice_id = new.id;
  lines := sums.n;
  if lines = 0
     or (new.taxable_minor, new.cgst_minor, new.sgst_minor, new.total_minor) is distinct from (sums.taxable, sums.cgst, sums.sgst, sums.total)
     or lines <> (select count(*) from books.sale_line s where s.tenant_id = new.tenant_id and s.sale_id = new.sale_id)
     or exists (select 1 from books.sale_discount d where d.tenant_id = new.tenant_id and d.sale_id = new.sale_id and d.line_no is null)
     or exists (select 1 from books.invoice_line l
                  left join books.sale_line s on s.tenant_id = l.tenant_id and s.id = l.sale_line_id and s.sale_id = new.sale_id
                  left join lateral (select coalesce(sum(d.amount_minor), 0) as off from books.sale_discount d
                                      where d.tenant_id = s.tenant_id and d.sale_id = s.sale_id and d.line_no = s.line_no) x on true
                 where l.tenant_id = new.tenant_id and l.invoice_id = new.id
                   and (s.id is null or l.qty_milli <> s.qty_milli or l.rate_bp <> s.tax_rate_bp
                        or l.discount_minor <> x.off or l.total_minor <> s.gross_minor - x.off
                        or l.taxable_minor <> round((s.gross_minor - x.off)::numeric * 10000 / (10000 + s.tax_rate_bp))
                        or l.cgst_minor + l.sgst_minor <> s.tax_minor or l.cgst_minor <> trunc((l.cgst_minor + l.sgst_minor) / 2.0)
                        or (new.kind = 'bill_of_supply' and (l.cgst_minor <> 0 or l.sgst_minor <> 0)))) then
    raise exception 'invoice refused: its totals are not its lines'', or a line is not its sale line''s taxed on its discounted price'
      using errcode = 'MS004';
  end if;
  return null;
end $$;
revoke execute on function books.invoice_total() from public;

create trigger a_write before insert or update or delete on books.tax_registration for each row execute function books.write();
create trigger z_audit after insert on books.tax_registration for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.invoice for each row execute function books.write();
create trigger b_invoice_number before insert on books.invoice for each row execute function books.invoice_number();
create trigger z_audit after insert on books.invoice for each row execute function books.audit_row();
create constraint trigger z_invoice_total after insert on books.invoice deferrable initially deferred for each row
  execute function books.invoice_total();
create trigger a_write before insert or update or delete on books.invoice_line for each row execute function books.write();
create trigger z_audit after insert on books.invoice_line for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index (G10). invoice_no is M1's key: each kind numbers its own series.
create index tax_registration_state on books.tax_registration (tenant_id, state_code, effective_from desc, created_at desc);
create unique index invoice_no on books.invoice (tenant_id, shop_id, series, kind, fy, number);
create unique index invoice_sale on books.invoice (tenant_id, sale_id);
create index invoice_shop_issued on books.invoice (tenant_id, shop_id, issued_at);
create index invoice_original on books.invoice (tenant_id, original_invoice_id) where original_invoice_id is not null;
create unique index invoice_line_no on books.invoice_line (tenant_id, invoice_id, line_no);
create unique index invoice_line_sale_line on books.invoice_line (tenant_id, sale_line_id);

-- The book table manifest and the commands (§2.4, §2.10.14). sale.record writes the invoice, sale.reverse its credit note.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.tax_registration', null, null, false, '{}', '{}', '{}'),
  ('books.invoice', 'books.sale', 'sale_id', false, '{}', '{}', '{b_invoice_number}'),
  ('books.invoice_line', 'books.invoice', 'invoice_id', false, '{}', '{}', '{}');
insert into ref.command (command, draft_only) values ('tax.registration.set', false);
insert into ref.command_authority (command, role) values ('tax.registration.set', 'owner');
insert into ref.command_table (command, rel)
select 'tax.registration.set', 'books.tax_registration'
union all
select c, t from unnest(array['sale.record', 'sale.reverse']) c, unnest(array['books.invoice', 'books.invoice_line']) t;
insert into ref.command_capability (command, capability, use) values ('tax.registration.set', 'gst', 'start');

-- RLS and the grants: books are the app's (S I) and the jobs role's (S) only.
alter table books.tax_registration enable row level security;
alter table books.tax_registration force row level security;
create policy tenant_isolation on books.tax_registration
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.tax_registration from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.tax_registration to munshi_app;
grant select on books.tax_registration to munshi_jobs;

alter table books.invoice enable row level security;
alter table books.invoice force row level security;
create policy tenant_isolation on books.invoice
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.invoice from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.invoice to munshi_app;
grant select on books.invoice to munshi_jobs;

alter table books.invoice_line enable row level security;
alter table books.invoice_line force row level security;
create policy tenant_isolation on books.invoice_line
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.invoice_line from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.invoice_line to munshi_app;
grant select on books.invoice_line to munshi_jobs;
