// Campaigns, reminders and replies through core (BLUEPRINT §8.6, §2.6): every message to a customer is a book written
// only by an approved draft. K2 (of five planted recipients exactly one is messaged), K3 (copy carries refs only), K4
// (a run's copy ends with the disclosure line, written in one place), K5 (the whole audience is rechecked at approval),
// K6 (consent belongs to the contact that gave it), consent by purpose (marketing for a campaign, service for a
// reminder; the database's refusal reaches the caller as a code), and a reply to an inbox message. Red-proofs:
// test/v2/sabotage/core-messaging.ts.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  AI_DISCLOSURE,
  type CellRef,
  CoreError,
  createCampaign,
  createJobsPool,
  decide,
  formatRef,
  mintSnapshot,
  proposeCampaign,
  proposeDraft,
  runCommand,
  runDueJobs,
  type Session,
  sendTest,
  switchCapability,
  writeCopy,
  writeReply,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { refused } from '../../gates/lib.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { buys, consent, customer, deliveryOf, grant, inbound, listed, newPhone, type Outbox, type Person, wireRecorded } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let outbox: Outbox | undefined;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = createJobsPool(jobsUrl(db), 4);
  s = await smallShop(app, 'Campaign');
  await switchCapability(app, s.owner, 'campaigns', true); // a kirana's pack has messaging, not campaigns
  await grant(db, s.owner.tenantId, 'whatsapp'); // so the shop can list test recipients, whose messages then reach it
  await db.sabotage();
});
afterEach(() => {
  outbox?.close();
  outbox = undefined;
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});

const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => (await db.admin.query<T>(sql, params)).rows;
const onHand = async (): Promise<CellRef> => {
  const snap = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'stock.on_hand', { item_id: s.biscuits });
  return { snapshotId: snap.id, row: 0, col: 'on_hand' };
};
const newCampaign = (by: Session = s.owner, channel: 'whatsapp' | 'instagram' = 'whatsapp') =>
  createCampaign(app, by, { name: `Campaign ${randomUUID().slice(0, 8)}`, channel, segment: 'bought_within_days', segmentDays: 30 });
// A customer who bought today and gave marketing consent: in every bought_within_days audience.
const regular = async () => {
  const p = await customer(app, s.owner);
  await buys(app, s, p);
  await consent(app, s.owner, p, true);
  return p;
};
const messagesOf = (campaign: string) => q<{ recipient_id: string }>('select recipient_id from books.outbound_message where campaign_id = $1 order by recipient_id', [campaign]);
const eraseContact = (p: Person) =>
  tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [
      p.contact,
      s.owner.memberId,
    ]),
  );
const audience = async (campaign: string) =>
  (await mintSnapshot(app, { kind: 'member', session: s.owner }, 'campaign.audience', { campaign_id: campaign })).rows.map(
    (r) => (r.customer_id as { txt: string }).txt,
  );
it('K2 a campaign reaches only the consenting customer of five planted ones: never asked, withdrawn, STOP after consent, erased', async () => {
  const [consenting, never, withdrew, stopped, erased] = await Promise.all([1, 2, 3, 4, 5].map(() => customer(app, s.owner)));
  for (const p of [consenting, never, withdrew, stopped, erased] as Person[]) await buys(app, s, p);
  for (const p of [consenting, withdrew, stopped, erased] as Person[]) await consent(app, s.owner, p, true);
  await consent(app, s.owner, withdrew as Person, false);
  // The STOP takes effect at once, before anyone records the withdrawal; Meta's number comes without the plus (W8).
  await listed(app, s.owner, stopped as Person);
  expect(await inbound(pub, (stopped as Person).phone.slice(1), 'STOP')).not.toBeNull();
  await eraseContact(erased as Person);

  const campaign = await newCampaign();
  await writeCopy(app, { session: s.owner }, campaign, 'Diwali ki shubhkamnayein! Is hafte naye biscuit aaye hain.');
  const draft = await proposeCampaign(app, s.owner, campaign);
  const d = await decide(app, s.owner, draft, 'approved');
  expect(d.status).toBe('executed');
  expect((await messagesOf(campaign)).map((r) => r.recipient_id)).toEqual([(consenting as Person).customer]);
  outbox = wireRecorded();
  await runDueJobs(jobs, new Date(), ['outbox']);
  expect(outbox.calls.map((m) => m.to)).toEqual([(consenting as Person).phone]);
  expect((await q<{ status: string }>('select status from ops.campaign where id = $1', [campaign]))[0]?.status).toBe('approved');
});

it('K3 copy carries figures as refs only: a typed number, a number word or a bare handle is refused, a ref to a cell passes and renders', async () => {
  const campaign = await newCampaign();
  for (const bad of ['Flat 50% off this week', 'Paanch sau ki bachat!', 'Get ⟦1⟧ off']) {
    const e = (await writeCopy(app, { session: s.owner }, campaign, bad).catch((err) => err)) as CoreError;
    expect([e.code, e.fields], bad).toEqual(['invalid', ['body']]);
  }
  const p = await regular();
  const stock = await onHand(); // after the sale: a later sale would move the cell and stale the draft
  await writeCopy(app, { session: s.owner }, campaign, `Sirf ${formatRef(stock)} bache hain, jaldi aaiye!`);
  const draft = await proposeCampaign(app, s.owner, campaign);
  const cited = (await q<{ based_on: CellRef[] }>('select based_on from approval.draft where id = $1', [draft]))[0]?.based_on;
  expect(cited).toEqual(expect.arrayContaining([stock]));
  expect((await decide(app, s.owner, draft, 'approved')).status).toBe('executed');
  const body = (
    await q<{ body: string }>(
      'select t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.campaign_id = $1 and m.recipient_id = $2',
      [campaign, p.customer],
    )
  )[0]?.body;
  expect(body).toMatch(/^Sirf \d+ packs bache hain, jaldi aaiye!$/);
});

it('K3 a ref in the copy that the draft does not cite is refused at proposal', async () => {
  await regular();
  const campaign = await newCampaign();
  const stock = await onHand();
  const text = await writeCopy(app, { session: s.owner }, campaign, `Sirf ${formatRef(stock)} bache hain!`);
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) => c.query(`update ops.campaign set status = 'proposed' where id = $1`, [campaign]));
  const aud = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'campaign.audience', { campaign_id: campaign });
  const sha = (await q<{ sha: string }>(`select encode(body_sha256, 'hex') as sha from ops.message_text where id = $1`, [text]))[0]?.sha;
  const e = (await proposeDraft(
    app,
    { session: s.owner },
    { command: 'campaign.send', payload: { campaignId: campaign, audienceId: aud.id, copyTextId: text, copySha256: sha }, basedOn: [{ snapshotId: aud.id, row: 0, col: '_count' }] },
  ).catch((err) => err)) as CoreError;
  expect([e.code, e.fields]).toEqual(['invalid', ['copyTextId']]);
});

it('K4 a run’s copy ends with the disclosure line, written by code, in the approved message and the test send alike', async () => {
  await regular();
  const runId = randomUUID();
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'campaign', 'customers')`, [s.owner.tenantId, runId]),
  );
  const campaign = await newCampaign();
  await writeCopy(app, { session: s.owner, runId }, campaign, 'Naye biscuit aaye hain, zaroor aaiye!');
  const line = AI_DISCLOSURE.replace('{shop}', 'Campaign General Store (synthetic)');
  const test = await sendTest(app, s.owner, campaign);
  expect((await q<{ body: string }>('select t.body from ops.delivery d join ops.message_text t on t.id = d.test_text_id where d.id = $1', [test]))[0]?.body).toBe(
    `Naye biscuit aaye hain, zaroor aaiye!\n\n${line}`,
  );
  expect((await decide(app, s.owner, await proposeCampaign(app, s.owner, campaign), 'approved')).status).toBe('executed');
  const sent = await q<{ body: string; author: string; run_id: string }>(
    'select distinct t.body, t.author, t.run_id::text from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.campaign_id = $1',
    [campaign],
  );
  expect(sent).toEqual([{ body: `Naye biscuit aaye hain, zaroor aaiye!\n\n${line}`, author: 'run', run_id: runId }]);
});

// Every source file of the product (packages and apps, not tests): the disclosure's words are written in one of them.
const ROOT = path.join(import.meta.dirname, '..', '..', '..', '..', '..');
function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = path.join(dir, name);
    if (name === 'node_modules' || name === '.next' || name === 'test' || name.endsWith('.test.ts')) return [];
    if (statSync(abs).isDirectory()) return sources(abs);
    return /\.(ts|tsx|json)$/.test(name) ? [{ file: path.relative(ROOT, abs), text: readFileSync(abs, 'utf8') }] : [];
  });
}

it('K4 the disclosure line’s words are written in one source file only, core’s, and never in the agent', () => {
  const words = AI_DISCLOSURE.split('{shop}')[0]?.trim() as string;
  const files = [...sources(path.join(ROOT, 'packages')), ...sources(path.join(ROOT, 'apps'))];
  if (sabotageIs('v2-f3a-k4-scan')) files.push({ file: 'packages/agent/src/copy.ts', text: `const footer = '${words}';` });
  expect(files.length).toBeGreaterThan(50);
  expect(files.filter((f) => f.text.includes(words)).map((f) => f.file)).toEqual(['packages/core/src/commands-messaging.ts']);
});

it('K5 an audience of the same size but other customers at approval makes the campaign draft stale, and nothing is sent', async () => {
  const a = await regular();
  const b = await customer(app, s.owner);
  await buys(app, s, b);
  const campaign = await newCampaign();
  await writeCopy(app, { session: s.owner }, campaign, 'Is hafte naya maal aaya hai.');
  const before = await audience(campaign);
  const draft = await proposeCampaign(app, s.owner, campaign);
  await consent(app, s.owner, a, false);
  await consent(app, s.owner, b, true);
  const now = await audience(campaign);
  expect([now.length, now.includes(b.customer), now.includes(a.customer), before.includes(a.customer)]).toEqual([before.length, true, false, true]);
  const d = await decide(app, s.owner, draft, 'approved');
  expect(d.status).toBe('stale');
  expect(await messagesOf(campaign)).toEqual([]);
});

it('K6 a customer re-linked to a new phone drops out of the audience until the new phone consents', async () => {
  const p = await regular();
  const campaign = await newCampaign();
  expect(await audience(campaign)).toContain(p.customer);
  const phone = newPhone();
  const contact = await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId, command: 'contact.link' }, async (c) => {
    const k = (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Synthetic customer', $2) returning id`, [s.owner.tenantId, phone]))
      .rows[0]?.id as string;
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [s.owner.tenantId, p.customer, k]);
    return k;
  });
  expect(await audience(campaign)).not.toContain(p.customer);
  await consent(app, s.owner, { ...p, contact, phone }, true);
  expect(await audience(campaign)).toContain(p.customer);
});

it('consent by purpose: a reminder needs service consent, and the database’s refusal reaches the caller as a code; a campaign’s audience needs marketing', async () => {
  const p = await customer(app, s.owner);
  await buys(app, s, p);
  await runCommand(app, s.owner, 'credit.record', { customerId: p.customer, amountMinor: 45_000 });
  await consent(app, s.owner, p, true, 'marketing');
  const remind = async () => {
    const snap = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'credit.balance', { customer_id: p.customer });
    const figure = { snapshotId: snap.id, row: 0, col: 'balance' };
    return proposeDraft(app, { session: s.owner }, { command: 'customer.remind', payload: { customerId: p.customer, template: 'credit_due', figure: formatRef(figure) }, basedOn: [figure] });
  };
  const draft = await remind();
  const e = (await decide(app, s.owner, draft, 'approved').catch((err) => err)) as CoreError;
  expect(e).toBeInstanceOf(CoreError);
  expect([e.code, e.sqlstate, e.message]).toEqual(['refused', 'MS007', 'Not allowed.']);
  expect((await q('select 1 from books.outbound_message where recipient_id = $1', [p.customer])).length).toBe(0);
  await consent(app, s.owner, p, true, 'service');
  const ok = await decide(app, s.owner, await remind(), 'approved');
  expect(ok.status).toBe('executed');
  const body = (
    await q<{ body: string; template_code: string }>(
      'select t.body, m.template_code from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.recipient_id = $1',
      [p.customer],
    )
  )[0];
  expect(body).toEqual({ body: 'Campaign General Store (synthetic): a reminder that ₹450 is due on your account.', template_code: 'credit_due' });

  // Service consent alone does not put a customer in a campaign's audience.
  const q2 = await customer(app, s.owner);
  await buys(app, s, q2);
  await consent(app, s.owner, q2, true, 'service');
  expect(await audience(await newCampaign())).not.toContain(q2.customer);
});

it('a reply goes to the customer whose phone wrote, under an approved draft, within the 24 hours after the message', async () => {
  const p = await customer(app, s.owner);
  await listed(app, s.owner, p);
  const msg = (await inbound(pub, p.phone.slice(1), 'Kya kal dukaan khuli hai?')) as string;
  const extract = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'inbox.extract', { message_id: msg });
  const basedOn = [{ snapshotId: extract.id, row: 0, col: '_count' }];
  const text = await writeReply(app, { session: s.owner }, 'Haan ji, subah se khuli hai.');
  const sha = (await q<{ sha: string }>(`select encode(body_sha256, 'hex') as sha from ops.message_text where id = $1`, [text]))[0]?.sha;
  const stranger = await customer(app, s.owner);
  const wrong = await refused(proposeDraft(app, { session: s.owner }, { command: 'message.reply', payload: { messageId: msg, customerId: stranger.customer, textId: text, textSha256: sha }, basedOn }));
  expect(wrong.code).toBe('invalid');
  const draft = await proposeDraft(app, { session: s.manager }, { command: 'message.reply', payload: { messageId: msg, customerId: p.customer, textId: text, textSha256: sha }, basedOn });
  expect((await decide(app, s.manager, draft, 'approved')).status).toBe('executed');
  const [m] = await q<{ id: string; reply_to_id: string; window: boolean }>(
    `select m.id, m.reply_to_id, d.not_after = i.received_at + interval '24 hours' as window
       from books.outbound_message m join ops.delivery d on d.tenant_id = m.tenant_id and d.message_id = m.id
       join ops.inbound_message i on i.tenant_id = m.tenant_id and i.id = m.reply_to_id where m.recipient_id = $1`,
    [p.customer],
  );
  expect(m).toMatchObject({ reply_to_id: msg, window: true });
  expect((await deliveryOf(db, m?.id as string)).to_address).toBe(p.phone);
});
