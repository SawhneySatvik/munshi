// G2: the book guard admits a write under a decision only if that decision is approved, of this tenant, made in this
// transaction, by a member allowed to approve it; with neither a decision nor a direct command it refuses every table.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BOOK_TABLES, openTestDb, refused, setCtx, type TestDb, tx } from './db.ts';
import { proposeDraft, seedTenant, type Tenant } from './fixture.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
beforeAll(async () => {
  db = await openTestDb();
  a = await seedTenant(db.app, 'A');
  b = await seedTenant(db.app, 'B');
  await db.sabotage();
});
afterAll(() => db.close());

const writePrice = (c: pg.PoolClient, t: Tenant, extra = '') =>
  c.query(
    `insert into books.price (tenant_id, item_id, amount_minor, currency, effective_from${extra ? ', created_by' : ''})
     values ($1, $2, 1200, 'INR', now()${extra ? ', $3' : ''}) returning id, created_by, decision_id`,
    extra ? [t.tenant, t.item, extra] : [t.tenant, t.item],
  );

const decide = async (c: pg.PoolClient, t: Tenant, draft: string, verdict: 'approved' | 'rejected', by: string) => {
  const id = randomUUID();
  await c.query('insert into approval.decision (tenant_id, id, draft_id, verdict, decided_by) values ($1, $2, $3, $4, $5)', [
    t.tenant,
    id,
    draft,
    verdict,
    by,
  ]);
  return id;
};

const GUARD = { code: 'MS001', message: expect.stringMatching(/^book write refused/) };

it('G2 every book table refuses a write with no decision and no command', async () => {
  const refusals: string[] = [];
  for (const table of BOOK_TABLES) {
    const r = await refused(tx(db.app, { tenant: a.tenant }, (c) => c.query(`insert into ${table} (tenant_id) values ($1)`, [a.tenant])));
    expect(r, table).toEqual({ code: 'MS001', message: 'book write refused: no approved decision and no direct command' });
    refusals.push(table);
  }
  console.log(`G2 refused a context-free write on ${refusals.length} of ${BOOK_TABLES.length} book tables`);
  expect(BOOK_TABLES.length).toBeGreaterThan(0);
  expect(refusals.length).toBe(BOOK_TABLES.length);
});

it('G2 a decision of another tenant is refused', async () => {
  const draftB = await proposeDraft(db.app, b);
  const r = await refused(
    tx(db.app, { tenant: b.tenant, actor: b.owner }, async (c) => {
      const decisionB = await decide(c, b, draftB, 'approved', b.owner);
      await setCtx(c, { tenant: a.tenant, actor: a.owner, decision: decisionB });
      await writePrice(c, a);
    }),
  );
  expect(r).toEqual(GUARD);
});

it('G2 a decision from an earlier transaction is refused', async () => {
  const draft = await proposeDraft(db.app, a);
  const decision = await tx(db.app, { tenant: a.tenant, actor: a.owner }, (c) => decide(c, a, draft, 'approved', a.owner));
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: a.owner, decision }, (c) => writePrice(c, a)));
  expect(r).toEqual(GUARD);
});

it('G2 a rejected decision is refused', async () => {
  const draft = await proposeDraft(db.app, a);
  const r = await refused(
    tx(db.app, { tenant: a.tenant, actor: a.owner }, async (c) => {
      await setCtx(c, { decision: await decide(c, a, draft, 'rejected', a.owner) });
      await writePrice(c, a);
    }),
  );
  expect(r).toEqual(GUARD);
});

it('G2 a decision by a member whose role cannot run the command is refused', async () => {
  const draft = await proposeDraft(db.app, a, 'price.set'); // staff do not hold price.set
  const r = await refused(
    tx(db.app, { tenant: a.tenant, actor: a.staffMember }, async (c) => {
      await setCtx(c, { decision: await decide(c, a, draft, 'approved', a.staffMember) });
      await writePrice(c, a);
    }),
  );
  expect(r).toEqual(GUARD);
});

it('G2 a decision must be made by the acting member', async () => {
  const draft = await proposeDraft(db.app, a);
  const r = await refused(tx(db.app, { tenant: a.tenant, actor: a.staffMember }, (c) => decide(c, a, draft, 'approved', a.owner)));
  expect(r).toEqual({ code: 'MS002', message: 'decision refused: decided_by is not the acting member' });
});

it('G2 an approved decision made in this transaction is accepted, stamped and audited', async () => {
  const draft = await proposeDraft(db.app, a);
  const { row, decision, audit } = await tx(db.app, { tenant: a.tenant, actor: a.owner }, async (c) => {
    const decision = await decide(c, a, draft, 'approved', a.owner);
    await setCtx(c, { decision });
    const row = (await writePrice(c, a, a.staffMember)).rows[0]; // a caller-supplied created_by is overwritten
    const audit = await c.query(
      `select actor_id, decision_id, command, entity from audit.audit_log where tenant_id = $1 and entity_id = $2`,
      [a.tenant, row.id],
    );
    return { row, decision, audit: audit.rows };
  });
  expect(row.created_by).toBe(a.owner);
  expect(row.decision_id).toBe(decision);
  expect(audit).toEqual([{ actor_id: a.owner, decision_id: decision, command: 'price.set', entity: 'books.price' }]);
});

it('G2 an approved price.set decision cannot write books.sale', async () => {
  const draft = await proposeDraft(db.app, a, 'price.set');
  const r = await refused(
    tx(db.app, { tenant: a.tenant, actor: a.owner }, async (c) => {
      await setCtx(c, { decision: await decide(c, a, draft, 'approved', a.owner) });
      await c.query(`insert into books.sale (tenant_id, shop_id, sold_at, total_minor, currency) values ($1, $2, now(), 1000, 'INR')`, [
        a.tenant,
        a.shop,
      ]);
    }),
  );
  expect(r).toEqual({ code: 'MS001', message: 'book write refused: price.set does not write books.sale' });
});

const setStatus = (c: pg.PoolClient, t: Tenant, draft: string, status: string) =>
  c.query('update approval.draft set status = $3, updated_at = now() where tenant_id = $1 and id = $2', [t.tenant, draft, status]);
const statusOf = async (t: Tenant, draft: string) =>
  (await db.admin.query('select status from approval.draft where tenant_id = $1 and id = $2', [t.tenant, draft])).rows[0].status;
const asOwnerA = (fn: (c: pg.PoolClient) => Promise<unknown>) => tx(db.app, { tenant: a.tenant, actor: a.owner }, fn);
const DRAFT = (message: string) => ({ code: 'MS002', message });

it('G2 a draft is marked executed only under an approved decision made in this transaction', async () => {
  const EXECUTED = DRAFT('draft refused: executed needs an approved decision made in this transaction');
  const undecided = await proposeDraft(db.app, a);
  expect(await refused(asOwnerA((c) => setStatus(c, a, undecided, 'executed')))).toEqual(EXECUTED);
  const rejected = await proposeDraft(db.app, a);
  const underRejected = asOwnerA(async (c) => {
    await decide(c, a, rejected, 'rejected', a.owner);
    await setStatus(c, a, rejected, 'executed');
  });
  expect(await refused(underRejected)).toEqual(EXECUTED);
  const earlier = await proposeDraft(db.app, a);
  await asOwnerA((c) => decide(c, a, earlier, 'approved', a.owner));
  expect(await refused(asOwnerA((c) => setStatus(c, a, earlier, 'executed')))).toEqual(EXECUTED);
  const now = await proposeDraft(db.app, a);
  await asOwnerA(async (c) => {
    await decide(c, a, now, 'approved', a.owner);
    await setStatus(c, a, now, 'executed');
  });
  expect(await statusOf(a, now)).toBe('executed');
});

it('G2 a draft is marked rejected only under a rejected decision', async () => {
  const REJECTED = DRAFT('draft refused: rejected needs a rejected decision');
  const undecided = await proposeDraft(db.app, a);
  expect(await refused(asOwnerA((c) => setStatus(c, a, undecided, 'rejected')))).toEqual(REJECTED);
  const approved = await proposeDraft(db.app, a);
  const underApproved = asOwnerA(async (c) => {
    await decide(c, a, approved, 'approved', a.owner);
    await setStatus(c, a, approved, 'rejected');
  });
  expect(await refused(underApproved)).toEqual(REJECTED);
  const rejected = await proposeDraft(db.app, a);
  await asOwnerA((c) => decide(c, a, rejected, 'rejected', a.owner));
  await asOwnerA((c) => setStatus(c, a, rejected, 'rejected'));
  expect(await statusOf(a, rejected)).toBe('rejected');
});

it('G2 only an undecided draft can be marked stale or failed', async () => {
  for (const status of ['stale', 'failed']) {
    const decided = await proposeDraft(db.app, a);
    await asOwnerA((c) => decide(c, a, decided, 'rejected', a.owner));
    expect(await refused(asOwnerA((c) => setStatus(c, a, decided, status))), status).toEqual(DRAFT('draft refused: the draft is decided'));
    const undecided = await proposeDraft(db.app, a);
    await asOwnerA((c) => setStatus(c, a, undecided, status));
    expect(await statusOf(a, undecided)).toBe(status);
  }
});

it('G2 a new draft starts proposed', async () => {
  const r = await refused(
    tx(db.app, { tenant: a.tenant }, (c) =>
      c.query(`insert into approval.draft (tenant_id, command_type, payload, run_id, status) values ($1, 'price.set', '{}', $2, 'executed')`, [
        a.tenant,
        a.run,
      ]),
    ),
  );
  expect(r).toEqual(DRAFT('draft refused: a new draft is proposed'));
});

it('G2 a decision on a draft proposed in the same transaction is refused', async () => {
  const r = await refused(
    asOwnerA(async (c) => {
      const draft = randomUUID();
      await c.query(`insert into approval.draft (tenant_id, id, command_type, payload, run_id) values ($1, $2, 'price.set', '{}', $3)`, [
        a.tenant,
        draft,
        a.run,
      ]);
      await decide(c, a, draft, 'approved', a.owner);
    }),
  );
  expect(r).toEqual(DRAFT('decision refused: the draft was proposed in this transaction'));
});

it('G2 a caller-supplied created_txid is overwritten with the current transaction', async () => {
  const draft = await proposeDraft(db.app, a);
  const { rows } = await tx(db.app, { tenant: a.tenant, actor: a.owner }, (c) =>
    c.query(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, created_txid)
       values ($1, $2, 'approved', $3, txid_current() + 1000) returning created_txid, txid_current() as now_txid`,
      [a.tenant, draft, a.owner],
    ),
  );
  expect(rows[0].created_txid).toBe(rows[0].now_txid);
});

it('G2 context does not survive the transaction on a pooled connection', async () => {
  const client = await db.app.connect();
  try {
    await tx(client, { tenant: a.tenant, actor: a.owner, command: 'item.create' }, (c) =>
      c.query(`insert into books.item (tenant_id, name, unit) values ($1, 'Toor dal 1 kg', 'pack')`, [a.tenant]),
    );
    const r = await refused(
      tx(client, { tenant: a.tenant }, (c) => c.query(`insert into books.item (tenant_id, name, unit) values ($1, 'Butter 100 g', 'pack')`, [a.tenant])),
    );
    expect(r).toEqual({ code: 'MS001', message: 'book write refused: no approved decision and no direct command' });
  } finally {
    client.release();
  }
});
