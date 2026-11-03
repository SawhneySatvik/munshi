// The agent's messaging copy over the real database, through the port the app builds: a run
// writes a campaign's copy and a reply whose figures are ref tokens to cells (offer.detail, inbox.extract…), rendered by
// code when the message is written, never digits (K3); the disclosure line is core's, added by code to the words a run
// wrote, and never the agent's (K4); a voice note's figures are the spans core read off its transcript (EX2). Core's own
// K3/K4/EX2 rules (commands-messaging.ts, inbox.ts) are the ones the agent is wired to. Red-proofs:
// test/v2/sabotage/agent-chat-and-evals.ts.
import { randomUUID } from 'node:crypto';
import { AI_DISCLOSURE, copyRules, createCampaign, decide, formatRef, proposeCampaign, receiveInbound, runCommand, switchCapability } from '@munshi/core';
import { renderCell } from '@munshi/core/read';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type CampaignCopy, writeCampaignCopy } from '../../../../../packages/agent/src/copy.ts';
import { draftReply, type Reply } from '../../../../../packages/agent/src/inbox.ts';
import { prepare, scripted, type Turn } from '../../../../../packages/agent/test/script.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { buys, consent, customer, grant, listed, ROUTE_KEY } from '../messaging/lib.ts';
import { acceptTenant } from '../../gates/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { expectCleanTraces, inboxRun, media, pick } from './lib.ts';

const SUITE = 'w5-messaging';
const SHOP = 'Copy General Store (synthetic)';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let s: Shop;
let offerId: string;

beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  // Test recipients are a real shop's: the shop is a real one, accepted by the operator's seed path.
  s = await smallShop(app, 'Copy', { accept: (id) => acceptTenant(db.admin, id) });
  await switchCapability(app, s.owner, 'campaigns', true);
  await grant(db, s.owner.tenantId, 'whatsapp');
  // Fixed dates, so the read the model is shown (and its recorded turn) is the same on every run.
  offerId = (
    (await runCommand(app, s.owner, 'offer.create', {
      name: 'Diwali offer',
      kind: 'amount_off',
      amountOffMinor: 5000,
      scope: 'all',
      startsAt: '2026-01-01T00:00:00+05:30',
      endsAt: '2031-01-01T00:00:00+05:30',
      published: true,
    })) as { offerId: string }
  ).offerId;
  // One regular, who bought today and agreed to offers: the campaign's audience.
  const p = await customer(app, s.owner);
  await buys(app, s, p);
  await consent(app, s.owner, p, true);
  await db.sabotage();
}, 120_000);
afterAll(() => db?.close());

const rows = async (sql: string, params: unknown[] = []) => (await db.admin.query(sql, params)).rows;
const disclosure = AI_DISCLOSURE.replace('{shop}', SHOP);
const segments = (...segs: [string, { read: number; row: number; col: string }[]][]): Turn => ({ json: { segments: segs.map(([text, refs]) => ({ text, refs })) } });

async function copy(brief: string, turns: Turn[]) {
  const campaignId = await createCampaign(app, s.owner, { name: `Diwali ${randomUUID().slice(0, 8)}`, channel: 'whatsapp', segment: 'bought_within_days', segmentDays: 30, offerId });
  const run = await inboxRun(db, s.owner, 'campaign');
  const script = scripted(SUITE, turns);
  const result = await writeCampaignCopy({ campaignId, offerId, brief }, { port: run.port, deps: script.deps });
  expect(script.left()).toBe(0);
  return { campaignId, run, result };
}

it('a run’s campaign copy carries its figures as ref tokens to cells, never digits; core stores it, and renders each figure from its cell when the approved message is written', async () => {
  const { campaignId, run, result } = await copy('Diwali offer for our regulars', [segments(['Is Diwali har khareed par ⟦1⟧ ki chhoot!', [{ read: 2, row: 0, col: 'amount_off' }]], ['Jaldi aaiye.', []])]);
  expect(result.kind).toBe('written');
  const w = result as Extract<CampaignCopy, { kind: 'written' }>;
  expect(w.refs).toHaveLength(1);
  const [snap] = await rows('select query_name, params from snap.snapshot where id = $1', [w.refs[0]?.snapshotId]);
  expect(snap).toEqual({ query_name: 'offer.detail', params: { offer_id: offerId } });
  expect(w.body).toBe(`Is Diwali har khareed par ${formatRef(w.refs[0] as never)} ki chhoot! Jaldi aaiye.`);
  expect(copyRules(w.body)).toEqual([]);
  expect(w.body.replace(/⟨snap:[^⟩]*⟩/g, '')).not.toMatch(/\p{Nd}/u);
  const [text] = await rows('select t.body, t.author, t.run_id::text as run from ops.campaign k join ops.message_text t on t.id = k.copy_text_id where k.id = $1', [campaignId]);
  expect(text).toEqual({ body: w.body, author: 'run', run: run.runId });

  const decision = await decide(app, s.owner, await proposeCampaign(app, s.owner, campaignId), 'approved');
  expect(decision.status).toBe('executed');
  const sent = await rows(
    'select distinct t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.campaign_id = $1',
    [campaignId],
  );
  const fifty = renderCell({ kind: 'money', num: '5000', currency: 'INR' });
  expect(sent).toEqual([{ body: `Is Diwali har khareed par ${fifty} ki chhoot! Jaldi aaiye.\n\n${disclosure}` }]);
  await expectCleanTraces(db, run.runId, run.events, ['Diwali', 'chhoot']);
});

it('the disclosure line is core’s: the run’s stored words never carry it, and code adds it once, at the end, to every message written from them', async () => {
  const { campaignId, result } = await copy('New biscuits are in', [segments(['Naye biscuit aaye hain, ⟦1⟧ ki bachat bhi!', [{ read: 2, row: 0, col: 'amount_off' }]])]);
  expect(result).toMatchObject({ kind: 'written' });
  const w = result as Extract<CampaignCopy, { kind: 'written' }>;
  const words = AI_DISCLOSURE.split('{shop}')[0]?.trim() as string;
  expect(w.body).not.toContain(words);
  expect((await decide(app, s.owner, await proposeCampaign(app, s.owner, campaignId), 'approved')).status).toBe('executed');
  const [sent] = await rows(
    'select distinct t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.campaign_id = $1',
    [campaignId],
  );
  const fifty = renderCell({ kind: 'money', num: '5000', currency: 'INR' });
  expect(sent?.body).toBe(`Naye biscuit aaye hain, ${fifty} ki bachat bhi!\n\n${disclosure}`);
  expect(sent?.body.split(words)).toHaveLength(2);
  // No word of the line in what the run wrote, in any form.
  for (const word of words.split(/\s+/).filter((x) => /\p{L}/u.test(x) && x !== 'AI')) expect(w.body).not.toContain(word);
});

it('copy with a free digit, a number word, a ref token typed as text or a ref to no read abstains, and core stores nothing', async () => {
  const stock = await inboxRun(db, s.owner).then((r) => r.port.read('stock.on_hand', { item_id: s.biscuits }));
  const typed = formatRef({ snapshotId: stock.snapshotId, row: 0, col: 'on_hand' });
  const cases: [Turn, string][] = [
    [segments(['Flat 50 rupaye off this Diwali!', []]), 'free_digit'],
    [segments(['Pachaas rupaye ki chhoot!', []]), 'number_word'],
    [segments([`Sirf ${typed} bache hain!`, []]), 'free_digit'],
    [segments(['Sirf ⟦1⟧ ki chhoot!', [{ read: 7, row: 0, col: 'amount_off' }]]), 'unresolved'],
  ];
  for (const [turn, rule] of cases) {
    const { campaignId, run, result } = await copy(`The offer, said a way that breaks ${rule}`, [turn]);
    expect(result.kind, rule).toBe('abstain');
    expect((result as { missing: string[] }).missing, rule).toContain(rule);
    expect(await rows('select copy_text_id from ops.campaign where id = $1', [campaignId])).toEqual([{ copy_text_id: null }]);
    expect(await rows('select count(*)::int as n from ops.message_text where run_id = $1', [run.runId])).toEqual([{ n: 0 }]);
  }
});

it('a voice note’s figures are the spans core read off its transcript; the run’s reply cites those cells, proposes message.reply, and the approved message renders them', async () => {
  const p = await customer(app, s.owner);
  await listed(app, s.owner, p);
  const note = (await receiveInbound(pub, ROUTE_KEY, { providerMessageId: `wamid.${randomUUID()}`, from: p.phone.slice(1), kind: 'audio', text: null })) as string;
  const said = 'Bhaiya maine 1,500 rupaye bhej diye, 3 packet biscuit bhi bhejna';
  const run = await inboxRun(db, s.owner);
  const script = scripted(SUITE, [
    { transcript: said },
    {
      json: {
        figures: [
          { field: 'amount', words: pick(said, '1,500 rupaye') },
          { field: 'quantity', words: pick(said, '3') },
          { field: 'amount', words: pick(said, 'bhej') }, // no figure: core fills nothing
        ],
      },
    },
    segments(['Shukriya ji, aapke ⟦1⟧ mil gaye; biscuit kal bhej denge.', [{ read: 1, row: 0, col: 'amount' }]]),
  ]);
  const result = await draftReply({ messageId: note, customerId: p.customer }, { port: run.port, deps: script.deps, media: media('ask-hi.wav') });
  expect(script.left()).toBe(0);
  expect(result.kind).toBe('proposed');
  const r = result as Extract<Reply, { kind: 'proposed' }>;
  expect(await rows('select transcript from ops.inbound_message where id = $1', [note])).toEqual([{ transcript: said }]);
  const extracts = await rows(
    `select e.field, e.num::text as num, e.parsed_as, substr(i.transcript, e.span_start + 1, e.span_end - e.span_start) as span
       from ops.inbound_extract e join ops.inbound_message i on i.tenant_id = e.tenant_id and i.id = e.message_id where e.run_id = $1 order by e.span_start`,
    [run.runId],
  );
  expect(extracts).toEqual([
    { field: 'amount', num: '150000', parsed_as: 'digits', span: '1,500' },
    { field: 'quantity', num: '3000', parsed_as: 'digits', span: '3' },
  ]);
  const cited = { snapshotId: r.extracts, row: 0, col: 'amount' };
  expect(r.body).toBe(`Shukriya ji, aapke ${formatRef(cited)} mil gaye; biscuit kal bhej denge.`);
  const [draft] = await rows('select command, payload, based_on, run_id::text as run from approval.draft where id = $1', [r.draftId]);
  expect(draft).toMatchObject({ command: 'message.reply', run: run.runId, payload: { messageId: note, customerId: p.customer, textId: r.textId } });
  expect(draft.based_on).toContainEqual(cited);
  expect((await rows('select tainted from ai.run where id = $1', [run.runId]))[0]?.tainted).toBe(true);

  expect((await decide(app, s.owner, r.draftId, 'approved')).status).toBe('executed');
  const [sent] = await rows(
    'select t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.reply_to_id = $1',
    [note],
  );
  const amount = renderCell({ kind: 'money', num: '150000', currency: 'INR' });
  expect(sent).toEqual({ body: `Shukriya ji, aapke ${amount} mil gaye; biscuit kal bhej denge.\n\n${disclosure}` });
  await expectCleanTraces(db, run.runId, run.events, ['Bhaiya', 'rupaye', 'Shukriya', '1,500']);
});
