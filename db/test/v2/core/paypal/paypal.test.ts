// PayPal payment links against the real guards, RLS and roles, in recorded mode (no network). The PayPal tables
// are db/schema/24_paypal.sql's, and the commands and reads are core's own registries (commands.ts, queries.ts spread
// them). What is proved:
//   PAYPAL0 the DDL keeps the build's rules: its declared indexes exactly, tenant_id leading every index and key of a
//           tenant table, each role's exact grants, its policies, its functions sealed, and the seal with the exemption;
//   PAYPAL1 nothing calls PayPal before approval, and the approval's own transaction calls nothing: it queues one link;
//   PAYPAL2 the sweep asks PayPal once per approved draft, with the draft's id as the request id; a second approval or
//           sweep makes no second link; the link table's guard admits only an approved paypal.request of this
//           transaction, by an active approver, for that very draft and payload;
//   PAYPAL3 the amount is a cell: a typed amount is refused, and so is a figure that is not this customer's balance;
//   PAYPAL4 a verified paid notification stores one event (with whether PayPal's amount is the link's) and writes no
//           book row and no draft; a replay, a partial payment or an unknown link stores nothing;
//   PAYPAL5 the agent's recipes build both drafts from cells; core takes the record and holds a new link while the
//           customer's paid link is unrecorded; no PayPal call;
//   PAYPAL6 a member drafts "record this payment" by PayPal from the stored event's cells (an amount that is not the
//           balance, its date); only its approval writes the payment, and the watcher stops listing it; an event in
//           another currency is never recorded or listed;
//   PAYPAL7 one live link per customer: a second proposal is refused while one is live, two at once leave one draft,
//           and a cancel (a draft) closes a link at PayPal once, after which a new link may be asked;
//   PAYPAL8 an invoice's link asks only for its sale's open credit: a part-paid invoice the rest, a paid one nothing;
//           a reversed sale none, and a reversal after the proposal makes the draft stale;
//   PAYPAL9 the sweep: one link's database error never blocks the next, two sweeps at once ask PayPal once per link,
//           a link fails after its attempts, and a shop's sweep never touches another shop's links;
//   PAYPAL10 the guards as the roles meet them: the event's (public), the link's update branch, the route's.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { addMember, type CoreError, decide, proposeDraft, runCommand, runDueJobs, type Session, withPage, withTx } from '@munshi/core';
import {
  paypalLinks,
  proposePaypalCancel,
  proposePaypalLink,
  proposeRecordPaypal,
  receivePaypalPaid,
  sweepShopPaypal,
  wirePayPal,
} from '@munshi/core/paypal';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type LinkRequest, type PayPal, recordedPayPal } from '../../../../../packages/adapters/payments/index.ts';
import { paypalLink, recordPaypal } from '../../../../../packages/agent/src/recipes-paypal.ts';
import { MAX_ATTEMPTS } from '../../../../../packages/core/src/jobs-paypal.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { formatRef } from '../../../../../packages/core/src/read.ts';
import { mintIn } from '../../../../../packages/core/src/snapshots.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { expectedPrivileges, privileges, RUNTIME_ROLES } from '../../gates/lib.ts';
import { type Counter, item, register } from '../counter/counter.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, sessionOf, smallShop } from '../shop.ts';
import { PAYPAL_MANIFEST, SEAL_EXEMPTION } from './pending-ddl.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let b: Shop; // another shop, with a sent link of its own
const calls: LinkRequest[] = [];
const cancels: string[] = [];
const badRefs = new Set<string>(); // links whose PayPal answer the database must refuse
let delayMs = 0;

// Recorded PayPal, every call kept: the gates count PayPal calls with it.
const recorded = recordedPayPal();
const spy: PayPal = {
  mode: recorded.mode,
  label: recorded.label,
  invoice: (id) => recorded.invoice(id),
  verifyWebhook: (raw, h) => recorded.verifyWebhook(raw, h),
  createLink: async (r) => {
    calls.push(r);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const link = await recorded.createLink(r);
    return badRefs.has(r.reference) ? { ...link, paypalId: 'bad id!' } : link;
  },
  cancel: async (id, requestId) => {
    cancels.push(id);
    return recorded.cancel(id, requestId);
  },
};

const BALANCE = 45_050;
const PAID = 44_000; // what PayPal reports: not the balance, so the draft's amount is the event's cell, by value

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = new pg.Pool({ connectionString: jobsUrl(db), max: 4 });
  wirePayPal(spy);
  s = await smallShop(app, 'PayPal');
  await runCommand(app, s.owner, 'credit.record', { customerId: s.customer, amountMinor: BALANCE });
  b = await smallShop(app, 'PayPal B');
  await runCommand(app, b.owner, 'credit.record', { customerId: b.customer, amountMinor: 12_000 });
  const bDraft = await proposePaypalLink(app, { session: b.manager }, { customerId: b.customer });
  await decide(app, b.owner, bDraft, 'approved');
  await sweepShopPaypal(jobs, b.owner.tenantId);
  calls.length = 0;
  await db.sabotage();
}, 240_000);
afterAll(async () => {
  wirePayPal(null);
  await jobs?.end();
  await db?.close();
});

const q = async <T = Record<string, unknown>>(sql: string, values: unknown[] = [], shop: Shop = s) =>
  (await tx(app, { tenant_id: shop.owner.tenantId }, (c) => c.query(sql, values))).rows as T[];
const counts = async () =>
  (
    await q<{ books: number; drafts: number; links: number; events: number }>(
      `select (select count(*) from books.payment)::int + (select count(*) from books.credit_entry)::int + (select count(*) from books.journal_entry)::int as books,
              (select count(*) from approval.draft)::int as drafts, (select count(*) from ops.paypal_link)::int as links,
              (select count(*) from ops.payment_event)::int as events`,
    )
  )[0] as { books: number; drafts: number; links: number; events: number };
let minute = 0;
const tick = () => runDueJobs(jobs, new Date(Date.now() + ++minute * 60_000), ['paypal_links'], 5_000);
const sweep = (shop: Shop = s) => sweepShopPaypal(jobs, shop.owner.tenantId);
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as CoreError & { code: string; sqlstate?: string });
const sqlstate = async (p: Promise<unknown>) => {
  const e = await refusal(p);
  return (e as { sqlstate?: string; code?: string } | null)?.sqlstate ?? (e as { code?: string } | null)?.code ?? 'none';
};
const newCustomer = async (name: string, credit: number) => {
  const id = (await runCommand(app, s.owner, 'customer.create', { name })).customerId as string;
  if (credit) await runCommand(app, s.owner, 'credit.record', { customerId: id, amountMinor: credit });
  return id;
};
const linkOf = async (draft: string) =>
  (await q<{ id: string; status: string; paypal_id: string | null; amount_minor: string; attempts: number; error_code: string | null }>(
    'select id::text, status, paypal_id, amount_minor::text, attempts, error_code from ops.paypal_link where draft_id = $1',
    [draft],
  ))[0];

it('the pending DDL keeps the build rules: declared indexes, tenant-led keys, exact grants, policies, sealed functions, the seal', async () => {
  const tables = PAYPAL_MANIFEST.tables;
  // Every declared index exactly as declared, and no other non-constraint index on these tables.
  for (const [name, spec] of Object.entries(PAYPAL_MANIFEST.indexes)) {
    const [schema, index] = name.split('.') as [string, string];
    const real = await db.admin.query<{ def: string }>(
      `select pg_get_indexdef(i.indexrelid) as def from pg_index i join pg_class ic on ic.oid = i.indexrelid where ic.relname = $1 and ic.relnamespace = $2::regnamespace`,
      [index, schema],
    );
    const unique = spec.startsWith('unique ');
    const c = await db.admin.connect();
    try {
      await c.query('begin');
      await c.query(`create ${unique ? 'unique ' : ''}index g10_probe ${unique ? spec.slice('unique '.length) : spec}`);
      const probe = await c.query<{ def: string }>(`select pg_get_indexdef($1::regclass) as def`, [`${schema}.g10_probe`]);
      expect(real.rows.map((r) => r.def), name).toEqual([probe.rows[0]?.def.replace(' g10_probe ', ` ${index} `)]);
    } finally {
      await c.query('rollback');
      c.release();
    }
  }
  const { rows: catalog } = await db.admin.query<{ name: string }>(
    `select n.nspname || '.' || ic.relname as name from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_namespace n on n.oid = ic.relnamespace
      where i.indrelid = any($1::regclass[]) and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid and k.contype in ('p', 'u', 'x'))
      order by 1`,
    [tables],
  );
  expect(catalog.map((r) => r.name)).toEqual(Object.keys(PAYPAL_MANIFEST.indexes).sort());
  // G10: tenant_id leads every index of a tenant table and every foreign key into one.
  const tenantTables = tables.filter((t) => !PAYPAL_MANIFEST.globalTables.includes(t));
  const { rows: keys } = await db.admin.query<{ name: string; first: string; target_first: string | null }>(
    `select ic.relname::text as name, (select a.attname from pg_attribute a where a.attrelid = i.indrelid and a.attnum = i.indkey[0])::text as first, null::text as target_first
       from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = any($1::regclass[])
     union all
     select c.conname::text, (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1])::text,
            (select a.attname from pg_attribute a where a.attrelid = c.confrelid and a.attnum = c.confkey[1])::text
       from pg_constraint c where c.contype = 'f' and c.confrelid = any($1::regclass[])`,
    [tenantTables],
  );
  expect(keys.length).toBeGreaterThan(6);
  expect(keys.filter((k) => k.first !== 'tenant_id' || (k.target_first !== null && k.target_first !== 'tenant_id'))).toEqual([]);
  // Exact privileges for every runtime role; RLS enabled and forced; the declared policies; ids by uuidv7.
  const wrong: string[] = [];
  for (const rel of tables) {
    for (const role of RUNTIME_ROLES) {
      const held = await privileges(db.admin, role, rel);
      const want = expectedPrivileges((PAYPAL_MANIFEST.grants as Record<string, Record<string, string>>)[rel]?.[role]);
      if (held.join() !== want.join()) wrong.push(`${role} on ${rel}: holds [${held.join(' ')}], declared [${want.join(' ')}]`);
    }
  }
  expect(wrong).toEqual([]);
  const { rows: rls } = await db.admin.query<{ rel: string; forced: boolean; policies: string[] }>(
    `select c.oid::regclass::text as rel, c.relrowsecurity and c.relforcerowsecurity as forced,
            array(select p.polname::text from pg_policy p where p.polrelid = c.oid order by 1) as policies
       from pg_class c where c.oid = any($1::regclass[]) order by 1`,
    [tables],
  );
  expect(rls).toEqual(tables.map((t) => ({ rel: t, forced: true, policies: (PAYPAL_MANIFEST.policies as Record<string, string[]>)[t] })).sort((x, y) => x.rel.localeCompare(y.rel)));
  const { rows: ids } = await db.admin.query<{ col: string; def: string }>(
    `select c.oid::regclass::text || '.' || a.attname as col, pg_get_expr(d.adbin, d.adrelid) as def
       from pg_class c join pg_attribute a on a.attrelid = c.oid join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where c.oid = any($1::regclass[]) and a.attname = 'id'`,
    [tables],
  );
  expect(ids.map((r) => r.col).sort()).toEqual([...PAYPAL_MANIFEST.uuidv7Ids].sort());
  expect(ids.every((r) => r.def === 'ops.uuidv7()')).toBe(true);
  // Functions: invoker, search_path pinned, executable by no runtime role.
  for (const fn of PAYPAL_MANIFEST.functions) {
    const { rows } = await db.admin.query<{ definer: boolean; pinned: boolean; anyone: boolean }>(
      `select p.prosecdef as definer, coalesce('search_path=pg_catalog, pg_temp' = any (p.proconfig), false) as pinned,
              has_function_privilege('public', p.oid, 'EXECUTE') or ${RUNTIME_ROLES.map((r) => `has_function_privilege('${r}', p.oid, 'EXECUTE')`).join(' or ')} as anyone
         from pg_proc p where p.oid = $1::regprocedure`,
      [fn],
    );
    expect(rows[0], fn).toEqual({ definer: false, pinned: true, anyone: false });
  }
  // The seal as landed carries the exemption and passes over this database; without it, it names the PayPal commands.
  const exempted = readFileSync(path.join(import.meta.dirname, '..', '..', '..', '..', 'schema', '90_seal.sql'), 'utf8');
  expect(exempted.includes(SEAL_EXEMPTION.to) && exempted.includes(SEAL_EXEMPTION.whereTo)).toBe(true);
  const seal = exempted.replace(SEAL_EXEMPTION.to, SEAL_EXEMPTION.from).replace(SEAL_EXEMPTION.whereTo, SEAL_EXEMPTION.whereFrom);
  const m = await db.migrator();
  try {
    await m.query('begin');
    const unexempted = await m.query(seal).then(
      () => 'sealed',
      (e: Error) => e.message,
    );
    await m.query('rollback');
    expect(unexempted).toMatch(/command paypal\.(request|cancel): writes no books table/);
    await m.query('begin');
    expect(
      await m.query(exempted).then(
        () => 'sealed',
        (e: Error) => e.message,
      ),
    ).toBe('sealed');
    await m.query('rollback');
  } finally {
    await m.end();
  }
  // PayPal's payer page: an https URL of up to 490 characters (a regex bound over 255 is no regex in PostgreSQL, so the
  // length is its own check). The row is set up with triggers and keys off; the checks still run.
  const c = await db.admin.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    const sent = (url: string) =>
      c.query(
        `insert into ops.paypal_link (tenant_id, draft_id, decision_id, purpose, customer_id, amount_minor, currency, figure, created_by, status, mode, paypal_id, payer_url, sent_at)
         values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'credit', gen_random_uuid(), 100, 'INR', 'f', gen_random_uuid(), 'sent', 'sandbox', 'INV2-URL', $1, now())`,
        [url],
      );
    await sent(`https://www.sandbox.paypal.com/invoice/p/#${'A'.repeat(300)}`);
    for (const bad of [`https://x.example/${'A'.repeat(480)}`, 'http://www.sandbox.paypal.com/invoice', 'https://a b']) {
      await c.query('savepoint url');
      expect(await sent(bad).then(() => 'stored', (e: { code: string }) => e.code), bad.slice(0, 40)).toBe('23514');
      await c.query('rollback to savepoint url');
    }
  } finally {
    await c.query('rollback');
    c.release();
  }
});

let draftId = '';
let linkId = '';
let eventId = '';
let paypalId = '';

// The state the gates below build on, made here when a gate runs alone (the red-proof harness runs each by itself), and
// the very same steps the earlier gates take when the file runs whole (each a no-op once done): the customer's link
// drafted by the manager and approved by the owner (PAYPAL1), made by the sweep (PAYPAL2), and paid at PayPal (PAYPAL4).
async function ensureApproved(): Promise<void> {
  if (draftId) return;
  draftId = await proposePaypalLink(app, { session: s.manager }, { customerId: s.customer });
  await decide(app, s.owner, draftId, 'approved');
  linkId = ((await q<{ id: string }>('select id::text from ops.paypal_link where draft_id = $1', [draftId]))[0] as { id: string }).id;
}
async function ensureSent(): Promise<void> {
  await ensureApproved();
  const [l] = await q<{ status: string }>('select status from ops.paypal_link where id = $1', [linkId]);
  if (l?.status === 'queued') {
    await sweep();
    calls.length = 0;
  }
}
async function ensurePaid(): Promise<void> {
  await ensureSent();
  if (eventId) return;
  paypalId = ((await q<{ paypal_id: string }>('select paypal_id from ops.paypal_link where id = $1', [linkId]))[0] as { paypal_id: string }).paypal_id;
  expect(await receivePaypalPaid(pub, { ...NOTICE, paypalId }, sha)).toBe('stored');
  eventId = ((await q<{ id: string }>('select id::text from ops.payment_event where link_id = $1', [linkId]))[0] as { id: string }).id;
}

it('proposing a link calls no PayPal; the approval queues exactly one link under the approver and calls nothing either', async () => {
  draftId = await proposePaypalLink(app, { session: s.manager }, { customerId: s.customer });
  await tick();
  expect(calls).toEqual([]);
  expect((await counts()).links).toBe(0);
  const d = await decide(app, s.owner, draftId, 'approved');
  expect(d.status).toBe('executed');
  expect(calls).toEqual([]); // the approval's transaction asked PayPal nothing
  const links = await q<{ id: string; status: string; created_by: string; amount_minor: string; draft_id: string }>(
    'select id::text, status, created_by::text, amount_minor::text, draft_id::text from ops.paypal_link',
  );
  expect(links).toEqual([{ id: expect.any(String), status: 'queued', created_by: s.owner.memberId, amount_minor: String(BALANCE), draft_id: draftId }]);
  linkId = (links[0] as { id: string }).id;
});

// An approved (or rejected) decision of this transaction, made as `actor` on `draft`, then `then` in the same
// transaction; the transaction is rolled back whatever happens (a positive control throws a sentinel).
async function underDecision(actor: Session, draft: string, verdict: 'approved' | 'rejected', then: (c: pg.PoolClient) => Promise<unknown>) {
  return tx(app, { tenant_id: s.owner.tenantId, actor_id: actor.memberId }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, reason) values ($1, $2, $3, $4, $5) returning id::text`,
      [s.owner.tenantId, draft, verdict, actor.memberId, verdict === 'rejected' ? 'not_now' : null],
    );
    await c.query(`select set_config('munshi.decision_id', $1, true)`, [rows[0]?.id]);
    await then(c);
    throw new Error('rolled back');
  });
}
// The amount and currency default to the guard case's customer's balance cell (3,000 INR): the guard binds them to it.
const insertLink = (c: pg.PoolClient, draft: string, payload: { customerId: string; figure: string }, amount = 3_000, currency = 'INR') =>
  c.query(
    `insert into ops.paypal_link (tenant_id, draft_id, decision_id, purpose, customer_id, amount_minor, currency, figure, created_by)
     values ($1, $2, nullif(current_setting('munshi.decision_id', true), '')::uuid, 'credit', $3, $6, $7, $4, $5)`,
    [s.owner.tenantId, draft, payload.customerId, payload.figure, s.owner.memberId, amount, currency],
  );

it('the sweep asks PayPal once, with the draft id as the request id; a second approval or sweep makes no second link; no link without its approval', async () => {
  await ensureApproved();
  await tick();
  await tick();
  await sweep();
  expect(calls).toEqual([{ requestId: draftId, amountMinor: BALANCE, currency: 'INR', reference: linkId }]);
  const [link] = await q<{ status: string; mode: string; paypal_id: string }>('select status, mode, paypal_id from ops.paypal_link');
  expect(link).toEqual({ status: 'sent', mode: 'recorded', paypal_id: expect.stringMatching(/^REC-/) });
  expect((await refusal(decide(app, s.owner, draftId, 'approved')))?.code).toBe('not_proposed');
  expect((await counts()).links).toBe(1);
  expect((await refusal(runCommand(app, s.owner, 'paypal.request', { purpose: 'credit', customerId: s.customer, figure: 'x' })))?.code).toBe('refused');

  // The guard, case by case, each inside a transaction that also holds a decision; a positive control first.
  const x = await newCustomer('Guard customer', 3_000);
  const y = await newCustomer('Guard customer two', 4_000);
  const p = await proposePaypalLink(app, { session: s.manager }, { customerId: x });
  const other = await proposePaypalLink(app, { session: s.manager }, { customerId: y });
  const [pd] = await q<{ payload: { customerId: string; figure: string } }>('select payload from approval.draft where id = $1', [p]);
  const [od] = await q<{ payload: { customerId: string; figure: string } }>('select payload from approval.draft where id = $1', [other]);
  const pp = (pd as { payload: { customerId: string; figure: string } }).payload;
  const op = (od as { payload: { customerId: string; figure: string } }).payload;
  const bal = await withPage(app, s.owner, async (c) => mintIn(c, 'credit.balance', { customer_id: s.customer }));
  const record = await proposeDraft(app, { session: s.manager }, {
    command: 'payment.record',
    payload: { direction: 'in', customerId: s.customer, method: 'cash', amountMinor: BALANCE },
    payloadRefs: { amountMinor: { snapshotId: bal.id, row: 0, col: 'balance' } },
    basedOn: [{ snapshotId: bal.id, row: 0, col: 'balance' }],
  });
  const ok = await refusal(underDecision(s.owner, p, 'approved', (c) => insertLink(c, p, pp)));
  expect(ok?.message).toBe('rolled back'); // the guard admits the approved draft's own link
  const cases: [string, () => Promise<unknown>][] = [
    ['rejected verdict', () => underDecision(s.owner, p, 'rejected', (c) => insertLink(c, p, pp))],
    ['another draft', () => underDecision(s.owner, p, 'approved', (c) => insertLink(c, other, op))],
    ['another command', () => underDecision(s.owner, record, 'approved', (c) => insertLink(c, record, pp))],
    // Another figure, its own amount (4,000 INR): only the draft's figure tells it apart, not the amount check.
    ['another figure', () => underDecision(s.owner, p, 'approved', (c) => insertLink(c, p, { ...pp, figure: op.figure }, 4_000))],
    ['another customer', () => underDecision(s.owner, p, 'approved', (c) => insertLink(c, p, { ...pp, customerId: y }))],
    // The amount is the cited cell's, in its currency: core's word is not enough.
    ['another amount', () => underDecision(s.owner, p, 'approved', (c) => insertLink(c, p, pp, 2_999))],
    ['another currency', () => underDecision(s.owner, p, 'approved', (c) => insertLink(c, p, pp, 3_000, 'USD'))],
    // The decision of another, committed transaction (PAYPAL1's).
    [
      'another transaction',
      () => tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, async (c) => {
        const [d] = (await c.query<{ id: string }>('select id::text from approval.decision where draft_id = $1', [draftId])).rows;
        await c.query(`select set_config('munshi.decision_id', $1, true)`, [d?.id]);
        await insertLink(c, draftId, { customerId: s.customer, figure: (await q<{ figure: string }>('select figure from ops.paypal_link'))[0]?.figure as string });
      }),
    ],
  ];
  const mgr = await sessionOf(app, s.owner.tenantId, await addMember(app, s.owner, { name: 'Leaving manager', role: 'manager' }));
  cases.push([
    'inactive approver',
    () => underDecision(mgr, p, 'approved', async (c) => {
      await c.query(`select set_config('munshi.actor_id', $1, true)`, [s.owner.memberId]);
      await c.query('update ops.member set active = false, deactivated_at = now() where id = $1', [mgr.memberId]);
      await c.query(`select set_config('munshi.actor_id', $1, true)`, [mgr.memberId]);
      await insertLink(c, p, pp);
    }),
  ]);
  for (const [name, attempt] of cases) expect(await sqlstate(attempt()), name).toBe('MS007');
  for (const d of [p, other, record]) await decide(app, s.owner, d, 'rejected', 'not_now');
  const page = await withPage(app, s.owner, (c) => paypalLinks(c, {}));
  expect(page.links.map((l) => [l.status, l.mode, l.live, l.events.length])).toEqual([['sent', 'recorded', true, 0]]);
});

it('the amount is a cell: a typed amount is refused, and so is a figure that is not this customer’s current balance', async () => {
  const other = await newCustomer('Second customer', 9_900);
  const { otherBalance, ownBalance } = await withPage(app, s.owner, async (c) => {
    const o = await mintIn(c, 'credit.balance', { customer_id: other });
    const m = await mintIn(c, 'credit.balance', { customer_id: s.customer });
    return { otherBalance: { snapshotId: o.id, row: 0, col: 'balance' }, ownBalance: { snapshotId: m.id, row: 0, col: 'balance' } };
  });
  const propose = (payload: Record<string, unknown>, basedOn = [otherBalance], payloadRefs = {}) =>
    refusal(proposeDraft(app, { session: s.owner }, { command: 'paypal.request', payload, basedOn, payloadRefs }));
  const drafts = (await counts()).drafts;
  const typed = await propose({ purpose: 'credit', customerId: other, figure: formatRef(otherBalance), amountMinor: 9_900 }, [otherBalance], { amountMinor: otherBalance });
  expect(typed?.code).toBe('invalid');
  const wrong = await propose({ purpose: 'credit', customerId: s.customer, figure: formatRef(otherBalance) });
  expect([wrong?.code, wrong?.fields?.includes('figure')]).toEqual(['invalid', true]);
  const uncited = await propose({ purpose: 'credit', customerId: other, figure: formatRef(ownBalance) }, [otherBalance]);
  expect([uncited?.code, uncited?.fields?.includes('figure')]).toEqual(['invalid', true]);
  expect((await counts()).drafts).toBe(drafts);
});

const sha = createHash('sha256').update('raw body').digest('hex');
const NOTICE = { eventId: 'WH-3F562076HD293871E-75F399086E414290U', status: 'PAID', paidMinor: PAID, currency: 'INR' };
it('a verified paid notification stores one event and writes no book row and no draft; a replay, a partial payment or an unknown link stores nothing', async () => {
  await ensureSent();
  paypalId = ((await q<{ paypal_id: string }>('select paypal_id from ops.paypal_link where id = $1', [linkId]))[0] as { paypal_id: string }).paypal_id;
  const before = await counts();
  expect(await receivePaypalPaid(pub, { ...NOTICE, paypalId }, sha)).toBe('stored');
  expect(await receivePaypalPaid(pub, { ...NOTICE, paypalId }, sha).catch((e: CoreError) => ({ refused: e.code }))).toBe('duplicate');
  expect(await receivePaypalPaid(pub, { ...NOTICE, eventId: 'WH-PARTIAL-1', status: 'PARTIALLY_PAID', paypalId }, sha)).toBe('not_paid');
  expect(await receivePaypalPaid(pub, { ...NOTICE, eventId: 'WH-OTHER-1', paypalId: 'INV2-NOT-OURS' }, sha)).toBe('unknown_link');
  expect(await counts()).toEqual({ ...before, events: before.events + 1 });
  const [ev] = await q<{ id: string; amount_minor: string; matches_link: boolean }>('select id::text, amount_minor::text, matches_link from ops.payment_event');
  expect(ev).toEqual({ id: expect.any(String), amount_minor: String(PAID), matches_link: false }); // PayPal's amount, flagged against the link's
  eventId = (ev as { id: string }).id;
  // A paid link is no longer live.
  expect((await withPage(app, s.owner, (c) => paypalLinks(c, {}))).links[0]?.live).toBe(false);
});

it('the recipes draft a PayPal link for an overdue balance and "record this payment" from cells; core takes the record and holds the link while the paid one is unrecorded', async () => {
  // Its own customers (the red-proof harness runs it alone): one owing with no link, one whose link PayPal says is paid.
  const owing = await newCustomer('Recipe link customer', 7_700);
  const paidUp = await newCustomer('Recipe record customer', 9_900);
  const dPaid = await proposePaypalLink(app, { session: s.manager }, { customerId: paidUp });
  await decide(app, s.owner, dPaid, 'approved');
  await sweep();
  const paid = await linkOf(dPaid);
  expect(await receivePaypalPaid(pub, { ...NOTICE, eventId: `WH-PAYPAL5-${paid?.id}`, paidMinor: 9_000, paypalId: paid?.paypal_id as string }, sha)).toBe('stored');
  const before = calls.length;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const made = await withPage(app, s.owner, async (c) => {
    const read = async (query: string, params: Record<string, unknown>) => {
      const snap = await mintIn(c, query, params);
      return { snapshotId: snap.id, rows: snap.rows };
    };
    const book = await mintIn(c, 'credit.balances', { as_of: tomorrow });
    const row = (customer: string) => book.rows.findIndex((x) => x.customer_id?.kind === 'text' && x.customer_id.txt === customer);
    const unrecorded = await mintIn(c, 'watch.paypal_unrecorded', { as_of: tomorrow });
    const ev = unrecorded.rows.findIndex((x) => x.link_id?.kind === 'text' && x.link_id.txt === paid?.id);
    const finding = (snapshotId: string, r: number, cells: unknown) =>
      ({ id: '00000000-0000-4000-8000-000000000000', kind: 'k', snapshotId, row: r, cells, status: 'open', current: true, openDraft: false }) as never;
    return {
      link: await paypalLink(finding(book.id, row(owing), book.rows[row(owing)]), read),
      busy: await paypalLink(finding(book.id, row(paidUp), book.rows[row(paidUp)]), read),
      record: await recordPaypal(finding(unrecorded.id, ev, unrecorded.rows[ev]), read),
    };
  });
  expect(made.link).toMatchObject({ command: 'paypal.request', payload: { purpose: 'credit', customerId: owing }, payloadRefs: {} });
  expect(made.record).toMatchObject({ command: 'payment.record', payload: { amountMinor: 9_000, method: 'paypal', customerId: paidUp } });
  type Made = { command: string; payload: unknown; basedOn: never[]; payloadRefs: Record<string, never> };
  // Core accepts the recipe's link for the customer with none (its figure their current balance cell).
  const accepted = await proposeDraft(app, { session: s.manager }, made.link as Made).catch((e: CoreError) => ({ refused: e.code, fields: e.fields }));
  expect(typeof accepted, JSON.stringify(accepted)).toBe('string');
  expect((await decide(app, s.owner, accepted as string, 'rejected', 'not_now')).status).toBe('rejected');
  // PayPal says the other's link is paid and the books do not show it yet: a new link waits until a person records it.
  const busy = await refusal(proposeDraft(app, { session: s.manager }, made.busy as Made));
  expect([busy?.code, busy?.fields]).toEqual(['invalid', ['customerId']]);
  // And "record this payment" (approved, so the later gates' watcher lists only their own notice).
  const recordDraft = await proposeDraft(app, { session: s.manager }, made.record as Made);
  expect((await decide(app, s.owner, recordDraft, 'approved')).status).toBe('executed');
  expect(calls.length).toBe(before);
});

it('a member drafts "record this payment" by PayPal from the stored event; only its approval writes the payment, once; another currency is never recorded', async () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const listed = async () => withPage(app, s.owner, async (c) => (await mintIn(c, 'watch.paypal_unrecorded', { as_of: tomorrow })).rows.length);
  await ensurePaid();
  expect(await listed()).toBe(1);
  // The watcher's read as the jobs role (no actor), under the shop's context: the DDL's grants admit it.
  const watchSql = (QUERIES.get('watch.paypal_unrecorded') as { sql: string }).sql;
  const asJobs = await tx(jobs, { tenant_id: s.owner.tenantId }, (c) => c.query(watchSql, [tomorrow]));
  expect(asJobs.rows.map((r) => r.event_id)).toEqual([eventId]);
  // An event in another currency on the same link: stored, never listed, never drafted.
  expect(await receivePaypalPaid(pub, { ...NOTICE, eventId: 'WH-USD-1', currency: 'USD', paypalId }, sha)).toBe('stored');
  expect(await listed()).toBe(1);
  const [usd] = await q<{ id: string }>(`select id::text from ops.payment_event where currency = 'USD'`);
  expect((await refusal(proposeRecordPaypal(app, { session: s.manager }, (usd as { id: string }).id)))?.code).toBe('invalid');

  const before = await counts();
  const recordDraft = (await proposeRecordPaypal(app, { session: s.manager }, eventId).catch((e: CoreError) => ({ refused: e.code, fields: e.fields }))) as string;
  expect(typeof recordDraft, JSON.stringify(recordDraft)).toBe('string');
  const [draft] = await q<{ command: string; payload: Record<string, unknown>; payload_refs: Record<string, { col: string }> }>(
    'select command, payload, payload_refs from approval.draft where id = $1',
    [recordDraft],
  );
  const [received] = await q<{ at: string }>(`select to_json(received_at)#>>'{}' as at from ops.payment_event where id = $1`, [eventId]);
  expect(draft?.command).toBe('payment.record');
  expect(draft?.payload).toMatchObject({ direction: 'in', customerId: s.customer, method: 'paypal', amountMinor: PAID });
  expect(Date.parse(String(draft?.payload.paidAt))).toBe(Date.parse(String(received?.at)));
  expect(draft?.payload_refs.amountMinor?.col).toBe('amount');
  expect((await counts()).books).toBe(before.books); // proposing writes no book row
  expect((await decide(app, s.owner, recordDraft, 'approved')).status).toBe('executed');
  const paid = await q<{ amount_minor: string; method: string; reference: string; created_by: string }>(
    `select amount_minor::text, method, reference, created_by::text from books.payment where reference = $1`,
    [paypalId],
  );
  expect(paid).toEqual([{ amount_minor: String(PAID), method: 'paypal', reference: paypalId, created_by: s.owner.memberId }]);
  const [journal] = await q<{ n: number }>(`select count(*)::int as n from books.journal_line where account = 'paypal_clearing' and amount_minor = $1`, [PAID]);
  expect(journal?.n).toBe(1);
  expect(await listed()).toBe(0);
  expect((await refusal(proposeRecordPaypal(app, { session: s.manager }, eventId)))?.code).toBe('conflict');
  const page = await withPage(app, s.owner, (c) => paypalLinks(c, {}));
  expect(page.links.find((l) => l.paypalId === paypalId)?.events.map((e) => [e.recorded, e.matchesLink, e.sameCurrency])).toEqual([
    [true, false, true],
    [true, false, false], // the same PayPal invoice's payment is recorded; this one could never be
  ]);
});

it('one live link per customer: a second is refused while one is live, two at once leave one draft; a cancel closes it at PayPal once', async () => {
  const c7 = await newCustomer('Cancel customer', 7_000);
  const [first, second] = await Promise.all([
    refusal(proposePaypalLink(app, { session: s.manager }, { customerId: c7 })),
    refusal(proposePaypalLink(app, { session: s.owner }, { customerId: c7 })),
  ]);
  expect([first, second].filter((e) => e === null).length).toBe(1); // exactly one proposal stands
  expect([first, second].find((e) => e !== null)?.code).toBe('conflict');
  const [waiting] = await q<{ id: string }>(`select id::text from approval.draft where command = 'paypal.request' and status = 'proposed' and payload->>'customerId' = $1`, [c7]);
  const d7 = (waiting as { id: string }).id;
  expect((await refusal(proposePaypalLink(app, { session: s.manager }, { customerId: c7 })))?.code).toBe('conflict'); // a draft waits
  await decide(app, s.owner, d7, 'approved');
  expect((await refusal(proposePaypalLink(app, { session: s.manager }, { customerId: c7 })))?.code).toBe('conflict'); // queued
  await sweep();
  expect((await linkOf(d7))?.status).toBe('sent');
  expect((await refusal(proposePaypalLink(app, { session: s.manager }, { customerId: c7 })))?.code).toBe('conflict'); // sent, unpaid
  // Cancel: a draft; nothing moves until it is approved; then PayPal cancels it once, and a new link may be asked.
  const cancelDraft = await proposePaypalCancel(app, { session: s.manager }, (await linkOf(d7))?.id as string);
  expect(cancels).toEqual([]);
  await decide(app, s.owner, cancelDraft, 'approved');
  expect((await linkOf(d7))?.status).toBe('cancel_queued');
  expect(cancels).toEqual([]); // the approval's transaction called nothing
  await sweep();
  await sweep();
  expect(cancels).toEqual([(await linkOf(d7))?.paypal_id]);
  expect((await linkOf(d7))?.status).toBe('cancelled');
  const again = await proposePaypalLink(app, { session: s.manager }, { customerId: c7 });
  await decide(app, s.owner, again, 'rejected', 'not_now');
  // A queued link cancels at once, with no PayPal call.
  const c7b = await newCustomer('Cancel queued customer', 2_000);
  const d7b = await proposePaypalLink(app, { session: s.manager }, { customerId: c7b });
  await decide(app, s.owner, d7b, 'approved');
  await decide(app, s.owner, await proposePaypalCancel(app, { session: s.manager }, (await linkOf(d7b))?.id as string), 'approved');
  expect((await linkOf(d7b))?.status).toBe('cancelled');
  expect(cancels.length).toBe(1);
});

it('an invoice link asks only for its sale’s open credit: part-paid the rest, paid nothing; a reversed sale none, and a reversal after the proposal stales it', async () => {
  const counter: Counter = { owner: s.owner, manager: s.manager, staff: s.staff, shopId: s.shopId, tenant: s.owner.tenantId };
  await register(app, counter, 'regular', 'PP');
  const kettle = await item(app, counter, { name: 'Electric kettle', priceMinor: 10_000, taxClass: 'general_18', hsn: '8516' });
  const sellOnCredit = async (name: string) => {
    const customerId = await newCustomer(name, 0);
    const sale = (await runCommand(app, s.staff, 'sale.record', { shopId: s.shopId, customerId, lines: [{ itemId: kettle, qtyMilli: 1000 }], payments: [] })) as { saleId: string };
    const [inv] = await q<{ id: string; total: string }>('select id::text, total_minor::text as total from books.invoice where sale_id = $1', [sale.saleId]);
    return { customerId, saleId: sale.saleId, invoiceId: (inv as { id: string }).id, total: Number((inv as { total: string }).total) };
  };
  const pay = (customerId: string, amountMinor: number) => runCommand(app, s.staff, 'payment.record', { direction: 'in', customerId, method: 'cash', amountMinor });

  const part = await sellOnCredit('Part-paid customer');
  await pay(part.customerId, 4_000);
  const dPart = await proposePaypalLink(app, { session: s.manager }, { invoiceId: part.invoiceId });
  await decide(app, s.owner, dPart, 'approved');
  expect(part.total).toBeGreaterThan(4_000);
  expect((await linkOf(dPart))?.amount_minor).toBe(String(part.total - 4_000)); // the rest, not the invoice's total
  expect((await q<{ purpose: string; invoice_id: string }>('select purpose, invoice_id::text from ops.paypal_link where draft_id = $1', [dPart]))[0]).toEqual({
    purpose: 'invoice',
    invoice_id: part.invoiceId,
  });

  const paidUp = await sellOnCredit('Paid-up customer');
  await pay(paidUp.customerId, paidUp.total);
  const none = await refusal(proposePaypalLink(app, { session: s.manager }, { invoiceId: paidUp.invoiceId }));
  expect([none?.code, none?.fields?.includes('figure')]).toEqual(['invalid', true]);

  const reversed = await sellOnCredit('Reversed customer');
  const dRev = await proposePaypalLink(app, { session: s.manager }, { invoiceId: reversed.invoiceId });
  await runCommand(app, s.owner, 'sale.reverse', { saleId: reversed.saleId, reason: 'entered_in_error' });
  expect((await decide(app, s.owner, dRev, 'approved')).status).toBe('stale');
  expect(await linkOf(dRev)).toBeUndefined();
  const after = await refusal(proposePaypalLink(app, { session: s.manager }, { invoiceId: reversed.invoiceId }));
  expect(after?.code).toBe('invalid');
});

it('the sweep: a database error on one link never blocks the next; two sweeps at once ask PayPal once per link; failed after its attempts; one shop only', async () => {
  const queue = async (name: string) => {
    const d = await proposePaypalLink(app, { session: s.manager }, { customerId: await newCustomer(name, 1_500) });
    await decide(app, s.owner, d, 'approved');
    return d;
  };
  const dBad = await queue('Bad answer customer');
  const dGood = await queue('Good answer customer');
  badRefs.add((await linkOf(dBad))?.id as string);
  await sweep();
  expect(await linkOf(dBad)).toMatchObject({ status: 'queued', attempts: 1, error_code: '23514' });
  expect((await linkOf(dGood))?.status).toBe('sent');
  for (let i = 1; i < MAX_ATTEMPTS; i++) await sweep();
  expect(await linkOf(dBad)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });

  const dRace = await queue('Race customer');
  const raced = (await linkOf(dRace))?.id as string;
  delayMs = 200;
  try {
    await Promise.all([sweep(), sweep(), sweep()]);
  } finally {
    delayMs = 0;
  }
  expect(calls.filter((r) => r.reference === raced).length).toBe(1);
  expect((await linkOf(dRace))?.status).toBe('sent');

  // This shop's sweep never asks PayPal for another shop's queued link.
  const bCustomer = (await runCommand(app, b.owner, 'customer.create', { name: 'B three' })).customerId as string;
  await runCommand(app, b.owner, 'credit.record', { customerId: bCustomer, amountMinor: 2_500 });
  const bDraft = await proposePaypalLink(app, { session: b.manager }, { customerId: bCustomer });
  await decide(app, b.owner, bDraft, 'approved');
  const seen = calls.length;
  await sweep(s);
  expect(calls.length).toBe(seen);
  expect((await q<{ status: string }>('select status from ops.paypal_link where draft_id = $1', [bDraft], b))[0]?.status).toBe('queued');
  await sweep(b);
  expect((await q<{ status: string }>('select status from ops.paypal_link where draft_id = $1', [bDraft], b))[0]?.status).toBe('sent');
});

it('the guards as the roles meet them: the event store (public), the link update branch (jobs, app), the route (jobs)', async () => {
  await ensureSent();
  const [link] = await q<{ id: string; paypal_id: string }>('select id::text, paypal_id from ops.paypal_link where id = $1', [linkId]);
  // A queued link that has failed once (its PayPal answer refused), so its attempts can be seen not to go back.
  const dq = await proposePaypalLink(app, { session: s.manager }, { customerId: await newCustomer('Guard queued customer', 1_200) });
  await decide(app, s.owner, dq, 'approved');
  badRefs.add((await linkOf(dq))?.id as string);
  await sweep();
  const queued = { id: (await linkOf(dq))?.id as string };
  expect((await linkOf(dq))?.attempts).toBe(1);
  const [bLink] = await q<{ id: string; paypal_id: string }>(`select id::text, paypal_id from ops.paypal_link where status = 'sent' limit 1`, [], b);
  const event = (tenant: string, linkRef: string, reference: string, n: string) =>
    withTx(pub, { kind: 'system', tenantId: tenant }, (c) =>
      c.query(
        `insert into ops.payment_event (tenant_id, provider, provider_event_id, kind, reference, link_id, amount_minor, currency, raw_sha256)
         values ($1, 'paypal', $2, 'invoice_paid', $3, $4, 100, 'INR', $5)`,
        [tenant, n, reference, linkRef, sha],
      ),
    );
  const l = link as { id: string; paypal_id: string };
  expect(await sqlstate(event(s.owner.tenantId, l.id, 'INV2-WRONG-REF', 'WH-G1'))).toBe('MS007'); // a wrong reference
  expect(await sqlstate(event(s.owner.tenantId, (queued as { id: string }).id, 'INV2-NOT-SENT', 'WH-G2'))).toBe('MS007'); // a link not yet sent
  const bl = bLink as { id: string; paypal_id: string };
  expect(await sqlstate(event(s.owner.tenantId, bl.id, bl.paypal_id, 'WH-G3'))).toBe('MS007'); // another shop's link
  // The link's update branch: the jobs role moves only a queued link (or a cancel), never back, never what was asked.
  const asJobs = (sql: string, values: unknown[]) => tx(jobs, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, values));
  expect(await sqlstate(asJobs(`update ops.paypal_link set status = 'failed' where id = $1`, [l.id]))).toBe('MS007'); // a sent link
  expect(await sqlstate(asJobs('update ops.paypal_link set attempts = 0 where id = $1', [(queued as { id: string }).id]))).toBe('MS007'); // attempts back
  expect(await sqlstate(asJobs('update ops.paypal_link set amount_minor = 1 where id = $1', [l.id]))).toBe('42501'); // what was asked
  // The app moves a link only under an approved paypal.cancel of this transaction.
  expect(
    await sqlstate(
      tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) => c.query(`update ops.paypal_link set status = 'cancelled' where id = $1`, [(queued as { id: string }).id])),
    ),
  ).toBe('MS007');
  // The route: only the jobs role, only for a link holding that PayPal id.
  expect(await sqlstate(asJobs('insert into ops.paypal_route (paypal_id, tenant_id, link_id) values ($1, $2, $3)', ['INV2-OTHER-ID', s.owner.tenantId, l.id]))).toBe('MS007');
  expect(
    await sqlstate(
      tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query('insert into ops.paypal_route (paypal_id, tenant_id, link_id) values ($1, $2, $3)', [l.paypal_id, s.owner.tenantId, l.id])),
    ),
  ).toBe('42501');
});
