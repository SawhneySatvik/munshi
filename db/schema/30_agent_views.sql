-- 30 · The agent's views: names and ids, never a business number (numbers reach the agent only
-- as snapshot cells). Owned by munshi_owner, so they read the base tables with its rights; every base table forces RLS,
-- so each view sees the current tenant only. munshi_agent holds SELECT on these and on snap.snapshot, nothing else.
-- A person's name comes from their current contact only on a synthetic or showcase tenant, NULL on a live one, so no
-- real name reaches a model through the agent. finding.snapshot_row is a row index into a snapshot, not a figure.
-- No column here names a table of a later file.
set local role munshi_owner;

create view agent_view.item as
select i.id, i.kind, i.unit, r.name, r.category, r.sellable
  from books.item i
  left join lateral (select x.name, x.category, x.sellable from books.item_revision x
                      where x.tenant_id = i.tenant_id and x.item_id = i.id and x.effective_from <= now()
                      order by x.effective_from desc, x.created_at desc, x.id desc limit 1) r on true;

create view agent_view.shop as
select s.id, s.name, s.area from ops.shop s;

create view agent_view.customer as
select x.id, (select c.name from books.party_contact p join ops.contact c on c.tenant_id = p.tenant_id and c.id = p.contact_id
               where p.tenant_id = x.tenant_id and p.customer_id = x.id and p.effective_from <= now()
                 and (select t.data_class from ops.tenant t where t.tenant_id = x.tenant_id) <> 'live'
               order by p.effective_from desc, p.created_at desc, p.id desc limit 1) as name
  from books.customer x;

create view agent_view.supplier as
select x.id, x.is_simulated,
       (select c.name from books.party_contact p join ops.contact c on c.tenant_id = p.tenant_id and c.id = p.contact_id
         where p.tenant_id = x.tenant_id and p.supplier_id = x.id and p.effective_from <= now()
           and (select t.data_class from ops.tenant t where t.tenant_id = x.tenant_id) <> 'live'
         order by p.effective_from desc, p.created_at desc, p.id desc limit 1) as name
  from books.supplier x;

create view agent_view.staff as
select x.id, (select c.name from books.party_contact p join ops.contact c on c.tenant_id = p.tenant_id and c.id = p.contact_id
               where p.tenant_id = x.tenant_id and p.staff_id = x.id and p.effective_from <= now()
                 and (select t.data_class from ops.tenant t where t.tenant_id = x.tenant_id) <> 'live'
               order by p.effective_from desc, p.created_at desc, p.id desc limit 1) as name
  from books.staff x;

create view agent_view.finding as
select f.id, f.desk, f.kind, f.status, f.severity, f.snapshot_id, f.snapshot_row, f.impact_col from ai.finding f;

-- The grants: SELECT for the agent alone.
revoke all on agent_view.item, agent_view.shop, agent_view.customer, agent_view.supplier, agent_view.staff, agent_view.finding
  from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
grant select on agent_view.item, agent_view.shop, agent_view.customer, agent_view.supplier, agent_view.staff, agent_view.finding
  to munshi_agent;
