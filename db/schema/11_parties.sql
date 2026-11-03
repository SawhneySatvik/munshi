-- 11 · Parties: customers, suppliers and staff as ids, their effective-dated terms, their link to the contact vault,
-- and consent. No name or phone column: a person lives in ops.contact and a book row names them by id through
-- books.party_contact, so erasing the contact leaves the books whole and nameless. No column here names a table of a
-- later file (customer_consent.evidence_id names an ops row by kind, checked, with no key).
set local role munshi_owner;

create table books.customer (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

create table books.customer_terms (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid not null,
  credit_limit_minor bigint not null check (credit_limit_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- Every supplier states whether it is simulated (no default); a simulated supplier's deliveries are always recorded.
create table books.supplier (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  is_simulated boolean not null,
  gstin text check (gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- A staff member, with their app sign-in when they have one.
create table books.staff (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  member_id uuid,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, member_id) references ops.member,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- Home branch, title and pay, set per business day. A salary line copies its terms through a composite key on
-- these columns, so the copy can never differ from the row it names.
create table books.staff_terms (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  staff_id uuid not null,
  shop_id uuid not null,
  title text check (char_length(title) between 1 and 40),
  pay_kind text not null check (pay_kind in ('daily', 'monthly')),
  pay_minor bigint not null check (pay_minor >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from date not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, shop_id) references ops.shop,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision
);

-- Which contact names a customer, supplier or staff member (exactly one of them), from effective_from on. A changed
-- phone is a new contact and a new link; the link survives the contact's erasure, as an id.
create table books.party_contact (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid,
  supplier_id uuid,
  staff_id uuid,
  contact_id uuid not null,
  effective_from timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, supplier_id) references books.supplier,
  foreign key (tenant_id, staff_id) references books.staff,
  foreign key (tenant_id, contact_id) references ops.contact,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check (num_nonnulls(customer_id, supplier_id, staff_id) = 1)
);

-- Consent per customer, channel and purpose; the latest row wins and a withdrawal is a new row. It belongs to the
-- contact who gave it: b_consent_contact holds that contact_id is the customer's link in effect when it is
-- recorded, and an audience counts it only while that link still is. The evidence is an ops row (a reply, an
-- imported file), named by kind and id with no key.
create table books.customer_consent (
  tenant_id uuid not null references ops.tenant,
  id uuid not null default ops.uuidv7(),
  customer_id uuid not null,
  contact_id uuid not null,
  channel text not null check (channel in ('whatsapp', 'sms')),
  purpose text not null check (purpose in ('marketing', 'service')),
  granted boolean not null,
  source text not null check (source in ('in_person', 'whatsapp_reply', 'in_chat_attested', 'import')),
  evidence_rel text check (evidence_rel in ('ops.inbound_message', 'ops.document')),
  evidence_id uuid,
  notice_version text check (notice_version ~ '^[a-z0-9_.-]{1,40}$'),
  at timestamptz not null,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, customer_id) references books.customer,
  foreign key (tenant_id, contact_id) references ops.contact,
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  check ((evidence_rel is null) = (evidence_id is null)),
  check (source <> 'whatsapp_reply' or evidence_rel = 'ops.inbound_message'),
  check (not granted or notice_version is not null),
  check (at <= created_at)
);

create function books.consent_contact() returns trigger language plpgsql
  set search_path = pg_catalog, pg_temp as $$
begin
  if new.contact_id is distinct from (
       select p.contact_id from books.party_contact p
        where p.tenant_id = new.tenant_id and p.customer_id = new.customer_id and p.effective_from <= now()
        order by p.effective_from desc, p.created_at desc, p.id desc limit 1) then
    raise exception 'consent refused: consent names the customer''s contact in effect now' using errcode = 'MS001';
  end if;
  return new;
end $$;
revoke execute on function books.consent_contact() from public;

create trigger a_write before insert or update or delete on books.customer for each row execute function books.write();
create trigger z_audit after insert on books.customer for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.customer_terms for each row execute function books.write();
create trigger z_audit after insert on books.customer_terms for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.supplier for each row execute function books.write();
create trigger z_audit after insert on books.supplier for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.staff for each row execute function books.write();
create trigger z_audit after insert on books.staff for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.staff_terms for each row execute function books.write();
create trigger z_audit after insert on books.staff_terms for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.party_contact for each row execute function books.write();
create trigger z_audit after insert on books.party_contact for each row execute function books.audit_row();
create trigger a_write before insert or update or delete on books.customer_consent for each row execute function books.write();
create trigger b_consent_contact before insert on books.customer_consent for each row execute function books.consent_contact();
create trigger z_audit after insert on books.customer_consent for each row execute function books.audit_row();

-- Indexes, one per statement, each asserted in pg_index by the gate tests.
create index customer_terms_latest on books.customer_terms (tenant_id, customer_id, effective_from desc, created_at desc);
create unique index staff_member on books.staff (tenant_id, member_id) where member_id is not null;
create index staff_terms_latest on books.staff_terms (tenant_id, staff_id, effective_from desc, created_at desc);
create unique index staff_terms_copy on books.staff_terms (tenant_id, id, staff_id, pay_kind, pay_minor, currency);
create index party_contact_contact on books.party_contact (tenant_id, contact_id);
create index party_contact_customer on books.party_contact (tenant_id, customer_id, effective_from desc, created_at desc);
create index party_contact_supplier on books.party_contact (tenant_id, supplier_id, effective_from desc, created_at desc);
create index party_contact_staff on books.party_contact (tenant_id, staff_id, effective_from desc, created_at desc);
create index consent_latest on books.customer_consent (tenant_id, customer_id, channel, purpose, created_at);

-- The book table manifest and the commands. booking.confirm lands with the bookings (14); order.confirm
-- adds its rows for these tables in 21.
insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols, rules) values
  ('books.customer', null, null, false, '{}', '{}', '{}'),
  ('books.customer_terms', null, null, false, '{}', '{}', '{}'),
  ('books.supplier', null, null, false, '{}', '{}', '{}'),
  ('books.staff', null, null, false, '{}', '{}', '{}'),
  ('books.staff_terms', null, null, false, '{}', '{}', '{}'),
  ('books.party_contact', null, null, false, '{}', '{}', '{}'),
  ('books.customer_consent', null, null, false, '{}', '{}', '{b_consent_contact}');
insert into ref.command (command, draft_only) values
  ('customer.create', false), ('customer.terms', false), ('contact.link', false), ('supplier.create', false),
  ('staff.create', false), ('staff.terms', false), ('consent.record', false);
insert into ref.command_authority (command, role) values
  ('customer.create', 'owner'), ('customer.create', 'manager'), ('customer.terms', 'owner'), ('customer.terms', 'manager'),
  ('contact.link', 'owner'), ('contact.link', 'manager'), ('supplier.create', 'owner'), ('supplier.create', 'manager'),
  ('staff.create', 'owner'), ('staff.terms', 'owner'),
  ('consent.record', 'owner'), ('consent.record', 'manager'), ('consent.record', 'staff');
insert into ref.command_table (command, rel) values
  ('customer.create', 'books.customer'), ('customer.create', 'books.customer_terms'), ('customer.create', 'books.party_contact'),
  ('customer.terms', 'books.customer_terms'), ('contact.link', 'books.party_contact'),
  ('supplier.create', 'books.supplier'), ('supplier.create', 'books.party_contact'),
  ('staff.create', 'books.staff'), ('staff.create', 'books.staff_terms'), ('staff.create', 'books.party_contact'),
  ('staff.terms', 'books.staff_terms'), ('consent.record', 'books.customer_consent');
insert into ref.command_capability (command, capability, use) values
  ('customer.create', 'counter', 'start'), ('customer.terms', 'credit', 'start'), ('contact.link', 'counter', 'start'),
  ('supplier.create', 'buying', 'start'), ('staff.create', 'staff', 'start'), ('staff.terms', 'staff', 'start'),
  ('consent.record', 'messaging', 'finish');

-- RLS and the grants: books are the app's (S I) and the jobs role's (S) only.
alter table books.customer enable row level security;
alter table books.customer force row level security;
create policy tenant_isolation on books.customer
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.customer from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.customer to munshi_app;
grant select on books.customer to munshi_jobs;

alter table books.customer_terms enable row level security;
alter table books.customer_terms force row level security;
create policy tenant_isolation on books.customer_terms
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.customer_terms from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.customer_terms to munshi_app;
grant select on books.customer_terms to munshi_jobs;

alter table books.supplier enable row level security;
alter table books.supplier force row level security;
create policy tenant_isolation on books.supplier
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.supplier from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.supplier to munshi_app;
grant select on books.supplier to munshi_jobs;

alter table books.staff enable row level security;
alter table books.staff force row level security;
create policy tenant_isolation on books.staff
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.staff from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.staff to munshi_app;
grant select on books.staff to munshi_jobs;

alter table books.staff_terms enable row level security;
alter table books.staff_terms force row level security;
create policy tenant_isolation on books.staff_terms
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.staff_terms from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.staff_terms to munshi_app;
grant select on books.staff_terms to munshi_jobs;

alter table books.party_contact enable row level security;
alter table books.party_contact force row level security;
create policy tenant_isolation on books.party_contact
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.party_contact from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.party_contact to munshi_app;
grant select on books.party_contact to munshi_jobs;

alter table books.customer_consent enable row level security;
alter table books.customer_consent force row level security;
create policy tenant_isolation on books.customer_consent
  using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
  with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
revoke all on books.customer_consent from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select, insert on books.customer_consent to munshi_app;
grant select on books.customer_consent to munshi_jobs;
