-- 0006 · The agent's named read views: names and ids for resolving what a person said, no numbers (numbers reach the
-- agent only through snapshots). Owned by munshi_owner; because every base table forces RLS, the owner is subject to
-- the tenant policy, so each view shows only the rows of the munshi.tenant_id the agent's transaction set.
set local role munshi_owner;

create view agent_view.item as select tenant_id, id, name, unit, category from books.item;
create view agent_view.supplier as select tenant_id, id, name, is_simulated from books.supplier;
create view agent_view.customer as select tenant_id, id, name from books.customer;
create view agent_view.staff as select tenant_id, id, name from books.staff;
create view agent_view.finding as select tenant_id, id, kind, status, snapshot_id from ops.finding;

revoke all on agent_view.item from public, munshi_app, munshi_agent;
grant select on agent_view.item to munshi_agent;

revoke all on agent_view.supplier from public, munshi_app, munshi_agent;
grant select on agent_view.supplier to munshi_agent;

revoke all on agent_view.customer from public, munshi_app, munshi_agent;
grant select on agent_view.customer to munshi_agent;

revoke all on agent_view.staff from public, munshi_app, munshi_agent;
grant select on agent_view.staff to munshi_agent;

revoke all on agent_view.finding from public, munshi_app, munshi_agent;
grant select on agent_view.finding to munshi_agent;
