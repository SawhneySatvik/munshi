// W2-A, memory and "why this number", over the real database. MEM-APP1: a person's words with a rejection become a note
// citing that decision, in the approver's transaction. MEM-APP2: words the number grammar reads as a number (a digit of
// any script, a number word) are refused before any transaction, and nothing is written. MEM-APP3: an ended or expired
// note is not in force, and so not in an agent's prompt (the recorded router turn is keyed on the prompt with the one
// note in force: any other note in it misses the fixture). MEM-APP4: on a live shop a customer named in the words is
// kept as "a customer". MEM-APP5: erasing a person's contact blanks the words of every note about them. MEM-APP6:
// Forget is the owner's alone. GRAPH1: the walk from a watcher's figure reaches the decision that wrote its row and who
// approved it. GRAPH2: counter staff see no node reached through a read they may not make, and no figure they may not
// see. GRAPH3: a total ends at its read, whole ("a total read from the books"), a read of the shop's other records ends
// there too, and only a chain that cannot be walked shows the break. GRAPH4: every named read is a source-row read, a
// total or unwalkable, exactly once. GRAPH5: the walk goes two decisions deep, and no further. MEM-APP7: masking and the
// erasure's net over the reviewer's probe. Model turns are hand-written and replayed from
// packages/agent/fixtures/memory (packages/agent/test/script.ts). Red-proofs: test/v2/sabotage/memory-app.ts.
import { createHash } from 'node:crypto';
import {
  businessDate,
  type Cell,
  type CellRef,
  CoreError,
  decide,
  eraseContact,
  forgetNote,
  maskNames,
  mayName,
  mintSnapshot,
  notesFor,
  type Party,
  proposeDraft,
  recordShelfCount,
  runCommand,
  type Session,
  storedSnapshots,
  viewWhy,
  type WhyView,
  withPage,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ask } from '../../../../../packages/agent/src/run.ts';
import { prepare, scripted, WRITING } from '../../../../../packages/agent/test/script.ts';
import { AGGREGATE, SOURCE_ROW, UNWALKABLE } from '../../../../../packages/core/src/queries-memory.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { agentPort, startRun } from '../agent-port.ts';
import { acceptTenant } from '../../gates/lib.ts';
import { liveDb } from '../auth/fixture.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let live: TestDb;
let app: pg.Pool;
let s: Shop;

beforeAll(async () => {
  db = await openTestDb();
  live = await liveDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'MEM');
  await db.sabotage();
  await live.sabotage();
});
afterAll(async () => {
  await db?.close();
  await live?.close();
});

const member = (session: Session) => ({ kind: 'member', session }) as const;

// A reorder of the shop's biscuits, as the owner drafts it: its quantity is the on-hand cell it cites.
async function reorderDraft(pool: pg.Pool, shop: Shop): Promise<string> {
  const snap = await mintSnapshot(pool, member(shop.owner), 'stock.on_hand', { item_id: shop.biscuits });
  const ref = { snapshotId: snap.id, row: 0, col: 'on_hand' };
  const qtyMilli = Number((snap.rows[0]?.on_hand as { num?: string } | undefined)?.num);
  return proposeDraft(
    pool,
    { session: shop.owner },
    { command: 'reorder.place', payload: { supplierId: shop.supplier, lines: [{ itemId: shop.biscuits, qtyMilli }] }, basedOn: [ref], payloadRefs: { 'lines[0].qtyMilli': ref } },
  );
}

// A decision that was made (never stale here): its id.
async function decided(...args: Parameters<typeof decide>) {
  const d = await decide(...args);
  if (d.status === 'stale') throw new Error('the draft went stale');
  return d;
}

// A note's row and its words, as stored (the superuser's view, so RLS hides none).
async function noteOf(admin: pg.Pool, decisionId: string) {
  const { rows } = await admin.query<{ id: string; kind: string; created_by: string; about: string[]; body: string | null; erased: boolean }>(
    `select n.id::text, n.kind, n.created_by::text, n.about, t.body, t.erased_at is not null as erased
       from ai.memory n join ops.message_text t on t.tenant_id = n.tenant_id and t.id = n.text_id where n.decision_id = $1`,
    [decisionId],
  );
  return rows;
}

const counts = async (admin: pg.Pool, tenantId: string) =>
  (
    await admin.query(
      `select (select count(*) from approval.decision where tenant_id = $1)::int as decisions, (select count(*) from ai.memory where tenant_id = $1)::int as notes,
              (select count(*) from ops.message_text where tenant_id = $1)::int as texts, (select count(*) from audit.audit_log where tenant_id = $1)::int as audit`,
      [tenantId],
    )
  ).rows[0];

const refusal = async (p: Promise<unknown>): Promise<CoreError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof CoreError) return err;
    throw err;
  }
  throw new Error('expected a refusal, but it succeeded');
};

it('MEM-APP1 a rejection with words makes a declined note citing its decision, written by the approver in that transaction; an approval with words a preference', async () => {
  const draft = await reorderDraft(app, s);
  const d = await decided(app, s.manager, draft, 'rejected', 'not_relevant', '  Not from Gupta this month;   the shop buys its own  ');
  expect(d.status).toBe('rejected');
  const notes = await noteOf(db.admin, d.decisionId);
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({ kind: 'declined', created_by: s.manager.memberId, body: 'Not from Gupta this month; the shop buys its own' });
  // The draft's supplier is what the note is about, so the supplier's erasure finds it.
  expect(notes[0]?.about).toContain(s.supplier);
  const audit = await db.admin.query(`select actor_id::text, payload from audit.audit_log where action = 'memory.write' and entity_id = $1`, [notes[0]?.id]);
  expect(audit.rows).toEqual([{ actor_id: s.manager.memberId, payload: { kind: 'declined', decision_id: d.decisionId } }]);
  expect((await notesFor(app, s.owner)).map((n) => n.id)).toContain(notes[0]?.id);
  // An approval's words are a standing preference.
  const approved = await decided(app, s.owner, await reorderDraft(app, s), 'approved', undefined, 'Reorder biscuits on Mondays only');
  expect(approved.status).toBe('executed');
  expect((await noteOf(db.admin, approved.decisionId)).map((n) => [n.kind, n.body])).toEqual([['preference', 'Reorder biscuits on Mondays only']]);
  // Counter staff give no note: refused before anything is written.
  const before = await counts(db.admin, s.owner.tenantId);
  const staff = await refusal(decide(app, s.staff, await reorderDraft(app, s), 'rejected', 'other', 'Not today'));
  expect([staff.code, staff.fields]).toEqual(['refused', ['note']]);
  expect(await counts(db.admin, s.owner.tenantId)).toMatchObject({ decisions: before.decisions, notes: before.notes });
});

it('MEM-APP2 words with a digit (Latin or Devanagari), a number word or a handle, in another script or too long, are refused by reason before any transaction, and nothing is written', async () => {
  const draft = await reorderDraft(app, s);
  const before = await counts(db.admin, s.owner.tenantId);
  const cases: [string, string][] = [
    ['Order 5 bags next time', 'note.number'],
    ['पाँच नहीं, ५ बोरी', 'note.number'],
    ['Only ५ बोरी', 'note.number'],
    ['Order five bags next time', 'note.number'],
    // A handle is a figure's place in an answer: never in a note, with a number in it or not.
    ['Ask ⟦1⟧ again', 'note.number'],
    ['Ask ⟦a⟧ again', 'note.number'],
    ['இது வேண்டாம்', 'note.script'],
    ['', 'note.length'],
    ['x'.repeat(161), 'note.length'],
  ];
  for (const [words, why] of cases) {
    const err = await refusal(decide(app, s.owner, draft, 'rejected', 'other', words));
    // Core's own check refused it, before the database saw anything (no SQLSTATE).
    expect([err.code, err.fields, err.sqlstate], words).toEqual(['invalid', [why], undefined]);
  }
  expect(await counts(db.admin, s.owner.tenantId)).toEqual(before);
  const { rows } = await db.admin.query('select status from approval.draft where id = $1', [draft]);
  expect(rows[0]?.status).toBe('proposed');
});

it('MEM-APP3 an ended or expired note is not in force and not in the prompt; the note in force opens it; staff are given none', async () => {
  const m = await smallShop(app, 'MEM3');
  const kept = await decided(app, m.owner, await reorderDraft(app, m), 'rejected', 'not_now', 'Ask before ordering from this supplier');
  const ended = await decided(app, m.owner, await reorderDraft(app, m), 'rejected', 'other', 'An old wish the owner forgot');
  const expired = await decided(app, m.owner, await reorderDraft(app, m), 'rejected', 'other', 'A wish whose time ran out');
  const [keptNote] = await noteOf(db.admin, kept.decisionId);
  await forgetNote(app, m.owner, (await noteOf(db.admin, ended.decisionId))[0]?.id as string);
  await db.admin.query(`update ai.memory set valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' where decision_id = $1`, [expired.decisionId]);
  expect((await notesFor(app, m.owner)).map((n) => [n.kind, n.text])).toEqual([['declined', 'Ask before ordering from this supplier']]);
  expect(await notesFor(app, m.staff)).toEqual([]);
  // The router's turn is recorded for a prompt opened by exactly that one note: another note in it misses the fixture.
  prepare('memory');
  const { deps } = scripted('memory', [{ json: { desk: 'none' } }]);
  const runId = await startRun({ app, agent: db.as('munshi_agent') }, m.owner);
  const run = agentPort({ app, agent: db.as('munshi_agent') }, m.owner, runId);
  // The run is given the notes in force itself: the test port, like the app's, gives none in recorded mode.
  const port = { ...run.port, memory: () => notesFor(app, m.owner) };
  const { events } = run;
  expect(await ask('Should I stock a new brand of tea?', { port, asOf: '2026-11-03', deps })).toEqual({ kind: 'abstain', specialist: null, missing: ['out_of_scope'] });
  expect(events[0]).toMatchObject({ kind: 'read', label: 'memory', ids: [keptNote?.id] });
  // The note is in the prompt: the same question with no note in force is not the recorded request.
  if (!WRITING) {
    const bare = agentPort({ app, agent: db.as('munshi_agent') }, m.owner, await startRun({ app, agent: db.as('munshi_agent') }, m.owner));
    const reply = await ask('Should I stock a new brand of tea?', { port: { ...bare.port, memory: async () => [] }, asOf: '2026-11-03', deps });
    expect(reply).toEqual({ kind: 'abstain', specialist: null, missing: ['model_error'] });
  }
});

it("MEM-APP4 on a live shop a customer named in the words is kept as their role, and the note is about them", async () => {
  const lapp = live.as('munshi_app');
  const shop = await smallShop(lapp, 'MEM4', { accept: (t) => acceptTenant(live.admin, t) });
  const ravi = (await runCommand(lapp, shop.owner, 'customer.create', { name: 'Ravi Kumar' })).customerId as string;
  const d = await decided(lapp, shop.owner, await reorderDraft(lapp, shop), 'rejected', 'other', 'Ravi Kumar asked us to hold this; ask Ravi soon');
  const [note] = await noteOf(live.admin, d.decisionId);
  expect(note?.body).toBe('a customer asked us to hold this; ask a customer soon');
  expect(note?.about).toContain(ravi);
  // The same words on a shop that is not live are kept as typed.
  const raviHere = (await runCommand(app, s.owner, 'customer.create', { name: 'Ravi Kumar' })).customerId as string;
  const kept = await decided(app, s.owner, await reorderDraft(app, s), 'rejected', 'other', 'Ravi Kumar asked us to hold this');
  const [plain] = await noteOf(db.admin, kept.decisionId);
  expect(plain?.body).toBe('Ravi Kumar asked us to hold this');
  expect(plain?.about).toContain(raviHere);
});

it("MEM-APP5 erasing a person's contact blanks the words of every note about them and ends them in force; other notes stay", async () => {
  const meera = (await runCommand(app, s.owner, 'customer.create', { name: 'Meera Shah' })).customerId as string;
  const about = await decided(app, s.owner, await reorderDraft(app, s), 'rejected', 'other', 'Meera Shah wants the large pack instead');
  const other = await decided(app, s.owner, await reorderDraft(app, s), 'rejected', 'other', 'Keep the shelf by the door for tea');
  const [aboutNote] = await noteOf(db.admin, about.decisionId);
  const [otherNote] = await noteOf(db.admin, other.decisionId);
  expect(aboutNote?.about).toContain(meera);
  const contact = (await db.admin.query('select contact_id::text as id from books.party_contact where customer_id = $1', [meera])).rows[0]?.id as string;
  // Only the owner erases a person.
  expect((await refusal(eraseContact(app, s.manager, contact))).code).toBe('refused');
  expect(await eraseContact(app, s.owner, contact)).toEqual({ notes: 1 });
  expect((await noteOf(db.admin, about.decisionId))[0]).toMatchObject({ body: null, erased: true });
  const inForce = (await notesFor(app, s.owner)).map((n) => n.id);
  expect(inForce).not.toContain(aboutNote?.id);
  expect(inForce).toContain(otherNote?.id);
  // The safety net: a note that names them in its words is blanked though its `about` is empty (planted as the app
  // writes a note, the owner's own words in the same transaction).
  const ravi = (await runCommand(app, s.owner, 'customer.create', { name: 'ravi kumar' })).customerId as string;
  const plain = await decided(app, s.owner, await reorderDraft(app, s), 'rejected', 'other');
  const planted = await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, async (c) => {
    const text = (await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'member', '\\x00') returning id`, [s.owner.tenantId, 'ravi wants credit stopped'])).rows[0]?.id;
    return (
      await c.query<{ id: string }>(
        `insert into ai.memory (tenant_id, kind, text_id, decision_id, about, created_by, created_txid, valid_to)
         values ($1, 'declined', $2, $3, '[]', $4, 0, now() + interval '30 days') returning id::text`,
        [s.owner.tenantId, text, plain.decisionId, s.owner.memberId],
      )
    ).rows[0]?.id as string;
  });
  expect((await noteOf(db.admin, plain.decisionId))[0]).toMatchObject({ about: [], body: 'ravi wants credit stopped' });
  const raviContact = (await db.admin.query('select contact_id::text as id from books.party_contact where customer_id = $1', [ravi])).rows[0]?.id as string;
  await eraseContact(app, s.owner, raviContact);
  expect((await noteOf(db.admin, plain.decisionId))[0]).toMatchObject({ body: null, erased: true });
  expect((await notesFor(app, s.owner)).map((n) => n.id)).not.toContain(planted);
  expect((await notesFor(app, s.owner)).map((n) => n.id)).toContain(otherNote?.id);
});

// The reviewer's probe (W2-A fix cycle): misses to mask, and ordinary words that must keep their meaning.
const PROBE_PARTIES: Party[] = [
  { name: 'Sugar Point', party: 'sugar', role: 'customer' },
  { name: 'ravi kumar', party: 'ravi', role: 'customer' },
  { name: 'Om Prakash', party: 'om', role: 'customer' },
  { name: 'Gupta Traders', party: 'gupta', role: 'supplier' },
  { name: 'Fresh Mart', party: 'fresh', role: 'supplier' },
  { name: 'Sunny', party: 'sunny', role: 'customer' },
];

it("MEM-APP7 a live shop's note masks a whole name or a first name, with a name's suffixes, any case, and keeps ordinary words; an erasure's net catches what masking leaves", () => {
  const probe: [string, string, string[]][] = [
    ['ravi wants the large pack', 'a customer wants the large pack', ['ravi']],
    ['Ask Om before giving credit', 'Ask a customer before giving credit', ['om']],
    ['Guptaji is slow', 'a supplier is slow', ['gupta']],
    ['Gupta-bhai said wait', 'a supplier said wait', ['gupta']],
    ["Ravi's tab is long", "a customer's tab is long", ['ravi']],
    ['Ask Ravi Kumar first', 'Ask a customer first', ['ravi']],
    // Ordinary words keep their meaning.
    ['Keep sugar stocked before Diwali', 'Keep sugar stocked before Diwali', []],
    ['Only fresh stock please', 'Only fresh stock please', []],
    ['Sell on sunny days', 'Sell on sunny days', []],
    // A Devanagari spelling of a name stored in Latin letters is not masked at write ...
    ['गुप्ता जी से मत लो', 'गुप्ता जी से मत लो', []],
  ];
  for (const [words, kept, named] of probe) expect(maskNames(words, PROBE_PARTIES, true), words).toEqual({ words: kept, named });
  // ... but an erasure of Gupta's contact blanks it: a word in another script may spell the name.
  expect(mayName('गुप्ता जी से मत लो', 'Gupta Traders')).toBe(true);
  for (const words of ['ravi wants credit stopped', 'Ravi-ji asked', 'RAVI paid']) expect(mayName(words, 'ravi kumar'), words).toBe(true);
  expect(mayName('Keep the shelf by the door for tea', 'ravi kumar')).toBe(false);
  // A shop that is not live keeps the words as typed, and still finds who they name.
  expect(maskNames('ravi wants the large pack', PROBE_PARTIES, false)).toEqual({ words: 'ravi wants the large pack', named: ['ravi'] });
});

it("MEM-APP6 Forget is the owner's alone: a manager and counter staff are refused before any write; the owner's ends the note, audited", async () => {
  const d = await decided(app, s.owner, await reorderDraft(app, s), 'rejected', 'other', 'Never stock the bitter tea again');
  const [note] = await noteOf(db.admin, d.decisionId);
  for (const who of [s.manager, s.staff]) {
    const err = await refusal(forgetNote(app, who, note?.id as string));
    // Core's own check refused it, before the database's (no SQLSTATE).
    expect([err.code, err.sqlstate]).toEqual(['refused', undefined]);
  }
  expect((await db.admin.query('select count(*)::int as n from ai.memory_end where memory_id = $1', [note?.id])).rows[0]?.n).toBe(0);
  expect((await notesFor(app, s.owner)).map((n) => n.id)).toContain(note?.id);
  await forgetNote(app, s.owner, note?.id as string);
  expect((await notesFor(app, s.owner)).map((n) => n.id)).not.toContain(note?.id);
  const end = await db.admin.query(`select ended_by::text, reason from ai.memory_end where memory_id = $1`, [note?.id]);
  expect(end.rows).toEqual([{ ended_by: s.owner.memberId, reason: 'forgotten' }]);
  const audit = await db.admin.query(`select actor_id::text, payload from audit.audit_log where action = 'memory.end' and entity_id = $1`, [note?.id]);
  expect(audit.rows).toEqual([{ actor_id: s.owner.memberId, payload: { reason: 'forgotten' } }]);
});

// ---- why this number

type Node = { kind: string; node: string | null; parent: string | null; label: string; member: string | null; path: string };
const txt = (c: Cell | undefined) => (c?.kind === 'text' ? c.txt : null);
const nodesOf = (v: WhyView): Node[] =>
  v.snapshot.rows.map((r) => ({ kind: txt(r.kind) as string, node: txt(r.node), parent: txt(r.parent), label: txt(r.label) as string, member: txt(r.member_id), path: txt(r.path) as string }));
const why = (session: Session, ref: CellRef) => withPage(app, session, (c) => viewWhy(c, ref));

// The manager counts butter off a shelf photo (6 packs seen, the books say 12) and drafts the count, citing the photo's
// count, the on-hand and, as office evidence, the last bill prices; the owner approves it. Last night's shrinkage
// watcher then reads the count's adjustment: the figure the walk starts from.
let shrink: { ref: CellRef; moveId: string; decisionId: string };
async function countedShrinkage() {
  if (shrink) return shrink;
  const runId = await startRun({ app, agent: db.as('munshi_agent') }, s.manager, 'photo');
  const by = { session: s.manager, runId };
  // The segment model's response as stored: one box per pack it saw.
  const raw = Array.from({ length: 6 }, (_, i) => `${i}<|box;x1=${i};y1=0;x2=${i + 1};y2=1;w=1;h=1|>`).join(' ');
  const rawSha256 = createHash('sha256').update(raw).digest('hex');
  const countId = await recordShelfCount(app, by, { itemId: s.butter, photoSha256: 'a'.repeat(64), phrase: 'butter packs', model: 'recorded', raw, rawSha256, matches: 6 });
  const shelf = await mintSnapshot(app, member(s.manager), 'count.shelf', { count_id: countId }, runId);
  const onHand = await mintSnapshot(app, member(s.manager), 'stock.on_hand', { item_id: s.butter }, runId);
  const prices = await mintSnapshot(app, member(s.manager), 'purchases.last_prices', {}, runId);
  const counted = { snapshotId: shelf.id, row: 0, col: 'counted' };
  const expected = { snapshotId: onHand.id, row: 0, col: 'on_hand' };
  const draft = await proposeDraft(app, by, {
    command: 'stock.count',
    payload: { itemId: s.butter, countedQtyMilli: 6000, expectedQtyMilli: 12_000 },
    basedOn: [counted, expected, { snapshotId: prices.id, row: 0, col: 'unit_cost' }],
    payloadRefs: { countedQtyMilli: counted, expectedQtyMilli: expected },
  });
  const d = await decided(app, s.owner, draft, 'approved');
  if (d.status !== 'executed') throw new Error(`the count did not execute: ${d.status}`);
  const watch = await mintSnapshot(app, member(s.owner), 'watch.shrinkage', { as_of: businessDate(new Date(), 'Asia/Kolkata') });
  const row = watch.rows.findIndex((r) => txt(r.move_id) === d.result.moveId);
  if (row < 0) throw new Error('the shrinkage watcher does not see the count');
  shrink = { ref: { snapshotId: watch.id, row, col: 'missing' }, moveId: d.result.moveId as string, decisionId: d.decisionId };
  return shrink;
}

it('GRAPH1 the walk from a seeded figure reaches its snapshot, the book row it was read from, the decision that wrote it and who approved it', async () => {
  const { ref, moveId, decisionId } = await countedShrinkage();
  const v = await why(s.owner, ref);
  const nodes = nodesOf(v);
  const figure = `${ref.snapshotId}.${ref.row}.${ref.col}`;
  const read = `${ref.snapshotId}.${ref.row}`;
  expect(nodes.slice(0, 4)).toEqual([
    { kind: 'figure', node: figure, parent: null, label: 'missing', member: null, path: 'watch.shrinkage' },
    { kind: 'read', node: read, parent: figure, label: 'watch.shrinkage', member: s.owner.memberId, path: 'watch.shrinkage' },
    { kind: 'row', node: moveId, parent: read, label: 'books.stock_move', member: s.owner.memberId, path: 'watch.shrinkage' },
    { kind: 'decision', node: decisionId, parent: moveId, label: 'stock.count', member: s.owner.memberId, path: 'watch.shrinkage' },
  ]);
  expect(v.members[s.owner.memberId]).toBe('Owner');
  // On through the cells the approver saw: the shelf count, the on-hand and the bill prices the draft cited.
  expect(nodes.filter((n) => n.parent === decisionId && n.kind === 'read').map((n) => n.label).sort()).toEqual(['count.shelf', 'purchases.last_prices', 'stock.on_hand']);
  expect(nodes.some((n) => n.kind === 'break')).toBe(false);
});

it("GRAPH2 counter staff's walk stops at the book row: no decision, no approver, nothing under it, on the screen or replayed; nor a walk from a figure they may not see", async () => {
  const { ref, moveId, decisionId } = await countedShrinkage();
  const nodes = nodesOf(await why(s.staff, ref));
  // The figure, its read and the book row it came from; the row's writer (its approver) and the decision are the office's.
  expect(nodes.map((n) => [n.kind, n.node, n.member])).toEqual([
    ['figure', `${ref.snapshotId}.${ref.row}.${ref.col}`, null],
    ['read', `${ref.snapshotId}.${ref.row}`, s.owner.memberId],
    ['row', moveId, null],
  ]);
  // The office's walk of the same figure goes on to the decision and what it cited, the office's bill prices included.
  const office = nodesOf(await why(s.manager, ref));
  expect(office.find((n) => n.kind === 'decision')).toMatchObject({ node: decisionId, member: s.owner.memberId });
  expect(office.map((n) => n.label)).toContain('purchases.last_prices');
  // The owner's walk, replayed by its id to the staff member, is cut the same way.
  const owners = await why(s.owner, ref);
  const [replayed] = await withPage(app, s.staff, (c) => storedSnapshots(c, [owners.snapshot.id]));
  expect(replayed?.rows.map((r) => [txt(r.kind), txt(r.member_id)])).toEqual([
    ['figure', null],
    ['read', s.owner.memberId],
    ['row', null],
  ]);
  // A column the office keeps (the loss), and a read that is the office's, are no figures of theirs to walk.
  expect((await refusal(why(s.staff, { ...ref, col: 'loss' }))).code).toBe('not_for_role');
  const prices = await mintSnapshot(app, member(s.owner), 'purchases.last_prices', {});
  expect((await refusal(why(s.staff, { snapshotId: prices.id, row: 0, col: 'item' }))).code).toBe('not_for_role');
});

it("GRAPH3 a total ends at its read, whole; a read of the shop's other records ends there too; only a cell or a snapshot that is not there breaks", async () => {
  const onHand = await mintSnapshot(app, member(s.owner), 'stock.on_hand', { item_id: s.biscuits });
  const plain = nodesOf(await why(s.owner, { snapshotId: onHand.id, row: 0, col: 'on_hand' }));
  expect(plain.map((n) => [n.kind, n.label])).toEqual([
    ['figure', 'on_hand'],
    ['read', 'stock.on_hand'],
    ['total', 'stock.on_hand'],
  ]);
  // The total carries the read's own time, from its cell.
  const total = (await why(s.owner, { snapshotId: onHand.id, row: 0, col: 'on_hand' })).snapshot.rows.find((r) => txt(r.kind) === 'total');
  expect(total?.at).toEqual({ kind: 'timestamp', at: expect.any(String) });
  // What the count's approver saw: the photo's count is the shop's records, the on-hand a total; nothing breaks.
  const { ref, decisionId } = await countedShrinkage();
  const walked = nodesOf(await why(s.owner, ref));
  const sawRead = (label: string) => walked.find((n) => n.kind === 'read' && n.parent === decisionId && n.label === label)?.node;
  expect(walked.filter((n) => n.parent === sawRead('count.shelf')).map((n) => n.kind)).toEqual(['end']);
  expect(walked.filter((n) => n.parent === sawRead('stock.on_hand')).map((n) => n.kind)).toEqual(['total']);
  expect(walked.filter((n) => n.kind === 'break')).toEqual([]);
  expect(nodesOf(await why(s.owner, { snapshotId: onHand.id, row: 0, col: 'nope' })).map((n) => [n.kind, n.label])).toEqual([['break', 'no_cell']]);
  expect(nodesOf(await why(s.owner, { snapshotId: '00000000-0000-4000-8000-000000000000', row: 0, col: 'on_hand' })).map((n) => [n.kind, n.label])).toEqual([
    ['break', 'no_snapshot'],
  ]);
});

it('GRAPH4 every named read is a source-row read, a total or unwalkable, exactly once', () => {
  const names = [...QUERIES.keys()];
  const placed = [...Object.keys(SOURCE_ROW), ...AGGREGATE, ...UNWALKABLE];
  expect(names.filter((n) => !placed.includes(n)), 'unmapped').toEqual([]);
  expect(placed.filter((n) => placed.indexOf(n) !== placed.lastIndexOf(n)), 'in two maps').toEqual([]);
  expect(placed.filter((n) => !names.includes(n)), 'not a read').toEqual([]);
  for (const [name, col] of Object.entries(SOURCE_ROW)) expect(Object.keys(QUERIES.get(name)?.columns ?? {}), name).toContain(col);
});

// A count of the shop's biscuits off a photo (`matches` packs seen), drafted citing `cite` too, approved by the owner;
// the shrinkage watcher's row for its adjustment is the figure returned.
async function chainedCount(shop: Shop, matches: number, cite?: CellRef): Promise<{ ref: CellRef; decisionId: string }> {
  const runId = await startRun({ app, agent: db.as('munshi_agent') }, shop.manager, 'photo');
  const by = { session: shop.manager, runId };
  const raw = Array.from({ length: matches }, (_, i) => `${i}<|box;x1=${i};y1=0;x2=${i + 1};y2=1;w=1;h=1|>`).join(' ');
  const rawSha256 = createHash('sha256').update(raw).digest('hex');
  const countId = await recordShelfCount(app, by, { itemId: shop.biscuits, photoSha256: 'c'.repeat(64), phrase: 'biscuit packs', model: 'recorded', raw, rawSha256, matches });
  const shelf = await mintSnapshot(app, member(shop.manager), 'count.shelf', { count_id: countId }, runId);
  const onHand = await mintSnapshot(app, member(shop.manager), 'stock.on_hand', { item_id: shop.biscuits }, runId);
  const counted = { snapshotId: shelf.id, row: 0, col: 'counted' };
  const expected = { snapshotId: onHand.id, row: 0, col: 'on_hand' };
  const held = Number((onHand.rows[0]?.on_hand as { num?: string } | undefined)?.num);
  const draft = await proposeDraft(app, by, {
    command: 'stock.count',
    payload: { itemId: shop.biscuits, countedQtyMilli: matches * 1000, expectedQtyMilli: held },
    basedOn: [counted, expected, ...(cite ? [cite] : [])],
    payloadRefs: { countedQtyMilli: counted, expectedQtyMilli: expected },
  });
  const d = await decided(app, shop.owner, draft, 'approved');
  if (d.status !== 'executed') throw new Error('the count did not execute');
  const watch = await mintSnapshot(app, member(shop.owner), 'watch.shrinkage', { as_of: businessDate(new Date(), 'Asia/Kolkata') });
  const row = watch.rows.findIndex((r) => txt(r.move_id) === d.result.moveId);
  if (row < 0) throw new Error('the shrinkage watcher does not see the count');
  return { ref: { snapshotId: watch.id, row, col: 'missing' }, decisionId: d.decisionId };
}

it('GRAPH5 the walk goes two decisions deep through what each cited, and no further', async () => {
  const shop = await smallShop(app, 'MEM-DEPTH');
  // Three counts, each citing the shrinkage row of the one before: 48 → 40 → 32 → 24 packs.
  const first = await chainedCount(shop, 40);
  const second = await chainedCount(shop, 32, first.ref);
  const third = await chainedCount(shop, 24, second.ref);
  const v = await why(shop.owner, third.ref);
  const nodes = v.snapshot.rows.map((r) => ({ kind: txt(r.kind), node: txt(r.node), parent: txt(r.parent), depth: (r.depth as { num?: string } | undefined)?.num }));
  expect(nodes.filter((n) => n.kind === 'decision').map((n) => [n.node, n.depth])).toEqual([
    [third.decisionId, '0'],
    [second.decisionId, '1'],
    [first.decisionId, '2'],
  ]);
  // The deepest decision's own citations are not walked.
  expect(nodes.filter((n) => n.parent === first.decisionId)).toEqual([]);
  expect(nodes.every((n) => Number(n.depth) <= 2)).toBe(true);
  // The same figure's walk again, the same day and the books unchanged: the same stored snapshot (reused, not minted).
  expect((await why(shop.owner, third.ref)).snapshot.id).toBe(v.snapshot.id);
});
