// A probe books table and its child, planted as the owner in one test file's clone, because files 00–09 hold no books
// table yet (the first land in BP-DB-2) and the guard, the audit digest, verify_books, TRG1 and J1 must still be proved
// on a real book row. Shaped as every books table is (§2.1): [T][S][R], a_write and z_audit, a ref.book_table row, and
// commands with their authority, tables and capability. Never part of the schema: the manifest does not list them.
import type { TestDb } from '../db.ts';

const BOOK_COLUMNS = `
  reverses_id uuid,
  reason text,
  reason_use text generated always as ('reversal') stored,
  created_by uuid not null,
  decision_id uuid,
  created_txid bigint not null,
  created_at timestamptz not null,
  primary key (tenant_id, id),
  foreign key (tenant_id, created_by) references ops.member,
  foreign key (tenant_id, decision_id) references approval.decision,
  foreign key (reason, reason_use) references ref.reason_use,
  check ((reverses_id is null) = (reason is null))`;

const table = (rel: string) => `
  create trigger a_write before insert or update or delete on ${rel} for each row execute function books.write();
  create trigger z_audit after insert on ${rel} for each row execute function books.audit_row();
  alter table ${rel} enable row level security;
  alter table ${rel} force row level security;
  create policy tenant_isolation on ${rel}
    using (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid))
    with check (tenant_id = (select nullif(current_setting('munshi.tenant_id', true), '')::uuid));
  revoke all on ${rel} from public, munshi_app, munshi_public, munshi_jobs, munshi_agent, munshi_idp, munshi_platform;
  grant select, insert on ${rel} to munshi_app;
  grant select on ${rel} to munshi_jobs;`;

export const PROBE_TABLES = { 'books.probe': ['a_write', 'z_audit'], 'books.probe_line': ['a_write', 'z_audit'] };

export async function plantProbeBooks(db: TestDb): Promise<void> {
  await db.admin.query(`
    set role munshi_owner;
    create table books.probe (
      tenant_id uuid not null references ops.tenant,
      id uuid not null default ops.uuidv7(),
      amount_minor bigint not null,
      currency char(3) not null default 'INR',
      ${BOOK_COLUMNS},
      foreign key (tenant_id, reverses_id) references books.probe
    );
    create unique index probe_reverses on books.probe (tenant_id, reverses_id) where reverses_id is not null;
    ${table('books.probe')}
    create table books.probe_line (
      tenant_id uuid not null references ops.tenant,
      id uuid not null default ops.uuidv7(),
      probe_id uuid not null,
      qty_milli bigint not null,
      ${BOOK_COLUMNS},
      foreign key (tenant_id, probe_id) references books.probe,
      foreign key (tenant_id, reverses_id) references books.probe_line
    );
    create unique index probe_line_reverses on books.probe_line (tenant_id, reverses_id) where reverses_id is not null;
    ${table('books.probe_line')}
    insert into ref.book_table (rel, parent_rel, parent_col, reversible, signed_cols, match_cols) values
      ('books.probe', null, null, true, '{amount_minor}', '{currency}'),
      ('books.probe_line', 'books.probe', 'probe_id', true, '{qty_milli}', '{}');
    insert into ref.command (command, draft_only) values ('probe.record', false), ('probe.reverse', false), ('probe.approve', true)
      on conflict do nothing;
    insert into ref.command_authority (command, role) values
      ('probe.record', 'owner'), ('probe.record', 'manager'), ('probe.record', 'staff'), ('probe.reverse', 'owner'),
      ('probe.approve', 'owner'), ('probe.approve', 'manager') on conflict do nothing;
    insert into ref.command_table (command, rel) values
      ('probe.record', 'books.probe'), ('probe.record', 'books.probe_line'), ('probe.reverse', 'books.probe'),
      ('probe.reverse', 'books.probe_line'), ('probe.approve', 'books.probe');
    insert into ref.command_capability (command, capability, use) values
      ('probe.record', 'counter', 'start'), ('probe.reverse', 'counter', 'finish'), ('probe.approve', 'counter', 'start');
    reset role;`);
}
