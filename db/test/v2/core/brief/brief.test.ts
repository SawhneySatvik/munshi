// BRIEF and E1-AI: the daily brief (BLUEPRINT §7.6, §7.4) over six planted dead-stock findings, worked by hand. Stock
// values: saffron ₹8,000, tea ₹3,600, ghee ₹3,000, honey ₹1,000, pickle ₹400, rose water ₹150. Ghee's finding is aged 14
// days (a superuser fixture: first_seen_at is stamped by the database), so its score is ₹3,000 × (20 + 14) = 102,000
// against tea's ₹3,600 × 20 = 72,000 on the day (× 21 the next day): the ranking is saffron, ghee, tea, honey, pickle;
// rose water is sixth and left out. When AI is on and under its cap, all five are given to the narrator in one call,
// whatever their severity (the founder's ruling, 2 Nov); its recorded answer narrates saffron, ghee and tea (the high
// ones), so honey and pickle show their templates. The ranking is the pinned brief.ranked snapshot's rank cells; ai.brief
// keeps no list; each line is validated model text or a template; an answer's words live only in ops.message_text.
// Model turns are hand-written and replayed from packages/agent/fixtures/brief (packages/agent/test/script.ts).
// Red-proofs: test/v2/sabotage/core-ai.ts.
import { addDays, businessDate, findingState, localTime, mintSnapshot, readRow, recordPurchase, recordSale, resolveRef, runCommand, runWatchers } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { allow } from '../../../../../packages/core/src/allow.ts';
import { type BriefNarrator, briefLines, writeBrief } from '../../../../../packages/core/src/brief.ts';
import type { AgentPort } from '../../../../../packages/agent/src/port.ts';
import { narrateBrief } from '../../../../../packages/agent/src/run.ts';
import { prepare, scripted, type Turn } from '../../../../../packages/agent/test/script.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { firstOperator, proposeAndApprove } from '../platform/fixture.ts';
import { type Shop, smallShop } from '../shop.ts';
import { age } from '../watchers/plant.ts';

const SUITE = 'brief';
const MARK = 'Zanzibar'; // a word only the narrated line holds

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let today: string;
const items = new Map<string, string>();
const finding = new Map<string, string>(); // item name → finding id

const at = (day: number, minute: number) => localTime(addDays(today, day), minute, 'Asia/Kolkata').toISOString();

beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  s = await smallShop(app, 'Brief');
  today = businessDate(new Date(), 'Asia/Kolkata');
  const op = await firstOperator(db);
  await proposeAndApprove(db, op, { kind: 'default_config', set: { ai_enabled: true, ai_daily_calls: 10, media_daily_calls: 0, sandbox_media_daily_calls_total: 0, deployment_daily_calls: 1000 } });
  const plan: [string, number, number][] = [
    ['Saffron box', 2, 400_000],
    ['Tea tin', 3, 120_000],
    ['Ghee tin', 10, 30_000],
    ['Honey jar', 5, 20_000],
    ['Pickle jar', 4, 10_000],
    ['Rose water', 1, 15_000],
  ];
  for (const [name, units, cost] of plan) {
    const itemId = ((await runCommand(app, s.owner, 'item.create', { name, unit: 'pack', effectiveFrom: at(-100, 0) })) as { itemId: string }).itemId;
    items.set(name, itemId);
    await recordPurchase(app, s.manager, {
      supplierId: s.supplier,
      billNo: `B-${items.size}`,
      billDate: addDays(today, -60),
      receivedAt: at(-60, 540),
      lines: [{ itemId, qtyMilli: units * 1000, unitCostMinor: cost, expiresOn: addDays(today, 400) }],
    });
  }
  // Yesterday's counter: one sale of ₹20, for the branch's figures. The shop's price starts 24 hours before now, which
  // after 10:00 IST is later than yesterday 10:00, so the sale's price is set from two days back.
  await runCommand(app, s.owner, 'price.set', { itemId: s.biscuits, amountMinor: 1000, effectiveFrom: at(-2, 0) });
  await recordSale(app, s.staff, { shopId: s.shopId, soldAt: at(-1, 600), lines: [{ itemId: s.biscuits, qtyMilli: 2000 }], payments: [{ method: 'cash', amountMinor: 2000 }] });
  const run = await runWatchers(jobs, s.owner.tenantId, today);
  for (const r of run.raised) {
    const name = [...items].find(([, id]) => r.dedupeKey === `dead_stock:${id}`)?.[0];
    if (name) finding.set(name, r.findingId);
  }
  await age(db.admin, finding.get('Ghee tin') as string, 'first_seen_at', 14);
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const RANKED = ['Saffron box', 'Ghee tin', 'Tea tin', 'Honey jar', 'Pickle jar'];
const rows = async (sql: string, values: unknown[] = []) => (await db.admin.query(sql, values)).rows;

// The agent's port for the brief's run (the jobs role's, no member): a finding's state from core, its cells and every
// ref read as the read-only agent role; traces kept; allow is core's, on the jobs pool.
function briefPort(allowed = true): AgentPort & { events: { kind: string; label: string }[] } {
  const events: { kind: string; label: string }[] = [];
  const asAgent = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tx(db.as('munshi_agent'), { tenant_id: s.owner.tenantId }, fn);
  const unused = () => {
    throw new Error('the brief reads and proposes nothing');
  };
  return {
    events,
    read: unused,
    propose: unused,
    resolve: (ref) => asAgent((c) => resolveRef(c, ref)),
    async finding(id) {
      const st = await findingState(app, s.owner.tenantId, id);
      const row = st && (await asAgent((c) => readRow(c, st)));
      if (!st || !row) return null;
      const cells = Object.fromEntries(Object.entries(row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      return { id, kind: st.kind, snapshotId: st.snapshotId, row: st.row, cells, status: st.status, current: st.current, openDraft: st.openDraft };
    },
    trace: (e) => {
      events.push({ kind: e.kind, label: e.label });
    },
    allow: async (role) => allowed && (await allow(jobs, s.owner.tenantId, role, 'on')).ok,
  };
}

function narrator(turns: Turn[], allowed = true): BriefNarrator {
  return async (_runId, ids) => {
    const port = briefPort(allowed);
    const { deps } = scripted(SUITE, turns);
    const reply = await narrateBrief(ids, { port, asOf: today, deps });
    const modelCalls = port.events.filter((e) => e.kind === 'model').length;
    if (reply.kind === 'answer') return { outcome: 'answered', segments: reply.segments.map((x) => ({ text: x.text, refs: x.refs })), modelCalls };
    return { outcome: port.events.some((e) => e.label === 'ai_off') ? 'budget' : 'abstained', modelCalls };
  };
}

it('BRIEF the ranking is the pinned brief.ranked snapshot’s rank cells, |impact| × (1 + 0.05 × days open), and ai.brief keeps no list of its own', async () => {
  const b = await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: today });
  expect(b).not.toBeNull();
  const brief = b as NonNullable<typeof b>;
  expect(brief.answerId).toBeNull(); // no narrator: every line is its template
  const ranked = await rows("select query_name, purpose, row_count, rows from snap.snapshot where id = $1", [brief.rankedSnapshotId]);
  expect(ranked[0]).toMatchObject({ query_name: 'brief.ranked', purpose: 'watch', row_count: 5 });
  expect(await rows("select holder from snap.pin where snapshot_id = $1 and holder = 'brief' and holder_id = $2", [brief.rankedSnapshotId, brief.briefId])).toHaveLength(1);
  const lines = await tx(app, { tenant_id: s.owner.tenantId }, (c) => briefLines(c, brief.briefId));
  expect(lines.map((l) => l.findingId)).toEqual(RANKED.map((n) => finding.get(n)));
  expect(lines.map((l) => [l.rank.col, l.rank.snapshotId])).toEqual(RANKED.map(() => ['rank', brief.rankedSnapshotId]));
  const rankCells = await tx(app, { tenant_id: s.owner.tenantId }, (c) => Promise.all(lines.map((l) => resolveRef(c, l.rank))));
  expect(rankCells).toEqual([1, 2, 3, 4, 5].map((n) => ({ kind: 'integer', num: String(n) })));
  expect(lines.map((l) => [l.severity, l.narrated])).toEqual([
    ['high', false],
    ['high', false],
    ['high', false],
    ['medium', false],
    ['low', false],
  ]);
  // Each template line cites its finding's own impact cell.
  const impacts = await tx(app, { tenant_id: s.owner.tenantId }, (c) => Promise.all(lines.map((l) => resolveRef(c, l.refs[0] as never))));
  expect(impacts.map((cell) => (cell as { num: string }).num)).toEqual(['800000', '300000', '360000', '100000', '40000']);
  expect(lines[0]?.text).toBe('Stock has not sold in weeks: ⟦1⟧ held on the shelf.');
  // The brief row holds the snapshot and an answer at most: no column could hold a second copy of the order.
  const cols = await rows("select column_name from information_schema.columns where table_schema = 'ai' and table_name = 'brief' order by ordinal_position");
  expect(cols.map((c) => c.column_name)).toEqual(['tenant_id', 'id', 'shop_id', 'business_date', 'run_id', 'ranked_snapshot_id', 'answer_id', 'created_at']);
  expect(await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: today })).toBeNull(); // one a day per branch
  const [run] = await rows('select trigger, started_by, outcome, model_calls from ai.run where id = $1', [brief.runId]);
  expect(run).toEqual({ trigger: 'brief', started_by: null, outcome: 'off', model_calls: 0 });
});

const NARRATED: Turn[] = [
  {
    json: {
      // Out of rank order on purpose: a line is paired with its finding by the cells it cites, never by position.
      segments: [
        { text: 'Tea tins worth ⟦1⟧ have not sold.', refs: [{ read: 3, row: 0, col: 'stock_value' }] },
        { text: 'Saffron boxes worth ⟦1⟧ sit on the shelf.', refs: [{ read: 1, row: 0, col: 'stock_value' }] },
        { text: `The ghee tins, ⟦1⟧ of stock, wait for a buyer in ${MARK}.`, refs: [{ read: 2, row: 0, col: 'stock_value' }] },
      ],
    },
  },
];

it('BRIEF with AI on and under its cap, each high finding’s line is validated model text, in rank order; the rest are templates', async () => {
  const b = await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: addDays(today, 1), narrate: narrator(NARRATED) });
  const brief = b as NonNullable<typeof b>;
  expect(brief.answerId).not.toBeNull();
  const lines = await tx(app, { tenant_id: s.owner.tenantId }, (c) => briefLines(c, brief.briefId));
  expect(lines.map((l) => [l.findingId, l.narrated, l.text])).toEqual([
    [finding.get('Saffron box'), true, 'Saffron boxes worth ⟦1⟧ sit on the shelf.'],
    [finding.get('Ghee tin'), true, `The ghee tins, ⟦1⟧ of stock, wait for a buyer in ${MARK}.`],
    [finding.get('Tea tin'), true, 'Tea tins worth ⟦1⟧ have not sold.'],
    [finding.get('Honey jar'), false, 'Stock has not sold in weeks: ⟦1⟧ held on the shelf.'],
    [finding.get('Pickle jar'), false, 'Stock has not sold in weeks: ⟦1⟧ held on the shelf.'],
  ]);
  const [answer] = await rows('select kind, verdict, text_id is not null as has_text, refs from ai.answer where id = $1', [brief.answerId]);
  expect(answer).toMatchObject({ kind: 'brief_line', verdict: 'answered', has_text: true });
  expect(await rows("select 1 from snap.pin where holder = 'answer' and holder_id = $1", [brief.answerId])).toHaveLength(1); // one snapshot: the dead-stock run's
  const [run] = await rows('select outcome, model_calls from ai.run where id = $1', [brief.runId]);
  expect(run).toEqual({ outcome: 'answered', model_calls: 1 });
});

it('BRIEF a line with a free number is refused, by the validator or by core’s own check, and the brief falls back to its templates', async () => {
  const bad: BriefNarrator = async () => ({ outcome: 'answered', segments: [{ text: 'Saffron worth ₹8000 sits unsold.', refs: [] }], modelCalls: 1 });
  const b = await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: addDays(today, 2), narrate: bad });
  expect(b?.answerId).toBeNull();
  const [run] = await rows('select outcome from ai.run where id = $1', [b?.runId]);
  expect(run).toEqual({ outcome: 'abstained' });
  const lines = await tx(app, { tenant_id: s.owner.tenantId }, (c) => briefLines(c, (b as { briefId: string }).briefId));
  expect(lines.every((l) => !l.narrated)).toBe(true);
});

it('BRIEF over the cap (or with AI off), no model is asked and every line is its template', async () => {
  const b = await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: addDays(today, 3), narrate: narrator([], false) });
  expect(b?.answerId).toBeNull();
  const [run] = await rows('select outcome, model_calls from ai.run where id = $1', [b?.runId]);
  expect(run).toEqual({ outcome: 'budget', model_calls: 0 });
});

it('BRIEF the branch’s figures are one row of brief.figures: yesterday’s sales and bills, today’s bookings, packages lapsing this week', async () => {
  const snap = await mintSnapshot(app, { kind: 'member', session: s.owner }, 'brief.figures', { as_of: today, shop_id: s.shopId });
  expect(snap.rows).toEqual([
    {
      sales_yesterday: { kind: 'money', num: '2000', currency: 'INR' },
      bills_yesterday: { kind: 'integer', num: '1' },
      bookings_today: { kind: 'integer', num: '0' },
      packages_expiring: { kind: 'integer', num: '0' },
    },
  ]);
});

// Every text, jsonb and array column of ai.*, snap.*, audit.* and approval.*, searched as the superuser past RLS.
async function scan(needle: string): Promise<string[]> {
  const { rows: cols } = await db.admin.query<{ rel: string; col: string }>(
    `select n.nspname || '.' || c.relname as rel, a.attname as col
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('ai', 'snap', 'audit', 'approval', 'ops') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and (a.atttypid in ('text'::regtype, 'jsonb'::regtype, 'text[]'::regtype) or format_type(a.atttypid, a.atttypmod) like 'character%')`,
  );
  const found: string[] = [];
  for (const { rel, col } of cols) {
    const { rows: hit } = await db.admin.query(`select count(*)::int as n from ${rel} where strpos(${col}::text, $1) > 0`, [needle]);
    if (hit[0].n > 0) found.push(`${rel}.${col}`);
  }
  return found;
}

it('E1-AI an answer’s words live only in erasable ops.message_text: ai.* keeps refs and verdicts, and once erased the words are gone', async () => {
  let briefId: string;
  const [existing] = await rows("select b.id::text from ai.brief b where b.answer_id is not null and b.tenant_id = $1", [s.owner.tenantId]);
  if (existing) briefId = existing.id;
  else briefId = ((await writeBrief(jobs, s.owner.tenantId, s.shopId, { asOf: addDays(today, 1), narrate: narrator(NARRATED) })) as { briefId: string }).briefId;
  expect(await scan(MARK)).toEqual(['ops.message_text.body']); // the scan finds the words where they are
  const [text] = await rows('select a.text_id::text as id from ai.brief b join ai.answer a on a.id = b.answer_id where b.id = $1', [briefId]);
  await tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId }, (c) =>
    c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [text?.id]),
  );
  expect(await scan(MARK)).toEqual([]);
  // Erased, the line shows its template; its refs, and their pins, stay.
  const lines = await tx(app, { tenant_id: s.owner.tenantId }, (c) => briefLines(c, briefId));
  expect(lines.every((l) => !l.narrated)).toBe(true);
  expect(await rows("select 1 from snap.pin p join ai.brief b on b.answer_id = p.holder_id where b.id = $1 and p.holder = 'answer'", [briefId])).toHaveLength(1);
});
