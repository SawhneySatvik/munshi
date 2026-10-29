// The book guard (books.write, a_write), the audit digest (books.audit_row, z_audit) and audit.verify_books, proved on the
// probe books tables (test/v2/gates/probe.ts) because files 00–09 hold no books table: G2 (the guard), G3 (command
// totality), G5 (append-only books and the sandbox delete), G11 (a child only in its parent's transaction), TRG1, J1,
// VB1 and VB1-TZ. Red-proofs: test/v2/sabotage/books.ts.
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { mintDisplay, signUp, type Tenant } from './fixture.ts';
import { MANIFEST, privileges, refused } from './lib.ts';
import { PROBE_TABLES, plantProbeBooks } from './probe.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
let sandbox: Tenant;
let app: pg.Pool;

const record = (t: Tenant, actor: string, amount: number, command = 'probe.record') =>
  tx(app, { tenant_id: t.tenant, actor_id: actor, command }, async (c) => {
    const r = await c.query<{ id: string; created_by: string; created_txid: string; txid: string }>(
      `insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at)
       values ($1, $2, $3, 0, '2000-01-01') returning id, created_by, created_txid::text, txid_current()::text as txid`,
      [t.tenant, amount, randomUUID()],
    );
    return r.rows[0] as { id: string; created_by: string; created_txid: string; txid: string };
  });

// A probe.approve draft proposed by `by`, citing a fresh display snapshot.
async function draft(t: Tenant, by: string): Promise<string> {
  const snapshot = await mintDisplay(db, t, by);
  return tx(app, { tenant_id: t.tenant, actor_id: by }, async (c) => {
    const ref = { snapshotId: snapshot, row: 0, col: 'amount' };
    const r = await c.query<{ id: string }>(
      `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid)
       values ($1, 'probe.approve', '{"amount": 100}', $2, 'member', 0) returning id`,
      [t.tenant, JSON.stringify([ref])],
    );
    return r.rows[0]?.id as string;
  });
}

// As the owner role on a dedicated connection, under one tenant's context; the role and settings are reset before the
// connection goes back to the pool.
async function asOwnerIn(t: Tenant, ...sqls: string[]): Promise<pg.QueryResult[]> {
  const c = await db.admin.connect();
  try {
    await c.query('set role munshi_owner');
    await c.query(`select set_config('munshi.tenant_id', $1, false)`, [t.tenant]);
    const out: pg.QueryResult[] = [];
    for (const sql of sqls) out.push(await c.query(sql));
    return out;
  } finally {
    await c.query('reset role; reset all');
    c.release();
  }
}

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeBooks(db);
  app = db.as('munshi_app');
  a = await signUp(db, 'books-alpha');
  b = await signUp(db, 'books-beta');
  sandbox = await signUp(db, 'books-sandbox', { sandbox: true });
  await db.sabotage();
});
afterAll(() => db?.close());

it('G2 a book write with no decision and no direct command is refused', async () => {
  const r = await refused(
    tx(app, { tenant_id: a.tenant, actor_id: a.owner }, (c) =>
      c.query(`insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 1, $2, 0, now())`, [a.tenant, a.owner]),
    ),
  );
  expect(r.code).toBe('MS001');
});

it('G2 a direct command the acting member holds is accepted, stamped whatever the caller sent, and audited with the row digest', async () => {
  const row = await record(a, a.staff, 250);
  expect(row.created_by).toBe(a.staff);
  expect(row.created_txid).toBe(row.txid);
  // The digest is of the row's jsonb text under UTC, the zone books.audit_row pins (VB1-TZ).
  const { rows } = await tx(app, { tenant_id: a.tenant }, async (c) => {
    await c.query(`set local timezone = 'UTC'`);
    return c.query(
      `select a.actor_id, a.command, a.action, a.payload, a.row_digest = sha256(convert_to(to_jsonb(p)::text, 'UTF8')) as digest_ok,
              p.created_at = a.created_at as same_time
         from audit.audit_log a join books.probe p on p.tenant_id = a.tenant_id and p.id = a.entity_id
        where a.entity = 'books.probe' and a.entity_id = $1`,
      [row.id],
    );
  });
  expect(rows).toEqual([{ actor_id: a.staff, command: 'probe.record', action: 'insert', payload: null, digest_ok: true, same_time: true }]);
});

it('G2 a member without the authority, an inactive member, a member of another tenant, and a draft-only command run directly are refused', async () => {
  // staff do not hold probe.reverse; probe.approve is draft-only; b's owner is no member of a.
  expect((await refused(record(a, a.staff, 1, 'probe.reverse'))).code).toBe('MS001');
  expect((await refused(record(a, a.owner, 1, 'probe.approve'))).code).toBe('MS001');
  expect((await refused(record(a, b.owner, 1))).code).toBe('MS001');
  const leaver = randomUUID();
  await tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
    await c.query(`insert into ops.member (tenant_id, id, display_name, role) values ($1, $2, 'Leaver', 'manager')`, [a.tenant, leaver]);
    await c.query(`update ops.member set active = false, deactivated_at = now() where tenant_id = $1 and id = $2`, [a.tenant, leaver]);
  });
  expect((await refused(record(a, leaver, 1))).code).toBe('MS001');
});

it('G2 a row for another tenant is refused, and only munshi_app writes the books', async () => {
  const other = await refused(
    tx(app, { tenant_id: a.tenant, actor_id: a.owner, command: 'probe.record' }, (c) =>
      c.query(`insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 1, $2, 0, now())`, [b.tenant, a.owner]),
    ),
  );
  expect(other.code).toBe('MS001');
  const owner = await refused(
    asOwnerIn(
      a,
      `select set_config('munshi.actor_id', '${a.owner}', false), set_config('munshi.command', 'probe.record', false)`,
      `insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ('${a.tenant}', 1, '${a.owner}', 0, now())`,
    ),
  );
  expect(owner.code).toBe('MS001');
});

it('G2 an approved decision of this transaction, by the acting member, admits its draft-only command for its own tables only', async () => {
  const d = await draft(a, a.manager);
  const decided = await tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
    const dec = await c.query<{ id: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`,
      [a.tenant, d, a.owner],
    );
    const id = dec.rows[0]?.id as string;
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [id]);
    const row = await c.query<{ created_by: string; decision_id: string }>(
      `insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 100, $2, 0, now())
       returning created_by, decision_id`,
      [a.tenant, a.staff],
    );
    // probe.approve does not write books.probe_line
    await c.query('savepoint line');
    const line = await refused(c.query(`insert into books.probe_line (tenant_id, probe_id, qty_milli, created_by, created_txid, created_at)
                                        select $1, id, 1, $2, 0, now() from books.probe where decision_id = $3`, [a.tenant, a.owner, id]));
    await c.query('rollback to savepoint line');
    await c.query(`update approval.draft set status = 'executed' where tenant_id = $1 and id = $2`, [a.tenant, d]);
    return { id, row: row.rows[0], line };
  });
  expect(decided.row).toEqual({ created_by: a.owner, decision_id: decided.id });
  expect(decided.line.code).toBe('MS001');
});

it('G2 a decision from an earlier transaction, a rejected one, or one made by another member than the actor is refused', async () => {
  const insertUnder = (decision: string, actor: string) =>
    tx(app, { tenant_id: a.tenant, actor_id: actor, decision_id: decision }, (c) =>
      c.query(`insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 1, $2, 0, now())`, [a.tenant, actor]),
    );
  const approve = async (verdict: 'approved' | 'rejected') => {
    const d = await draft(a, a.manager);
    return tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, reason, created_txid) values ($1, $2, $3, $4, $5, 0) returning id`,
        [a.tenant, d, verdict, a.owner, verdict === 'rejected' ? 'not_now' : null],
      );
      return r.rows[0]?.id as string;
    });
  };
  const earlier = await approve('approved');
  expect((await refused(insertUnder(earlier, a.owner))).code).toBe('MS001');
  const rejected = await approve('rejected');
  expect((await refused(insertUnder(rejected, a.owner))).code).toBe('MS001');
  // An approved decision of this transaction, but the acting member is not the one who decided it.
  const d = await draft(a, a.manager);
  const r = await refused(
    tx(app, { tenant_id: a.tenant, actor_id: a.owner }, async (c) => {
      const dec = await c.query<{ id: string }>(
        `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0) returning id`,
        [a.tenant, d, a.owner],
      );
      await c.query(`select set_config('munshi.decision_id', $1, true), set_config('munshi.actor_id', $2, true)`, [dec.rows[0]?.id, a.manager]);
      await c.query(`insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 1, $2, 0, now())`, [a.tenant, a.owner]);
    }),
  );
  expect(r.code).toBe('MS001');
});

it('G2 context does not survive the transaction on a pooled connection', async () => {
  // One connection, so the second transaction runs on the backend the first one used.
  const one = new pg.Pool({ host: '127.0.0.1', port: inject('pg17Port'), database: db.name, user: 'munshi_app', password: 'munshi_app', max: 1 });
  try {
    await tx(one, { tenant_id: a.tenant, actor_id: a.owner, command: 'probe.record' }, (c) => c.query('select 1'));
    const after = await one.query(`select current_setting('munshi.command', true) as c, current_setting('munshi.actor_id', true) as a`);
    expect(after.rows[0]).toEqual({ c: '', a: '' });
    const r = await refused(
      one.query(`insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 1, $2, 0, now())`, [a.tenant, a.owner]),
    );
    expect(r.code).toBe('MS001');
  } finally {
    await one.end();
  }
});

it('G2 a reversal is the exact opposite of an unreversed original, once, and its children reverse the original children under the reversal header', async () => {
  const ctx = { tenant_id: a.tenant, actor_id: a.owner };
  const original = await tx(app, { ...ctx, command: 'probe.record' }, async (c) => {
    const h = await c.query<{ id: string }>(
      `insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 500, $2, 0, now()) returning id`,
      [a.tenant, a.owner],
    );
    const l = await c.query<{ id: string }>(
      `insert into books.probe_line (tenant_id, probe_id, qty_milli, created_by, created_txid, created_at) values ($1, $2, 2000, $3, 0, now()) returning id`,
      [a.tenant, h.rows[0]?.id, a.owner],
    );
    return { header: h.rows[0]?.id as string, line: l.rows[0]?.id as string };
  });
  const reverse = (amount: number, reason: string, qty?: number, lineOf?: string) =>
    tx(app, { ...ctx, command: 'probe.reverse' }, async (c) => {
      const h = await c.query<{ id: string }>(
        `insert into books.probe (tenant_id, amount_minor, reverses_id, reason, created_by, created_txid, created_at)
         values ($1, $2, $3, $4, $5, 0, now()) returning id`,
        [a.tenant, amount, original.header, reason, a.owner],
      );
      if (qty !== undefined) {
        await c.query(
          `insert into books.probe_line (tenant_id, probe_id, qty_milli, reverses_id, reason, created_by, created_txid, created_at)
           values ($1, $2, $3, $4, 'wrong_figure', $5, 0, now())`,
          [a.tenant, h.rows[0]?.id, qty, lineOf ?? original.line, a.owner],
        );
      }
    });
  expect((await refused(reverse(-499, 'wrong_figure'))).code).toBe('MS013'); // not the exact negation
  expect((await refused(reverse(-500, 'not_now'))).code).toBe('23503'); // a code not allowed for the use `reversal`
  expect((await refused(reverse(-500, 'wrong_figure', -1999))).code).toBe('MS013'); // a child not the exact negation
  // A fresh line under a reversal header is refused: every child there reverses a child of the original.
  const fresh = await refused(
    tx(app, { ...ctx, command: 'probe.reverse' }, async (c) => {
      const h = await c.query<{ id: string }>(
        `insert into books.probe (tenant_id, amount_minor, reverses_id, reason, created_by, created_txid, created_at)
         values ($1, -500, $2, 'wrong_figure', $3, 0, now()) returning id`,
        [a.tenant, original.header, a.owner],
      );
      await c.query(`insert into books.probe_line (tenant_id, probe_id, qty_milli, created_by, created_txid, created_at) values ($1, $2, 7, $3, 0, now())`, [
        a.tenant,
        h.rows[0]?.id,
        a.owner,
      ]);
    }),
  );
  expect(fresh.code).toBe('MS013');
  await reverse(-500, 'wrong_figure', -2000);
  expect((await refused(reverse(-500, 'wrong_figure'))).code).toBe('MS013'); // a second reversal
  const twice = await refused(
    tx(app, { ...ctx, command: 'probe.reverse' }, async (c) => {
      const rev = await c.query<{ id: string }>(`select id from books.probe where tenant_id = $1 and reverses_id = $2`, [a.tenant, original.header]);
      await c.query(
        `insert into books.probe (tenant_id, amount_minor, reverses_id, reason, created_by, created_txid, created_at) values ($1, 500, $2, 'other', $3, 0, now())`,
        [a.tenant, rev.rows[0]?.id, a.owner],
      );
    }),
  );
  expect(twice.code).toBe('MS013'); // a reversal is never reversed
});

it('G11 a child book row is accepted only in its parent transaction', async () => {
  const header = await record(a, a.owner, 10);
  const r = await refused(
    tx(app, { tenant_id: a.tenant, actor_id: a.owner, command: 'probe.record' }, (c) =>
      c.query(`insert into books.probe_line (tenant_id, probe_id, qty_milli, created_by, created_txid, created_at) values ($1, $2, 1, $3, 0, now())`, [
        a.tenant,
        header.id,
        a.owner,
      ]),
    ),
  );
  expect(r.code).toBe('MS006');
});

it('G5 an UPDATE or DELETE of a book row is refused, even as the owner; the one delete is the sandbox reset, as the owner, on a sandbox, off live', async () => {
  const row = await record(a, a.owner, 20);
  // Refused by the append-only branch itself, not only by the app-only rule that would also stop the owner.
  for (const sql of [`update books.probe set amount_minor = 21 where id = '${row.id}'`, `delete from books.probe where id = '${row.id}'`]) {
    const r = await refused(asOwnerIn(a, sql));
    expect(r.code, sql).toBe('MS001');
    expect(r.message, sql).toMatch(/is append-only/);
  }
  for (const sql of [`update books.probe set amount_minor = 21`, `delete from books.probe`]) {
    expect((await refused(tx(app, { tenant_id: a.tenant, actor_id: a.owner, command: 'probe.record' }, (c) => c.query(sql)))).code).toBe('42501');
  }
  const sandboxRow = await record(sandbox, sandbox.owner, 30);
  const [deleted] = await asOwnerIn(sandbox, `delete from books.probe where id = '${sandboxRow.id}'`);
  expect(deleted?.rowCount).toBe(1);
});

it('G3 every command held writes a books table and every books table is written by a command; no runtime role changes ref', async () => {
  const { rows } = await db.admin.query<{ orphan: string }>(
    `select 'command ' || c.command as orphan from ref.command c
      where not exists (select 1 from ref.command_table t where t.command = c.command)
         or not exists (select 1 from ref.command_authority x where x.command = c.command)
     union all
     select 'table ' || b.rel from ref.book_table b where not exists (select 1 from ref.command_table t where t.rel = b.rel)`,
  );
  const commands = (await db.admin.query('select count(*)::int as n from ref.command')).rows[0].n;
  console.log(`G3 ${commands} commands over ${Object.keys(MANIFEST.bookTables).length} manifest books tables and ${Object.keys(PROBE_TABLES).length} probes`);
  expect(commands).toBeGreaterThan(0);
  expect(rows).toEqual([]);
  for (const sql of [
    `insert into ref.command_authority (command, role) values ('probe.reverse', 'staff')`,
    `insert into ref.command_table (command, rel) values ('probe.approve', 'books.probe_line')`,
    `delete from ref.command_authority`,
  ]) {
    expect((await refused(tx(app, { tenant_id: a.tenant }, (c) => c.query(sql)))).code, sql).toBe('42501');
  }
});

it('TRG1 every books table has exactly its declared triggers, in a_, b_, z_ order, and its b_ rules are its ref.book_table rules', async () => {
  const declared: Record<string, string[]> = { ...MANIFEST.bookTables, ...PROBE_TABLES };
  const { rows } = await db.admin.query<{ rel: string; triggers: string[]; rules: string[] | null }>(
    `select n.nspname || '.' || c.relname as rel,
            coalesce(array_agg(t.tgname::text order by t.tgname) filter (where t.tgname is not null), '{}') as triggers,
            (select b.rules from ref.book_table b where b.rel = n.nspname || '.' || c.relname) as rules
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       left join pg_trigger t on t.tgrelid = c.oid and not t.tgisinternal
      where n.nspname = 'books' and c.relkind in ('r', 'p') group by 1, 3 order by 1`,
  );
  console.log(`TRG1 ${rows.length} books tables (${Object.keys(MANIFEST.bookTables).length} from the manifest, ${Object.keys(PROBE_TABLES).length} probes)`);
  expect(rows.map((r) => r.rel)).toEqual(Object.keys(declared).sort());
  for (const r of rows) {
    expect(r.triggers, r.rel).toEqual([...(declared[r.rel] as string[])].sort());
    expect(r.triggers[0], r.rel).toBe('a_write');
    expect(r.triggers.filter((t) => !/^(a_write|b_[a-z_]+|z_[a-z_]+)$/.test(t)), r.rel).toEqual([]);
    expect(r.triggers.filter((t) => t.startsWith('b_')), r.rel).toEqual([...(r.rules ?? [])].sort());
  }
});

it('J1 the jobs role holds no INSERT on any books table, and every insert it attempts is refused', async () => {
  const books = Object.keys({ ...MANIFEST.bookTables, ...PROBE_TABLES });
  const catalog = (
    await db.admin.query<{ rel: string }>(
      `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'books' and c.relkind in ('r', 'p') order by 1`,
    )
  ).rows.map((r) => r.rel);
  expect(catalog).toEqual([...books].sort());
  const jobs = db.as('munshi_jobs');
  for (const rel of books) {
    expect((await privileges(db.admin, 'munshi_jobs', rel)).filter((p) => !p.startsWith('SELECT')), rel).toEqual([]);
    const r = await refused(tx(jobs, { tenant_id: a.tenant, actor_id: a.owner, command: 'probe.record' }, (c) => c.query(`insert into ${rel} default values`)));
    expect(['42501', 'MS001'], `${rel}: ${r.message}`).toContain(r.code);
  }
  console.log(`J1 ${books.length} books tables refuse the jobs role`);
  expect(books.length).toBeGreaterThan(0);
});

it('VB1 verify_books finds a row edited with triggers disabled, a deleted row and a row with no entry, and nothing in a clean table', async () => {
  const rows = [await record(b, b.owner, 1), await record(b, b.owner, 2), await record(b, b.owner, 3), await record(b, b.owner, 4)];
  const verify = () =>
    tx(app, { tenant_id: b.tenant }, (c) =>
      c.query<{ rel: string; id: string; problem: string }>(
        `select * from audit.verify_books($1, 'books.probe', '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff') order by problem`,
        [b.tenant],
      ),
    );
  expect((await verify()).rows).toEqual([]);
  // The owner disables the triggers and tampers: edits one row, deletes another, and writes one with no entry.
  await asOwnerIn(
    b,
    'alter table books.probe disable trigger user',
    `update books.probe set amount_minor = 999 where id = '${rows[0]?.id}'`,
    `delete from books.probe where id = '${rows[1]?.id}'`,
    `insert into books.probe (tenant_id, id, amount_minor, created_by, created_txid, created_at) values ('${b.tenant}', '${randomUUID()}', 5, '${b.owner}', 1, now())`,
    'alter table books.probe enable trigger user',
  );
  const found = (await verify()).rows.map((r) => `${r.problem}:${r.id === rows[0]?.id ? 'edited' : r.id === rows[1]?.id ? 'deleted' : 'new'}`);
  expect(found.sort()).toEqual(['digest_mismatch:edited', 'no_entry:new', 'no_row:deleted']);
  const other = await refused(tx(app, { tenant_id: b.tenant }, (c) => c.query(`select * from audit.verify_books($1, 'books.probe', null, null)`, [a.tenant])));
  expect(other.code).toBe('MS003');
  const notBooks = await refused(tx(app, { tenant_id: b.tenant }, (c) => c.query(`select * from audit.verify_books($1, 'ops.member', null, null)`, [b.tenant])));
  expect(notBooks.code).toBe('MS003');
});

it('VB1-TZ digests written under one session zone verify under another (UTC, New York, Kolkata)', async () => {
  const c = await app.connect();
  let id: string;
  try {
    await c.query(`set timezone = 'America/New_York'`);
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true), set_config('munshi.actor_id', $2, true), set_config('munshi.command', 'probe.record', true)`, [
      a.tenant,
      a.owner,
    ]);
    id = (
      await c.query<{ id: string }>(
        `insert into books.probe (tenant_id, amount_minor, created_by, created_txid, created_at) values ($1, 7, $2, 0, now()) returning id`,
        [a.tenant, a.owner],
      )
    ).rows[0]?.id as string;
    await c.query('commit');
    await c.query(`set timezone = 'Asia/Kolkata'`);
    await c.query('begin');
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [a.tenant]);
    const { rows } = await c.query(`select * from audit.verify_books($1, 'books.probe', $2, $2)`, [a.tenant, id]);
    await c.query('commit');
    expect(rows).toEqual([]);
  } finally {
    await c.query('reset timezone');
    c.release();
  }
});
