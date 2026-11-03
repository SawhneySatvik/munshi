// Red-proofs of the agent's views (test/v2/gates/30-agent-views.test.ts).
import type { Case } from './case.ts';
import { asOwner } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/30-agent-views.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const READS = 'the agent reads every view, its own tenant’s rows only, and no base table; it holds SELECT on the views and nothing else, and no other role holds anything on them';
const NUMBERS = 'no view has a numeric column but the finding’s snapshot row index; numbers reach the agent only as cells';
const NAMES = 'a person’s name reaches the agent only on a synthetic or showcase tenant; on a live one it is NULL';

export const AGENT_VIEWS_CASES: Case[] = [
  // the schema's usage and the table's grant together: either alone still refuses
  t(READS, 'v2-views-base-table', 'grant usage on schema books to munshi_agent; grant select on books.item to munshi_agent;'),
  t(READS, 'v2-views-other-role', 'grant select on agent_view.item to munshi_app;'),
  // a view owned by a role that bypasses RLS sees every tenant
  t(READS, 'v2-views-tenant', 'alter view agent_view.shop owner to current_user;'),
  t(NUMBERS, 'v2-views-numeric', asOwner('create or replace view agent_view.shop as select s.id, s.name, s.area, 1::int as rank from ops.shop s;')),
  t(NAMES, 'v2-views-live-name', asOwner(`create or replace view agent_view.customer as
    select x.id, (select c.name from books.party_contact p join ops.contact c on c.tenant_id = p.tenant_id and c.id = p.contact_id
                   where p.tenant_id = x.tenant_id and p.customer_id = x.id order by p.effective_from desc limit 1) as name
      from books.customer x;`)),
];
