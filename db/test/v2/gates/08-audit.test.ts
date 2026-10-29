// 08_approval_audit.sql with audit.chain (02): G7 (the per-tenant chain, its verifier, its checkpoints, what an entry
// may hold) and C4's database part (a decision is the approver's, a transaction after the proposal; a draft leaves
// `proposed` once, as its decision or edit says; it cites 1 to 50 refs and pins them). Red-proofs:
// test/v2/sabotage/audit.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { COLUMNS, mintDisplay, plantProbeCommand, rowsOf, signUp, type Tenant } from './fixture.ts';
import { refused } from './lib.ts';

let db: TestDb;
let t: Tenant;
let app: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  app = db.as('munshi_app');
  t = await signUp(db, 'audit-shop');
  await db.sabotage();
});
afterAll(() => db?.close());

const as = (actor: string, x: Tenant = t) => ({ tenant_id: x.tenant, actor_id: actor });
const verify = (x: Tenant, full = true) =>
  tx(app, { tenant_id: x.tenant }, async (c) => (await c.query<{ broken: string | null }>('select audit.verify_chain($1, $2) as broken', [x.tenant, full])).rows[0]?.broken);
const entry = (x: Tenant, payload: unknown, extra: Record<string, unknown> = {}) =>
  tx(app, as(x.owner, x), (c) =>
    c.query<{ seq: string; hash: Buffer; prev_hash: Buffer | null; created_at: Date }>(
      `insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, payload, seq, hash, created_at)
       values ($1, $2, 'note.add', 'ops.member', $1, $3, $4, $5, $6) returning seq, hash, prev_hash, created_at`,
      [x.tenant, extra.actor ?? x.owner, JSON.stringify(payload), extra.seq ?? 999, extra.hash ?? Buffer.alloc(32), extra.created_at ?? new Date(0)],
    ),
  );

it('G7 the chain verifies, then finds an edited entry and a deleted one at their seq', async () => {
  const edited = await signUp(db, 'audit-edited');
  const deleted = await signUp(db, 'audit-deleted');
  for (const x of [edited, deleted]) for (let i = 0; i < 3; i++) await entry(x, { n: `step_${i}` });
  expect(await verify(edited)).toBeNull();
  expect(await verify(deleted)).toBeNull();
  const count = (await db.admin.query(`select count(*)::int as n from audit.audit_log where tenant_id = $1`, [edited.tenant])).rows[0].n;
  expect(count).toBeGreaterThan(5);
  await db.admin.query(`update audit.audit_log set payload = '{"n": "forged"}' where tenant_id = $1 and seq = 4`, [edited.tenant]);
  expect(await verify(edited)).toBe('4');
  await db.admin.query(`delete from audit.audit_log where tenant_id = $1 and seq = 3`, [deleted.tenant]);
  expect(await verify(deleted)).toBe('3');
  expect((await refused(tx(app, { tenant_id: t.tenant }, (c) => c.query('select audit.verify_chain($1)', [edited.tenant])))).code).toBe('MS003');
});

it('G7 seq, prev_hash, hash and created_at are set by the chain, whatever the caller sent', async () => {
  const before = (await db.admin.query(`select max(seq) as seq, (array_agg(hash order by seq desc))[1] as hash from audit.audit_log where tenant_id = $1`, [t.tenant])).rows[0];
  const r = (await entry(t, { n: 'stamped' })).rows[0];
  expect(r?.seq).toBe(String(Number(before.seq) + 1));
  expect(r?.prev_hash?.equals(before.hash)).toBe(true);
  expect(r?.hash.equals(Buffer.alloc(32))).toBe(false);
  expect(r?.created_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
  expect(await verify(t)).toBeNull();
});

it('G7 an entry names the acting member; a book entry needs its row; an ops payload holds ids, codes and flags only', async () => {
  expect((await refused(entry(t, { n: 'x' }, { actor: t.manager }))).code).toBe('MS005');
  const book = await refused(
    tx(app, as(t.owner), (c) =>
      c.query(`insert into audit.audit_log (tenant_id, actor_id, action, entity, entity_id, row_digest) values ($1, $2, 'insert', 'books.sale', $3, $4)`, [
        t.tenant,
        t.owner,
        randomUUID(),
        Buffer.alloc(32),
      ]),
    ),
  );
  expect(book.code).toBe('MS005');
  for (const payload of [{ total: 4500 }, { name: 'Asha Verma' }, { phone: '+919811000001' }, { note: null }]) {
    expect((await refused(entry(t, payload))).code, JSON.stringify(payload)).toBe('23514');
  }
  await entry(t, { member_id: t.staff, role: 'staff', is_on: true });
});

it('G7 a checkpoint names an entry’s own hash, past the last one; verification then walks only the tail, and a forged checkpoint is found', async () => {
  const x = await signUp(db, 'audit-checkpoint');
  for (let i = 0; i < 3; i++) await entry(x, { n: `before_${i}` });
  const head = (await db.admin.query<{ seq: string; hash: Buffer }>(`select seq, hash from audit.audit_log where tenant_id = $1 order by seq desc limit 1`, [x.tenant])).rows[0];
  const checkpoint = (seq: string | undefined, hash: Buffer | undefined) =>
    tx(db.as('munshi_jobs'), { tenant_id: x.tenant }, (c) => c.query('insert into audit.checkpoint (tenant_id, seq, hash) values ($1, $2, $3)', [x.tenant, seq, hash]));
  expect((await refused(checkpoint(head?.seq, Buffer.alloc(32)))).code).toBe('MS005');
  expect((await refused(tx(app, { tenant_id: x.tenant }, (c) => c.query('insert into audit.checkpoint (tenant_id, seq, hash) values ($1, $2, $3)', [x.tenant, head?.seq, head?.hash])))).code).toBe('42501');
  await checkpoint(head?.seq, head?.hash);
  expect((await refused(checkpoint(head?.seq, head?.hash))).code).toBe('MS005'); // not past the last
  await entry(x, { n: 'after' });
  // An edit before the checkpoint is outside the tail; the full walk finds it.
  await db.admin.query(`update audit.audit_log set payload = '{"n": "forged"}' where tenant_id = $1 and seq = 2`, [x.tenant]);
  expect(await verify(x, false)).toBeNull();
  expect(await verify(x, true)).toBe('2');
  await db.admin.query(`update audit.checkpoint set hash = $2 where tenant_id = $1`, [x.tenant, Buffer.alloc(32, 1)]);
  expect(await verify(x, false)).toBe(head?.seq);
});

const snapshotRef = async () => ({ snapshotId: await mintDisplay(db, t, t.owner), row: 0, col: 'amount' });
const propose = async (by: string, extra: { basedOn?: unknown; payloadRefs?: unknown; supersedes?: string; finding?: string } = {}) =>
  tx(app, as(by), async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, supersedes_id, finding_id, created_txid)
       values ($1, 'probe.approve', '{}', $2, $3, 'member', $4, $5, 0) returning id`,
      [t.tenant, JSON.stringify(extra.basedOn ?? [await snapshotRef()]), JSON.stringify(extra.payloadRefs ?? {}), extra.supersedes ?? null, extra.finding ?? null],
    );
    return r.rows[0]?.id as string;
  });
const decide = (by: string, draft: string, verdict: string, reason: string | null = null) =>
  tx(app, as(by), (c) =>
    c.query<{ decided_by: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, reason, created_txid) values ($1, $2, $3, $4, $5, 0) returning decided_by`,
      [t.tenant, draft, verdict, t.staff, reason],
    ),
  );

it('C4 a decision is the acting member’s, who may approve the command, a transaction after the proposal; one per draft; a rejection carries a decision code', async () => {
  const sameTx = await refused(
    tx(app, as(t.owner), async (c) => {
      const d = await c.query<{ id: string }>(
        `insert into approval.draft (tenant_id, command, payload, based_on, source, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', 0) returning id`,
        [t.tenant, JSON.stringify([await snapshotRef()])],
      );
      await c.query(`insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid) values ($1, $2, 'approved', $3, 0)`, [t.tenant, d.rows[0]?.id, t.owner]);
    }),
  );
  expect(sameTx.code).toBe('MS002');
  const d = await propose(t.manager);
  expect((await refused(decide(t.staff, d, 'approved'))).code).toBe('MS002'); // staff may not approve probe.approve
  expect((await refused(decide(t.owner, d, 'rejected'))).code).toBe('23514'); // a rejection needs a reason
  expect((await refused(decide(t.owner, d, 'rejected', 'already_handled'))).code).toBe('23503'); // a dismiss code, not a decision code
  const ok = await decide(t.owner, d, 'rejected', 'not_now');
  expect(ok.rows[0]?.decided_by).toBe(t.owner); // stamped from the actor, whatever was sent
  expect((await refused(decide(t.manager, d, 'approved'))).code).toBe('23505');
});

it('C4 a draft leaves proposed once, as its decision or edit says, moved by a member who may approve it', async () => {
  const status = (by: string, draft: string, s: string) =>
    tx(app, as(by), (c) => c.query(`update approval.draft set status = $3 where tenant_id = $1 and id = $2`, [t.tenant, draft, s]));
  const d = await propose(t.manager);
  expect((await refused(status(t.owner, d, 'executed'))).code).toBe('MS002'); // no approved decision of this transaction
  expect((await refused(status(t.owner, d, 'rejected'))).code).toBe('MS002');
  expect((await refused(status(t.staff, d, 'stale'))).code).toBe('MS002'); // staff may not approve it
  await status(t.owner, d, 'stale');
  expect((await refused(status(t.owner, d, 'failed'))).code).toBe('MS002'); // final
  const old = await propose(t.manager);
  expect((await refused(status(t.owner, old, 'superseded'))).code).toBe('MS002'); // no edit made in this transaction
  await tx(app, as(t.owner), async (c) => {
    await c.query(
      `insert into approval.draft (tenant_id, command, payload, based_on, source, supersedes_id, created_txid) values ($1, 'probe.approve', '{}', $2, 'member', $3, 0)`,
      [t.tenant, JSON.stringify([await snapshotRef()]), old],
    );
    await c.query(`update approval.draft set status = 'superseded' where tenant_id = $1 and id = $2`, [t.tenant, old]);
  });
  expect((await db.admin.query(`select status from approval.draft where id = $1`, [old])).rows).toEqual([{ status: 'superseded' }]);
});

it('C4 a draft cites 1 to 50 refs of known shape, pins every snapshot it cites, and a draft for a finding writes its drafted event, one open per finding', async () => {
  const ref = await snapshotRef();
  for (const basedOn of [[], Array.from({ length: 51 }, () => ref), [{ ...ref, label: 'Tea' }], [{ ...ref, row: '0' }]]) {
    expect((await refused(propose(t.manager, { basedOn }))).code, JSON.stringify(basedOn).slice(0, 60)).toBe('MS002');
  }
  expect((await refused(propose(t.manager, { basedOn: [{ ...ref, snapshotId: randomUUID() }] }))).code).toBe('23503');
  const cited = await snapshotRef();
  const d = await propose(t.manager, { basedOn: [ref], payloadRefs: { amount: cited } });
  const pinned = (await db.admin.query<{ s: string }>(`select snapshot_id as s from snap.pin where holder = 'draft' and holder_id = $1 order by 1`, [d])).rows.map((r) => r.s);
  expect(pinned).toEqual([ref.snapshotId, cited.snapshotId].sort());
  const run = (await tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) => c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'watcher', 'stock') returning id`, [t.tenant])))
    .rows[0]?.id as string;
  const watch = (
    await tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) =>
      c.query<{ id: string }>(
        `insert into snap.snapshot (tenant_id, query_name, params, purpose, columns, rows, params_sha256, rows_sha256, row_count)
         values ($1, 'watch.shrinkage', '{}', 'watch', $2, $3, '\\x00', '\\x00', 0) returning id`,
        [t.tenant, JSON.stringify(COLUMNS), JSON.stringify(rowsOf('900'))],
      ),
    )
  ).rows[0]?.id as string;
  const finding = (
    await tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) =>
      c.query<{ id: string }>(
        `insert into ai.finding (tenant_id, desk, kind, dedupe_key, severity, snapshot_id, snapshot_row, row_sha256, impact_col, first_run_id, last_run_id)
         values ($1, 'stock', 'shrinkage', 'draft:one', 'low', $2, 0, '\\x00', 'amount', $3, $3) returning id`,
        [t.tenant, watch, run],
      ),
    )
  ).rows[0]?.id as string;
  await propose(t.manager, { finding });
  expect((await refused(propose(t.manager, { finding }))).code).toBe('23505');
  const ev = (await db.admin.query(`select kind, member_id from ai.finding_event where finding_id = $1 order by at`, [finding])).rows;
  expect(ev).toEqual([
    { kind: 'raised', member_id: null },
    { kind: 'drafted', member_id: t.manager },
  ]);
});
