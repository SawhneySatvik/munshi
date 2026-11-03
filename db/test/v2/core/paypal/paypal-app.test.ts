// PayPal live in the app (D-079, sandbox, recorded mode: no network), against the real guards, RLS and roles: the agent
// proposes a PayPal link as overdue udhaar's second fix, a person approves it, PayPal makes it (the jobs role's sweep),
// Munshi drafts the WhatsApp message carrying that very link and a person approves it on its own; PayPal's paid notice
// is a watcher finding whose fix a person approves into the books. Every test makes its own customers and links (the
// red-proof harness runs each alone). What is proved:
//   PP-APP1 the link draft (the finding's PayPal fix) writes nothing before approval: no book row, no link, no message,
//           no PayPal call; the same finding's default fix is still the reminder;
//   PP-APP2 approval creates the link under the approver, and calls nothing; once PayPal has made the link, the
//           customer's message is drafted only, and only its own approval writes it, under that approver, once (two
//           approvals at once: one writes, the other is stale);
//   PP-APP3 counter staff cannot propose or approve a PayPal link, cannot draft its message, and read nothing of PayPal;
//   PP-APP4 a paid notice writes no book row and no draft, and holds back a new link; the watcher raises it, its fix
//           drafts payment.record, and only a person's approval writes it, after which the finding resolves;
//   PP-APP5 the amount is the cited cell (the link's, the message's words), and a draft citing any other cell is refused;
//   PP-APP7 core's own registries hold PayPal (commands, reads, the watcher, the recipe commands and trace labels);
//   PP-APP8 a message names its link: one waiting for a link since cancelled goes stale, never carrying the link asked
//           for again (which may cite the very same cell), and the new link is its own to message;
//   PP-APP9 a paid link holds back a new link only until the books catch up: a later payment by any means lifts it;
//   PP-APP10 an invoice's link: its message cites the invoice's open credit and speaks of a bill.
// PP-APP6 (the sandbox label wherever a link shows) is the web suite's (apps/web/test/paypal-app.test.tsx).
import { createHash, randomUUID } from 'node:crypto';
import {
  type CoreError,
  decide,
  mayReadIn,
  proposeDraft,
  READ_ROLES,
  renderCell,
  resolveRef,
  runCommand,
  runWatchers,
  switchCapability,
  WATCHERS,
  withPage,
} from '@munshi/core';
import {
  linkOfDraft,
  messagePaypalLink,
  paypalAuthority,
  proposePaypalCancel,
  proposePaypalLink,
  proposeRecordPaypal,
  receivePaypalPaid,
  sweepShopPaypal,
  wirePayPal,
} from '@munshi/core/paypal';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type LinkRequest, type PayPal, recordedPayPal } from '../../../../../packages/adapters/payments/index.ts';
import { type Recipe, RECIPE_COMMANDS, RECIPES } from '../../../../../packages/agent/src/recipes.ts';
import { draftFix, TRACE_LABELS } from '../../../../../packages/agent/src/run.ts';
import { COMMANDS } from '../../../../../packages/core/src/commands.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { type CellRef, formatRef, parseRef } from '../../../../../packages/core/src/read.ts';
import { mintIn } from '../../../../../packages/core/src/snapshots.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { type Counter, item, register } from '../counter/counter.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let kettle = '';
const calls: LinkRequest[] = [];

const recorded = recordedPayPal();
const spy: PayPal = {
  mode: recorded.mode,
  label: recorded.label,
  invoice: (id) => recorded.invoice(id),
  verifyWebhook: (raw, h) => recorded.verifyWebhook(raw, h),
  createLink: async (r) => {
    calls.push(r);
    return recorded.createLink(r);
  },
  cancel: (id, requestId) => recorded.cancel(id, requestId),
};

const OPENING = 84_000;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = db.as('munshi_jobs');
  wirePayPal(spy);
  s = await smallShop(app, 'PP-APP');
  for (const cap of ['credit', 'messaging'] as const) await switchCapability(app, s.owner, cap, true).catch(() => {});
  // An invoice for a sale on credit needs the shop's GST registration and a taxed item (PP-APP10).
  const counter: Counter = { owner: s.owner, manager: s.manager, staff: s.staff, shopId: s.shopId, tenant: s.owner.tenantId };
  await register(app, counter, 'regular', 'PA');
  kettle = await item(app, counter, { name: 'Electric kettle', priceMinor: 10_000, taxClass: 'general_18', hsn: '8516' });
  await db.sabotage();
}, 240_000);
afterAll(async () => {
  wirePayPal(null);
  await db?.close();
});

const q = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await tx(app, { tenant_id: s.owner.tenantId }, (c) => c.query(sql, values))).rows as T[];
type Counts = { books: number; messages: number; payments: number; drafts: number; links: number; events: number; deliveries: number };
const counts = async () =>
  (
    await q<Counts>(
      `select (select count(*) from books.payment)::int + (select count(*) from books.credit_entry)::int + (select count(*) from books.journal_entry)::int
                + (select count(*) from books.outbound_message)::int as books,
              (select count(*) from books.outbound_message)::int as messages, (select count(*) from books.payment)::int as payments,
              (select count(*) from approval.draft)::int as drafts, (select count(*) from ops.paypal_link)::int as links,
              (select count(*) from ops.payment_event)::int as events, (select count(*) from ops.delivery)::int as deliveries`,
    )
  )[0] as Counts;
const refusal = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as CoreError & { code: string; sqlstate?: string });
const run = async (session = s.owner) => agentPort({ app, agent: db.as('munshi_agent') }, session, await startRun({ app, agent: db.as('munshi_agent') }, session));
const sha = createHash('sha256').update('recorded notice').digest('hex');
let phones = 0;

/** A customer reachable on WhatsApp (a number, service consent given in person), owing `minor`, overdue when asked. */
async function reachable(name: string, minor: number, overdue = false): Promise<string> {
  const phone = `+9198000003${String(++phones).padStart(2, '0')}`;
  const id = (await runCommand(app, s.owner, 'customer.create', { name, phone })).customerId as string;
  await runCommand(app, s.owner, 'consent.record', { customerId: id, channel: 'whatsapp', purpose: 'service', granted: true, source: 'in_person', noticeVersion: 'v1' });
  if (minor) await runCommand(app, s.owner, 'credit.record', { customerId: id, amountMinor: minor, ...(overdue ? { dueOn: daysAgo(10) } : {}) });
  return id;
}

/** A link for the customer's balance (or an invoice), drafted by the manager, approved by the owner, made by the sweep. */
async function madeLink(target: { customerId: string } | { invoiceId: string }) {
  const draftId = await proposePaypalLink(app, { session: s.manager }, target);
  expect((await decide(app, s.owner, draftId, 'approved')).status).toBe('executed');
  await sweepShopPaypal(jobs, s.owner.tenantId);
  const [l] = await q<{ id: string; figure: string; paypal_id: string; amount_minor: string; status: string }>(
    'select id::text, figure, paypal_id, amount_minor::text, status from ops.paypal_link where draft_id = $1',
    [draftId],
  );
  return { draftId, ...(l as { id: string; figure: string; paypal_id: string; amount_minor: string; status: string }) };
}

/** A paypal_link message drafted by its link's approver: its draft's id. */
async function drafted(linkId: string): Promise<string> {
  const m = await messagePaypalLink(app, s.owner, linkId);
  expect(m.outcome).toBe('drafted');
  return m.draftId as string;
}

const messageOf = async (draftId: string) =>
  (
    await q<{ created_by: string; decided_by: string; command: string; template_code: string; recipient_id: string; body: string; mode: string }>(
      `select m.created_by::text, d.decided_by::text, dr.command, m.template_code, m.recipient_id::text, t.body, v.mode
         from books.outbound_message m
         join approval.decision d on d.tenant_id = m.tenant_id and d.id = m.decision_id
         join approval.draft dr on dr.tenant_id = d.tenant_id and dr.id = d.draft_id
         join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id
         join ops.delivery v on v.tenant_id = m.tenant_id and v.message_id = m.id
        where dr.id = $1`,
      [draftId],
    )
  )[0];

const findingOf = async (kind: string, col: string, value: string) => {
  const r = await run();
  for (const f of (await q<{ id: string }>(`select id::text from ai.finding where kind = $1 and status = 'open'`, [kind])).map((x) => x.id)) {
    const row = await r.port.finding(f);
    const cell = row?.cells[col];
    if (cell?.kind === 'text' && cell.txt === value) return row;
  }
  return null;
};

it('PP-APP7 core’s own registries hold PayPal: its commands, its reads, its watcher, the recipe commands and their trace labels', () => {
  for (const name of ['paypal.request', 'paypal.cancel']) expect(COMMANDS.has(name), name).toBe(true);
  for (const name of ['paypal.event', 'watch.paypal_unrecorded', 'invoice.open_credit']) {
    expect(QUERIES.has(name), name).toBe(true);
    expect(READ_ROLES[name]?.roles, name).not.toContain('staff');
  }
  expect(WATCHERS.find((w) => w.kind === 'paypal_unrecorded')).toMatchObject({ query: 'watch.paypal_unrecorded', needs: 'credit', impact: 'amount' });
  expect(Object.keys(RECIPES)).toContain('paypal_unrecorded');
  for (const c of ['paypal.request', 'payment.record']) {
    expect(RECIPE_COMMANDS as readonly string[], c).toContain(c);
    expect(TRACE_LABELS.has(c), c).toBe(true);
  }
});

it('PP-APP1 the link draft (the finding’s PayPal fix) writes nothing before approval: no book row, no link, no message, no PayPal call', async () => {
  const customer = await reachable('Overdue for a link', OPENING, true);
  await runWatchers(jobs, s.owner.tenantId);
  const f = await findingOf('overdue_credit', 'customer_id', customer);
  expect(f).toBeTruthy();
  if (!f) return;
  const r = await run();
  const read = async (query: string, params: Record<string, unknown>) => (await r.port.read(query, params)) as never;
  // Two fixes for one finding: the reminder by default, a PayPal link when the person picks it.
  expect(await (RECIPES.overdue_credit as Recipe)(f, read)).toMatchObject({ command: 'customer.remind', payload: { template: 'credit_due' } });
  const before = await counts();
  const called = calls.length;
  const fix = await draftFix(f.id, { port: r.port, asOf: daysAgo(0) }, { fix: 'paypal' });
  expect(fix.kind).toBe('proposed');
  if (fix.kind !== 'proposed') return;
  expect(fix.command).toBe('paypal.request');
  expect(fix.payload).toMatchObject({ purpose: 'credit', customerId: customer });
  expect(fix.payloadRefs).toEqual({});
  // It cites the finding's own overdue cell, and its amount is a ref to the customer's current balance cell.
  expect(fix.basedOn).toContainEqual({ snapshotId: f.snapshotId, row: f.row, col: 'overdue' });
  expect(fix.basedOn).toContainEqual(parseRef(String(fix.payload.figure)));
  expect(await counts()).toEqual({ ...before, drafts: before.drafts + 1 });
  expect(calls.length).toBe(called);
  // The run's draft, for the owner whose run it is, waiting for a person.
  const [draft] = await q<{ status: string; finding_id: string; source: string; started_by: string }>(
    `select d.status, d.finding_id::text, d.source, r.started_by::text from approval.draft d join ai.run r on r.tenant_id = d.tenant_id and r.id = d.run_id where d.id = $1`,
    [fix.draftId],
  );
  expect(draft).toEqual({ status: 'proposed', finding_id: f.id, source: 'run', started_by: s.owner.memberId });
});

it('PP-APP2 approval creates the link under the approver and calls nothing; the customer’s message is only drafted once PayPal made the link, and goes once on its own approval', async () => {
  const customer = await reachable('Approved link customer', 23_000);
  const linkDraft = await proposePaypalLink(app, { session: s.manager }, { customerId: customer });
  const [d0] = await q<{ figure: string }>(`select payload ->> 'figure' as figure from approval.draft where id = $1`, [linkDraft]);
  const figure = parseRef(d0?.figure as string) as CellRef;
  // Before approval no message can carry a link: there is none.
  const early = await refusal(
    proposeDraft(app, { session: s.owner }, {
      command: 'customer.remind',
      payload: { customerId: customer, template: 'paypal_link', figure: formatRef(figure), linkId: randomUUID() },
      basedOn: [figure],
      payloadRefs: {},
    }),
  );
  expect([early?.code, early?.fields]).toEqual(['invalid', ['linkId']]);
  const before = await counts();
  const called = calls.length;
  expect((await decide(app, s.manager, linkDraft, 'approved')).status).toBe('executed');
  const linkId = (await linkOfDraft(app, s.manager, linkDraft)) as string;
  const [link] = await q<{ status: string; created_by: string; decided_by: string; customer_id: string; figure: string }>(
    `select l.status, l.created_by::text, d.decided_by::text, l.customer_id::text, l.figure
       from ops.paypal_link l join approval.decision d on d.tenant_id = l.tenant_id and d.id = l.decision_id where l.id = $1`,
    [linkId],
  );
  expect(link).toEqual({ status: 'queued', created_by: s.manager.memberId, decided_by: s.manager.memberId, customer_id: customer, figure: formatRef(figure) });
  expect(await counts()).toEqual({ ...before, links: before.links + 1 });
  expect(calls.length).toBe(called); // the approval's own transaction asked PayPal nothing
  // PayPal has not made it yet: no message, not even its draft.
  expect(await messagePaypalLink(app, s.manager, linkId).catch((e: CoreError) => ({ refused: e.code }))).toEqual({ outcome: 'not_made' });
  expect((await counts()).drafts).toBe(before.drafts);
  await sweepShopPaypal(jobs, s.owner.tenantId);
  expect(calls.slice(called).map((c) => c.requestId)).toEqual([linkDraft]);
  // The approver's own request drafts the paypal_link reminder: proposed only, nothing written, nothing delivered.
  const sent = await messagePaypalLink(app, s.manager, linkId);
  expect(sent.outcome).toBe('drafted');
  const [waiting] = await q<{ status: string; command: string; template: string; link: string; decisions: number }>(
    `select d.status, d.command, d.payload ->> 'template' as template, d.payload ->> 'linkId' as link,
            (select count(*) from approval.decision x where x.draft_id = d.id)::int as decisions
       from approval.draft d where d.id = $1`,
    [sent.draftId],
  );
  expect(waiting).toEqual({ status: 'proposed', command: 'customer.remind', template: 'paypal_link', link: linkId, decisions: 0 });
  expect(await counts()).toMatchObject({ messages: before.messages, deliveries: before.deliveries, books: before.books });
  expect(await messagePaypalLink(app, s.manager, linkId)).toEqual({ outcome: 'waiting' });
  // A second draft for the same link, made directly: two approvals at once write one message, the other goes stale.
  const twin = await proposeDraft(app, { session: s.owner }, {
    command: 'customer.remind',
    payload: { customerId: customer, template: 'paypal_link', figure: formatRef(figure), linkId },
    basedOn: [figure],
    payloadRefs: {},
  });
  const both = await Promise.all([decide(app, s.manager, sent.draftId as string, 'approved'), decide(app, s.owner, twin, 'approved')]);
  expect(both.map((d) => d.status).sort()).toEqual(['executed', 'stale']);
  const [done] = both[0]?.status === 'executed' ? [sent.draftId as string] : [twin];
  const msg = await messageOf(done);
  expect(msg).toMatchObject({ command: 'customer.remind', template_code: 'paypal_link', recipient_id: customer, mode: 'recorded' });
  expect(msg?.created_by).toBe(msg?.decided_by);
  expect(msg?.body).toMatch(/PayPal sandbox link REC-[0-9A-F]{20} \(recorded: nothing was sent to PayPal\)/);
  const after = await counts();
  expect(after).toMatchObject({ messages: before.messages + 1, payments: before.payments, books: before.books + 1 });
  // Once: a second tap says it went, and a further message for the same link is refused at proposal.
  expect(await messagePaypalLink(app, s.manager, linkId)).toEqual({ outcome: 'messaged' });
  const again = await refusal(
    proposeDraft(app, { session: s.owner }, {
      command: 'customer.remind',
      payload: { customerId: customer, template: 'paypal_link', figure: formatRef(figure), linkId },
      basedOn: [figure],
      payloadRefs: {},
    }),
  );
  expect([again?.code, again?.fields]).toEqual(['invalid', ['linkId']]);
  expect((await counts()).messages).toBe(after.messages);
});

it('PP-APP3 counter staff cannot propose or approve a PayPal link, cannot draft its message, and read nothing of PayPal', async () => {
  const customer = await reachable('Staff test customer', 12_000);
  expect((await refusal(proposePaypalLink(app, { session: s.staff }, { customerId: customer })))?.code).toBe('refused');
  const draft = await proposePaypalLink(app, { session: s.manager }, { customerId: customer });
  expect((await refusal(decide(app, s.staff, draft, 'approved')))?.code).toBe('refused');
  expect((await q<{ status: string }>('select status from approval.draft where id = $1', [draft]))[0]?.status).toBe('proposed');
  await decide(app, s.owner, draft, 'rejected', 'not_now');
  expect(await withPage(app, s.staff, (c) => paypalAuthority(c, s.staff.memberId))).toEqual({ canSend: false, canRecord: false });
  expect(await withPage(app, s.staff, (c) => mayReadIn(c, 'paypal.event'))).toBe(false);
  expect((await refusal(withPage(app, s.staff, (c) => mintIn(c, 'watch.paypal_unrecorded', { as_of: daysAgo(0) }))))?.code).toBe('not_for_role');
  // A staff member's "Draft the WhatsApp message" on a made link is refused by core (messagePaypalLink's own check: a
  // message to a customer is the office's), before anything is read or drafted.
  const link = await madeLink({ customerId: customer });
  const before = await counts();
  expect((await refusal(messagePaypalLink(app, s.staff, link.id)))?.code).toBe('refused');
  expect(await counts()).toEqual(before);
});

it('PP-APP4 a paid notice writes no book row and no draft; the watcher raises it, its fix drafts payment.record, and only a person’s approval writes it', async () => {
  const customer = await reachable('Paid by PayPal customer', OPENING);
  const link = await madeLink({ customerId: customer });
  const before = await counts();
  expect(
    await receivePaypalPaid(pub, { eventId: `WH-PP-APP4-${link.id}`, paypalId: link.paypal_id, status: 'PAID', paidMinor: Number(link.amount_minor), currency: 'INR' }, sha),
  ).toBe('stored');
  expect(await counts()).toEqual({ ...before, events: before.events + 1 });
  // Paid by PayPal, the books not showing it yet: no new link for her, by a tap or a run (the card skips her).
  expect((await refusal(proposePaypalLink(app, { session: s.manager }, { customerId: customer })))?.code).toBe('conflict');
  const fresh = await withPage(app, s.owner, async (c) => ({ snapshotId: (await mintIn(c, 'credit.balance', { customer_id: customer })).id, row: 0, col: 'balance' }));
  const direct = await refusal(
    proposeDraft(app, { session: s.owner }, { command: 'paypal.request', payload: { purpose: 'credit', customerId: customer, figure: formatRef(fresh) }, basedOn: [fresh], payloadRefs: {} }),
  );
  expect([direct?.code, direct?.fields]).toEqual(['invalid', ['customerId']]);
  const w = await runWatchers(jobs, s.owner.tenantId);
  const [ev] = await q<{ id: string }>('select id::text from ops.payment_event where link_id = $1', [link.id]);
  const raised = w.raised.filter((f) => f.kind === 'paypal_unrecorded' && f.dedupeKey === `paypal_unrecorded:${ev?.id}`);
  expect(raised).toHaveLength(1);
  expect(await counts()).toEqual({ ...before, events: before.events + 1 }); // the watcher writes no book and no draft
  const r = await run();
  const fix = await draftFix(raised[0]?.findingId as string, { port: r.port, asOf: daysAgo(0) });
  expect(fix).toMatchObject({ kind: 'proposed', command: 'payment.record', payload: { direction: 'in', customerId: customer, method: 'paypal', amountMinor: OPENING } });
  if (fix.kind !== 'proposed') return;
  expect(await withPage(app, s.owner, (c) => resolveRef(c, fix.payloadRefs.amountMinor as CellRef))).toEqual({ kind: 'money', num: String(OPENING), currency: 'INR' });
  expect((await counts()).payments).toBe(before.payments);
  expect((await refusal(decide(app, s.staff, fix.draftId, 'approved')))?.code).toBe('refused');
  expect((await decide(app, s.owner, fix.draftId, 'approved')).status).toBe('executed');
  const paid = await q<{ amount_minor: string; method: string; created_by: string; reference: string }>(
    'select amount_minor::text, method, created_by::text, reference from books.payment where reference = $1',
    [link.paypal_id],
  );
  expect(paid).toEqual([{ amount_minor: String(OPENING), method: 'paypal', created_by: s.owner.memberId, reference: link.paypal_id }]);
  // The books now show it: the next run resolves the finding, and a second "record this payment" is refused.
  expect((await runWatchers(jobs, s.owner.tenantId)).resolved).toContain(raised[0]?.findingId);
  expect((await refusal(proposeRecordPaypal(app, { session: s.owner }, ev?.id as string)))?.code).toBe('conflict');
});

it('PP-APP5 the amount is the cited cell (the link’s, the message’s words), and a draft citing any other cell is refused', async () => {
  const customer = await reachable('Amount test customer', 31_500);
  const other = await reachable('Another customer', 4_400);
  const link = await madeLink({ customerId: customer });
  const cell = await withPage(app, s.owner, (c) => resolveRef(c, parseRef(link.figure) as CellRef));
  expect(cell).toEqual({ kind: 'money', num: '31500', currency: 'INR' });
  expect(link.amount_minor).toBe('31500');
  const message = await drafted(link.id);
  expect((await decide(app, s.owner, message, 'approved')).status).toBe('executed');
  // The words carry the very cell, rendered, where the amount goes (in English and in Hindi).
  const body = (await messageOf(message))?.body ?? '';
  expect(body.split(renderCell(cell as never)).length - 1).toBe(2);
  // Another customer's balance, or a list's balance cell (not the customer's own balance read), as the figure: refused.
  const { otherBalance, listed } = await withPage(app, s.owner, async (c) => {
    const b = await mintIn(c, 'credit.balance', { customer_id: other });
    const o = await mintIn(c, 'credit.balances', { as_of: daysAgo(0) });
    const row = o.rows.findIndex((x) => x.customer_id?.kind === 'text' && x.customer_id.txt === customer);
    return { otherBalance: { snapshotId: b.id, row: 0, col: 'balance' }, listed: { snapshotId: o.id, row, col: 'balance' } };
  });
  const drafts = (await counts()).drafts;
  for (const wrong of [otherBalance, listed]) {
    const e = await refusal(
      proposeDraft(app, { session: s.owner }, { command: 'paypal.request', payload: { purpose: 'credit', customerId: customer, figure: formatRef(wrong) }, basedOn: [wrong], payloadRefs: {} }),
    );
    expect([e?.code, e?.fields?.includes('figure')], formatRef(wrong)).toEqual(['invalid', true]);
  }
  // A message whose figure is not its link's own cell is refused.
  const link2 = await madeLink({ customerId: other });
  const mismatched = await refusal(
    proposeDraft(app, { session: s.owner }, {
      command: 'customer.remind',
      payload: { customerId: other, template: 'paypal_link', figure: formatRef(listed), linkId: link2.id },
      basedOn: [listed],
      payloadRefs: {},
    }),
  );
  expect([mismatched?.code, mismatched?.fields]).toEqual(['invalid', ['linkId']]);
  expect((await counts()).drafts).toBe(drafts + 1); // the other's own link draft only
});

it('PP-APP8 a message names its link: one waiting for a link since cancelled goes stale, never carrying the link asked for again', async () => {
  const customer = await reachable('Cancel and ask again', 18_000);
  const a = await madeLink({ customerId: customer });
  const waitingForA = await drafted(a.id);
  // Settled another way: link A is cancelled (a draft too), then a new link is asked for the same balance.
  const cancel = await proposePaypalCancel(app, { session: s.manager }, a.id);
  expect((await decide(app, s.owner, cancel, 'approved')).status).toBe('executed');
  await sweepShopPaypal(jobs, s.owner.tenantId);
  expect((await q<{ status: string }>('select status from ops.paypal_link where id = $1', [a.id]))[0]?.status).toBe('cancelled');
  const b = await madeLink({ customerId: customer });
  expect(b.figure).toBe(a.figure); // the same day's balance read: the very same cell
  expect(b.paypal_id).not.toBe(a.paypal_id);
  // A's waiting message never carries B: approving it now finds its link gone, and writes nothing.
  const messages = (await counts()).messages;
  expect((await decide(app, s.owner, waitingForA, 'approved')).status).toBe('stale');
  expect((await counts()).messages).toBe(messages);
  // B is its own to message: not "messaged", nothing "waiting"; its message carries B's id.
  const forB = await drafted(b.id);
  expect((await decide(app, s.owner, forB, 'approved')).status).toBe('executed');
  const body = (await messageOf(forB))?.body ?? '';
  expect(body).toContain(b.paypal_id);
  expect(body).not.toContain(a.paypal_id);
});

it('PP-APP9 a paid link holds back a new link only until the books catch up: a later payment by any means lifts it', async () => {
  const customer = await reachable('Paid then owes again', 20_000);
  const link = await madeLink({ customerId: customer });
  expect(
    await receivePaypalPaid(pub, { eventId: `WH-PP-APP9-${link.id}`, paypalId: link.paypal_id, status: 'PAID', paidMinor: 5_000, currency: 'INR' }, sha),
  ).toBe('stored');
  expect((await refusal(proposePaypalLink(app, { session: s.manager }, { customerId: customer })))?.code).toBe('conflict');
  // The shop records a cash payment after PayPal's notice (not by PayPal's reference): the books have caught up.
  await runCommand(app, s.owner, 'payment.record', { direction: 'in', customerId: customer, method: 'cash', amountMinor: 3_000 });
  const again = await proposePaypalLink(app, { session: s.manager }, { customerId: customer }).catch((e: CoreError) => ({ refused: e.code }));
  expect(again, 'a new link may be asked for').toEqual(expect.any(String));
  expect((await q<{ status: string }>('select status from approval.draft where id = $1', [again]))[0]?.status).toBe('proposed');
});

it('PP-APP10 an invoice’s link: its message cites the invoice’s open credit and speaks of a bill', async () => {
  const customer = await reachable('Invoice customer', 0);
  const sale = (await runCommand(app, s.staff, 'sale.record', { shopId: s.shopId, customerId: customer, lines: [{ itemId: kettle, qtyMilli: 1000 }], payments: [] })) as {
    saleId: string;
  };
  const [inv] = await q<{ id: string; total: string }>('select id::text, total_minor::text as total from books.invoice where sale_id = $1', [sale.saleId]);
  const link = await madeLink({ invoiceId: inv?.id as string });
  const [snap] = await q<{ query_name: string }>('select query_name from snap.snapshot where id = $1', [(parseRef(link.figure) as CellRef).snapshotId]);
  expect(snap?.query_name).toBe('invoice.open_credit');
  const message = await drafted(link.id);
  const [payload] = await q<{ figure: string; link: string }>(`select payload ->> 'figure' as figure, payload ->> 'linkId' as link from approval.draft where id = $1`, [message]);
  expect(payload).toEqual({ figure: link.figure, link: link.id });
  expect((await decide(app, s.owner, message, 'approved')).status).toBe('executed');
  const body = (await messageOf(message))?.body ?? '';
  const cell = await withPage(app, s.owner, (c) => resolveRef(c, parseRef(link.figure) as CellRef));
  expect(cell).toEqual({ kind: 'money', num: inv?.total, currency: 'INR' });
  expect(body).toContain(`${renderCell(cell as never)} is still due on a bill of yours`);
  expect(body).toContain('आपके एक बिल पर');
  expect(body).not.toContain('your account');
});
