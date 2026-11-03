-- 01 · The ten schemas and the global constants (BLUEPRINT §2.1, §2.5, §2.9). Every file from here runs as the owner, so
-- the owner owns every object (gate G4); the build connects as munshi_migrator and never switches role itself.
set local role munshi_owner;

create schema ref authorization munshi_owner;        -- global constants, written only by the schema files
create schema ops authorization munshi_owner;        -- tenancy, people, documents, sign-in, intake: role-shaped writes
create schema books authorization munshi_owner;      -- the books: guarded, append-only
create schema approval authorization munshi_owner;   -- drafts and decisions
create schema snap authorization munshi_owner;       -- snapshots, the only source of a shown number, and their pins
create schema audit authorization munshi_owner;      -- the per-tenant hash chain and its checkpoints
create schema ai authorization munshi_owner;         -- runs, traces, findings, answers, briefs, usage
create schema agent_view authorization munshi_owner; -- the agent's views (names and ids, no numbers)
create schema idp authorization munshi_owner;        -- the password identity adapter's own tables (global)
create schema platform authorization munshi_owner;   -- the superadmin's world (global)

-- USAGE per role is the outer fence; each table's own revoke-then-grant block is the inner one. The agent reaches only
-- snapshots and its views; the idp role only its schema and the narrow ops rows a reset needs (§2.2).
revoke all on schema ref, ops, books, approval, snap, audit, ai, agent_view, idp, platform from public;
grant usage on schema ref to munshi_app, munshi_jobs;
grant usage on schema ops to munshi_app, munshi_public, munshi_jobs, munshi_idp, munshi_platform;
grant usage on schema books to munshi_app, munshi_public, munshi_jobs;
grant usage on schema approval to munshi_app;
grant usage on schema snap to munshi_app, munshi_public, munshi_jobs, munshi_agent;
grant usage on schema audit to munshi_app, munshi_jobs;
grant usage on schema ai to munshi_app, munshi_jobs, munshi_platform;
grant usage on schema agent_view to munshi_agent;
grant usage on schema idp to munshi_idp;
grant usage on schema platform to munshi_platform, munshi_app, munshi_jobs, munshi_public;

-- The ref tables are global (no tenant): RLS is forced like every Munshi table, with one permissive policy, and the
-- grants decide who reads. No runtime role writes ref; the schema files insert as the owner. Foreign keys into ref run
-- with the owner's rights, so a role needs no grant to be checked against them (decision 7).

-- The pack a shop starts from; it never changes on the tenant and carries no capability flags (R4 C1).
create table ref.business_type (
  code text primary key check (code in ('kirana', 'apparel', 'salon'))
);

-- The fixed chart (§2.9). customer_advance holds an order's advance until the delivery sale applies it (R4 O1).
create table ref.account (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  kind text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense')),
  normal text not null check (normal in ('debit', 'credit')),
  label_key text not null check (label_key ~ '^[a-z_.]{2,80}$')
);

create table ref.reason (
  code text primary key check (code ~ '^[a-z_]{2,40}$')
);

-- A reason column names its use (R4 N9): each table with a reason carries a constant generated column and keys the pair
-- here, so a code that exists but is not allowed for that use is refused by the foreign key.
create table ref.reason_use (
  code text not null references ref.reason,
  use text not null check (use in ('reversal', 'decision', 'dismiss', 'decline', 'discount', 'cancel')),
  primary key (code, use)
);

-- Every books table, with the shape the guard reads (§2.4, §2.9): its parent (a child row is accepted only in its
-- parent's transaction), whether it reverses, the columns a reversal negates and those it copies, and its b_ rules (TRG1).
create table ref.book_table (
  rel text primary key check (rel ~ '^books\.[a-z_]+$'),
  parent_rel text references ref.book_table,
  parent_col text check (parent_col ~ '^[a-z_]+$'),
  reversible boolean not null,
  signed_cols text[] not null default '{}',
  match_cols text[] not null default '{}',
  rules text[] not null default '{}',
  check ((parent_rel is null) = (parent_col is null)),
  check (reversible or (signed_cols = '{}' and match_cols = '{}'))
);

create table ref.command (
  command text primary key check (command ~ '^[a-z]+(\.[a-z_]+)+$'),
  draft_only boolean not null
);

create table ref.command_authority (
  command text not null references ref.command,
  role text not null check (role in ('owner', 'manager', 'staff')),
  primary key (command, role)
);

create table ref.command_table (
  command text not null references ref.command,
  rel text not null references ref.book_table,
  primary key (command, rel)
);

-- Capabilities, their requirements, the packs, which item kinds each allows, and each command's capability
-- (decision 17, R4 C1). Core reads these; the book guard never does.
create table ref.capability (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  label_key text not null check (label_key ~ '^[a-z_.]{2,80}$'),
  needs_grant boolean not null
);

create table ref.capability_requires (
  capability text not null references ref.capability,
  requires text not null references ref.capability,
  primary key (capability, requires),
  check (capability <> requires)
);

create table ref.pack_capability (
  business_type text not null references ref.business_type,
  capability text not null references ref.capability,
  primary key (business_type, capability)
);

create table ref.command_capability (
  command text not null references ref.command,
  capability text not null references ref.capability,
  use text not null check (use in ('start', 'finish')),
  primary key (command, capability)
);

create table ref.capability_item_kind (
  capability text not null references ref.capability,
  item_kind text not null check (item_kind in ('good', 'service', 'package')),
  primary key (capability, item_kind)
);

insert into ref.business_type (code) values ('kirana'), ('apparel'), ('salon');

insert into ref.account (code, kind, normal, label_key) values
  ('cash', 'asset', 'debit', 'account.cash'),
  ('upi_clearing', 'asset', 'debit', 'account.upi_clearing'),
  ('card_clearing', 'asset', 'debit', 'account.card_clearing'),
  ('bank', 'asset', 'debit', 'account.bank'),
  ('paypal_clearing', 'asset', 'debit', 'account.paypal_clearing'),
  ('receivable', 'asset', 'debit', 'account.receivable'),
  ('inventory', 'asset', 'debit', 'account.inventory'),
  ('staff_advance', 'asset', 'debit', 'account.staff_advance'),
  ('payable', 'liability', 'credit', 'account.payable'),
  ('package_liability', 'liability', 'credit', 'account.package_liability'),
  ('customer_advance', 'liability', 'credit', 'account.customer_advance'),
  ('gst_output_cgst', 'liability', 'credit', 'account.gst_output_cgst'),
  ('gst_output_sgst', 'liability', 'credit', 'account.gst_output_sgst'),
  ('wages_payable', 'liability', 'credit', 'account.wages_payable'),
  ('opening_equity', 'equity', 'credit', 'account.opening_equity'),
  ('sales', 'income', 'credit', 'account.sales'),
  ('sales_discount', 'income', 'debit', 'account.sales_discount'),
  ('package_breakage', 'income', 'credit', 'account.package_breakage'),
  ('wages_expense', 'expense', 'debit', 'account.wages_expense');

insert into ref.reason (code) values
  ('wrong_figure'), ('duplicate'), ('not_now'), ('customer_cancelled'), ('entered_in_error'), ('returned_goods'),
  ('damaged'), ('expired_offer'), ('not_relevant'), ('already_handled'), ('no_show'), ('staff_unavailable'), ('other');

-- dismiss, discount and cancel are §7.4, R4 N7 and §8.12's sets; reversal, decision and decline are this file's reading.
insert into ref.reason_use (code, use) values
  ('wrong_figure', 'reversal'), ('duplicate', 'reversal'), ('entered_in_error', 'reversal'), ('returned_goods', 'reversal'),
  ('damaged', 'reversal'), ('customer_cancelled', 'reversal'), ('expired_offer', 'reversal'), ('other', 'reversal'),
  ('wrong_figure', 'decision'), ('duplicate', 'decision'), ('not_now', 'decision'), ('not_relevant', 'decision'), ('other', 'decision'),
  ('not_relevant', 'dismiss'), ('already_handled', 'dismiss'), ('other', 'dismiss'),
  ('not_now', 'decline'), ('staff_unavailable', 'decline'), ('no_show', 'decline'), ('customer_cancelled', 'decline'),
  ('expired_offer', 'decline'), ('other', 'decline'),
  ('damaged', 'discount'), ('other', 'discount'),
  ('customer_cancelled', 'cancel'), ('other', 'cancel');

insert into ref.capability (code, label_key, needs_grant) values
  ('counter', 'capability.counter', false), ('credit', 'capability.credit', false), ('stock', 'capability.stock', false),
  ('buying', 'capability.buying', false), ('orders', 'capability.orders', false), ('stitching', 'capability.stitching', false),
  ('bookings', 'capability.bookings', false), ('holds', 'capability.holds', false), ('cart', 'capability.cart', false),
  ('offers', 'capability.offers', false), ('loyalty', 'capability.loyalty', false), ('packages', 'capability.packages', false),
  ('messaging', 'capability.messaging', true), ('campaigns', 'capability.campaigns', false), ('staff', 'capability.staff', false),
  ('salary', 'capability.salary', false), ('gst', 'capability.gst', false), ('site', 'capability.site', true),
  ('api', 'capability.api', false), ('ai', 'capability.ai', true), ('variants', 'capability.variants', false);

insert into ref.capability_requires (capability, requires) values
  ('credit', 'counter'), ('gst', 'counter'), ('offers', 'counter'), ('loyalty', 'counter'), ('packages', 'counter'),
  ('stitching', 'orders'), ('cart', 'orders'), ('cart', 'site'), ('holds', 'site'), ('campaigns', 'messaging'),
  ('salary', 'staff'), ('bookings', 'staff'), ('variants', 'stock');

insert into ref.pack_capability (business_type, capability)
select 'kirana', c from unnest(array['counter', 'credit', 'stock', 'buying', 'orders', 'offers', 'messaging', 'staff', 'gst',
                                     'site', 'ai']) as c
union all
select 'salon', c from unnest(array['counter', 'credit', 'bookings', 'packages', 'offers', 'loyalty', 'messaging', 'campaigns',
                                    'staff', 'salary', 'gst', 'site', 'ai']) as c
union all
select 'apparel', c from unnest(array['counter', 'credit', 'stock', 'buying', 'variants', 'orders', 'stitching', 'holds', 'cart',
                                      'offers', 'messaging', 'campaigns', 'staff', 'gst', 'site', 'ai']) as c;

insert into ref.capability_item_kind (capability, item_kind) values
  ('counter', 'good'), ('stock', 'good'), ('bookings', 'service'), ('stitching', 'service'), ('orders', 'good'),
  ('packages', 'package');

-- RLS and the grants, table by table.
alter table ref.business_type enable row level security;
alter table ref.business_type force row level security;
create policy global_rows on ref.business_type using (true) with check (true);
revoke all on ref.business_type from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.business_type to munshi_app, munshi_jobs;

alter table ref.account enable row level security;
alter table ref.account force row level security;
create policy global_rows on ref.account using (true) with check (true);
revoke all on ref.account from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.account to munshi_app, munshi_jobs;

alter table ref.reason enable row level security;
alter table ref.reason force row level security;
create policy global_rows on ref.reason using (true) with check (true);
revoke all on ref.reason from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.reason to munshi_app, munshi_jobs;

alter table ref.reason_use enable row level security;
alter table ref.reason_use force row level security;
create policy global_rows on ref.reason_use using (true) with check (true);
revoke all on ref.reason_use from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.reason_use to munshi_app, munshi_jobs;

alter table ref.book_table enable row level security;
alter table ref.book_table force row level security;
create policy global_rows on ref.book_table using (true) with check (true);
revoke all on ref.book_table from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.book_table to munshi_app, munshi_jobs;

alter table ref.command enable row level security;
alter table ref.command force row level security;
create policy global_rows on ref.command using (true) with check (true);
revoke all on ref.command from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.command to munshi_app, munshi_jobs;

alter table ref.command_authority enable row level security;
alter table ref.command_authority force row level security;
create policy global_rows on ref.command_authority using (true) with check (true);
revoke all on ref.command_authority from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.command_authority to munshi_app, munshi_jobs;

alter table ref.command_table enable row level security;
alter table ref.command_table force row level security;
create policy global_rows on ref.command_table using (true) with check (true);
revoke all on ref.command_table from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.command_table to munshi_app, munshi_jobs;

alter table ref.capability enable row level security;
alter table ref.capability force row level security;
create policy global_rows on ref.capability using (true) with check (true);
revoke all on ref.capability from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.capability to munshi_app, munshi_jobs;

alter table ref.capability_requires enable row level security;
alter table ref.capability_requires force row level security;
create policy global_rows on ref.capability_requires using (true) with check (true);
revoke all on ref.capability_requires from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.capability_requires to munshi_app, munshi_jobs;

alter table ref.pack_capability enable row level security;
alter table ref.pack_capability force row level security;
create policy global_rows on ref.pack_capability using (true) with check (true);
revoke all on ref.pack_capability from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.pack_capability to munshi_app, munshi_jobs;

alter table ref.command_capability enable row level security;
alter table ref.command_capability force row level security;
create policy global_rows on ref.command_capability using (true) with check (true);
revoke all on ref.command_capability from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.command_capability to munshi_app, munshi_jobs;

alter table ref.capability_item_kind enable row level security;
alter table ref.capability_item_kind force row level security;
create policy global_rows on ref.capability_item_kind using (true) with check (true);
revoke all on ref.capability_item_kind from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on ref.capability_item_kind to munshi_app, munshi_jobs;
