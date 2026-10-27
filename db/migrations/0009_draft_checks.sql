-- 0009 · Fix cycle 1 of MS-8 (the fa53b7d review): the open-draft index moves here from 0007, which was edited after it
-- was applied (0001–0008 are never edited again), and how old a shelf count may be and still back a draft.
set local role munshi_owner;

-- One open draft per finding: a second proposal for the same finding while the first awaits a decision is a conflict.
create unique index draft_open_per_finding on approval.draft (tenant_id, finding_id) where status = 'proposed';

-- A shelf count older than this cannot back a stock.count draft, at proposal or at approval (approvals.ts): the shelf
-- has moved on since the photo. Per shop; the app creates a tenant with the default and has no UPDATE on ops.tenant.
alter table ops.tenant add column count_max_age interval not null default interval '6 hours'
  check (count_max_age > interval '0' and count_max_age <= interval '7 days');
