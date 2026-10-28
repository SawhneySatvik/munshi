-- 0011 · Items (MS-19a; docs/MERCHANTS-DESIGN.md 0011): a salon's services and packages, and a suit shop's variants, as
-- columns of books.item. Every existing row is a good with no duration, no parent and no attributes, so each new check
-- holds on it. No new command and no new authority: item.create already writes books.item.
set local role munshi_owner;

alter table books.item add column kind text not null default 'good' check (kind in ('good', 'service', 'package'));
alter table books.item add column duration_min integer check (duration_min between 5 and 600);
-- A variant is a child item (one level, and only a good has variants: core checks both in item.create); stock, price and
-- the counter work per child, unchanged.
alter table books.item add column parent_item_id uuid;
alter table books.item add column attrs jsonb not null default '{}' check (jsonb_typeof(attrs) = 'object');
alter table books.item add constraint item_parent_fkey foreign key (tenant_id, parent_item_id) references books.item;
alter table books.item add constraint item_not_own_parent check (parent_item_id <> id);
alter table books.item add constraint item_service_duration check ((kind = 'service') = (duration_min is not null));

-- A service is sold by the session, and only a service is. The unit check is replaced, as 0008 replaced the run trigger's.
alter table books.item drop constraint item_unit_check;
alter table books.item add constraint item_unit_check check (unit in ('piece', 'pack', 'kg', 'g', 'l', 'ml', 'session'));
alter table books.item add constraint item_service_unit check ((kind = 'service') = (unit = 'session'));

create index item_parent on books.item (tenant_id, parent_item_id);
