// SHOW: the two showcase tenants, Elite (salon) and Prabhave (apparel), built by seedShowcase through core's
// real paths. For each, one watcher run (as the jobs role) finds exactly the planted situations in its hand-worked
// answer key (db/seed/{elite,prabhave}.answers.json), by kind, matched ids and values, and nothing else; every book row
// the seed wrote carries an audit entry naming its command, and the one written under a decision is the owner's approved
// salary run; both sites are verified by an approved site_verify change of the seeded operator. Under the
// v2-showcase-omit-* sabotages the seed leaves one plant out, and that tenant's answer-key test must fail.
// Red-proofs: test/v2/sabotage/core-showcase.ts.
import { readFileSync } from 'node:fs';
import { addDays, businessDate, platformLimits, runWatchers, siteVerified } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PIECES } from '../../../../seed/prabhave.ts';
import { DEMO_DEFAULTS, type Showcase, SHOWCASE_PLANTS, seedShowcase } from '../../../../seed/showcase.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { smallShop } from '../shop.ts';

type Answer = { kind: string; match: Record<string, string>; expect: Record<string, string | number> };
const key = (file: string) => (JSON.parse(readFileSync(new URL(`../../../../seed/${file}`, import.meta.url), 'utf8')) as { plants: Answer[] }).plants;
const ELITE_KEY = key('elite.answers.json');
const PRABHAVE_KEY = key('prabhave.answers.json');
const AS_OF = addDays(businessDate(new Date(), 'Asia/Kolkata'), 1);
const SECRETS = { identitySecret: 'identity-secret-for-the-showcase-test-0001', platformSecret: 'platform-secret-for-the-showcase-test-0001' };
const planted = (name: string) => process.env.MUNSHI_SABOTAGE === name && sabotageIs(name);

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let owner: pg.Client;
let s: Showcase;
let instant: Date;
const runs: Record<'elite' | 'prabhave', string> = { elite: '', prabhave: '' };
let seedMs = 0;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = db.as('munshi_jobs');
  owner = await db.migrator();
  const omit = SHOWCASE_PLANTS.filter((p) => planted(`v2-showcase-omit-${p}`));
  const t0 = Date.now();
  s = await seedShowcase({ app, pub: db.as('munshi_public'), platform: db.as('munshi_platform') }, owner, { asOf: AS_OF, omit, secrets: SECRETS });
  seedMs = Date.now() - t0;
  await db.sabotage();
  // The watchers' instant: 31 minutes after the waiting cart arrived (the database stamped it), or from now without it.
  const waiting = s.prabhave.requests.get('waiting');
  const { rows } = await db.admin.query<{ at: Date }>('select created_at as at from ops.order_request where id = $1', [waiting ?? null]);
  instant = new Date((rows[0]?.at ?? new Date()).getTime() + 31 * 60_000);
  runs.elite = (await runWatchers(jobs, s.elite.tenantId, AS_OF, instant)).runId;
  runs.prabhave = (await runWatchers(jobs, s.prabhave.tenantId, AS_OF, instant)).runId;
}, 300_000);
afterAll(async () => {
  await owner?.end();
  await db?.close();
});

const q = async (tenantId: string, sql: string, params: unknown[] = []) => (await tx(app, { tenant_id: tenantId }, (c) => c.query(sql, params))).rows;
const dayOffset = (day: string) => Math.round((Date.parse(day) - Date.parse(AS_OF)) / 86_400_000);

// The run's findings, each as its snapshot row's plain values: text as text, numbers as numbers, dates as day offsets.
async function found(tenantId: string, runId: string) {
  const rows = await q(
    tenantId,
    `select f.kind, s.columns, s.rows -> f.snapshot_row as cells
       from ai.finding f join snap.snapshot s on s.tenant_id = f.tenant_id and s.id = f.snapshot_id
      where f.first_run_id = $1 order by f.kind, f.dedupe_key`,
    [runId],
  );
  return rows.map((r: { kind: string; columns: { n: string }[]; cells: { k: string; n?: string; t?: string; d?: string }[] }) => {
    const v: Record<string, string | number | null> = {};
    for (const [i, col] of r.columns.entries()) {
      const cell = r.cells[i] as { k: string; n?: string; t?: string; d?: string };
      if (cell.k === 'date') v[`${col.n}_day`] = dayOffset(cell.d as string);
      else v[col.n] = cell.n !== undefined ? Number(cell.n) : (cell.t ?? null);
    }
    return { kind: r.kind, v };
  });
}

// Every planted situation matched by a finding of its kind (its named ids and every expected value), and no other.
async function matchKey(label: string, tenantId: string, runId: string, answers: Answer[], ids: Record<string, [string, Map<string, string>]>) {
  const all = await found(tenantId, runId);
  const matched = new Set<number>();
  for (const [i, a] of answers.entries()) {
    const want = Object.entries(a.match).map(([k, name]) => [(ids[k] as [string, Map<string, string>])[0], (ids[k] as [string, Map<string, string>])[1].get(name)] as const);
    const hit = all.find((f) => f.kind === a.kind && want.every(([col, id]) => id !== undefined && f.v[col] === id));
    if (hit && Object.entries(a.expect).every(([col, v]) => hit.v[col] === v)) matched.add(i);
    else console.log(`SHOW ${label} MISSED ${a.kind} ${JSON.stringify(a.match)}: ${hit ? `found ${JSON.stringify(hit.v)}` : 'no finding'}`);
  }
  const unexpected = all.filter((f) => !answers.some((a, i) => matched.has(i) && a.kind === f.kind));
  for (const f of unexpected) console.log(`SHOW ${label} UNEXPECTED ${f.kind} ${JSON.stringify(f.v)}`);
  console.log(`SHOW ${label}: seeded both in ${seedMs} ms; ${matched.size} of ${answers.length} planted situations found, ${all.length - matched.size} other findings`);
  expect(matched.size).toBe(answers.length);
  expect(all.length).toBe(answers.length); // nothing beyond the key: the controls stay quiet
}

it('Elite: the watchers find exactly the planted situations of elite.answers.json, and nothing else', async () => {
  const e = s.elite;
  expect(ELITE_KEY.map((a) => a.kind).sort()).toEqual(['idle_stylist', 'package_expiry', 'regulars_lapsing']);
  await matchKey('Elite', e.tenantId, runs.elite, ELITE_KEY, {
    staff: ['staff_id', e.staff],
    shop: ['shop_id', e.shops],
    customer: ['customer_id', e.customers],
    holding: ['holding_id', e.holdings],
  });
});

it('Prabhave: the watchers find exactly the planted situations of prabhave.answers.json, and nothing else', async () => {
  const p = s.prabhave;
  expect(PRABHAVE_KEY.map((a) => a.kind).sort()).toEqual(['dead_stock', 'hold_expiring', 'order_late', 'order_unanswered']);
  expect(PRABHAVE_KEY.find((a) => a.kind === 'dead_stock')?.match.item).toBe(PIECES.dead);
  await matchKey('Prabhave', p.tenantId, runs.prabhave, PRABHAVE_KEY, {
    item: ['item_id', p.items],
    reservation: ['reservation_id', p.reservations],
    request: ['request_id', p.requests],
    order: ['order_id', p.orders],
    shop: ['shop_id', new Map([['Kirti Nagar', p.shopId]])],
  });
});

it('the seed writes book rows only through core: each has an audit entry naming its command, and the only one under a decision is the owner-approved salary run', async () => {
  const { rows: tables } = await db.admin.query<{ t: string }>(
    `select c.table_name as t from information_schema.columns c
      where c.table_schema = 'books' and c.column_name = 'id'
        and exists (select 1 from information_schema.columns x where x.table_schema = 'books' and x.table_name = c.table_name and x.column_name = 'tenant_id')
      order by 1`,
  );
  expect(tables.length).toBeGreaterThan(20);
  for (const t of [s.elite, s.prabhave]) {
    let rows = 0;
    let unaudited = 0;
    for (const { t: table } of tables) {
      const { rows: n } = await db.admin.query<{ n_all: number; bare: number }>(
        `select count(*)::int as n_all,
                count(*) filter (where not exists (select 1 from audit.audit_log a where a.tenant_id = b.tenant_id and a.entity = $2 and a.entity_id = b.id
                                                    and a.command is not null and a.actor_id is not null))::int as bare
           from books.${table} b where b.tenant_id = $1`,
        [t.tenantId, `books.${table}`],
      );
      rows += n[0]?.n_all ?? 0;
      unaudited += n[0]?.bare ?? 0;
    }
    expect(rows).toBeGreaterThan(300);
    expect(unaudited).toBe(0);
    // Under a decision: only salary.run's rows, decided by the owner; and every draft of the seed is that one.
    const { rows: decided } = await db.admin.query(
      `select distinct a.command, d.decided_by = $2 as by_owner from audit.audit_log a join approval.decision d on d.tenant_id = a.tenant_id and d.id = a.decision_id
        where a.tenant_id = $1 and a.entity like 'books.%'`,
      [t.tenantId, t.owner.memberId],
    );
    const { rows: drafts } = await db.admin.query('select command, status from approval.draft where tenant_id = $1', [t.tenantId]);
    if (t === s.elite) {
      expect(decided).toEqual([{ command: 'salary.run', by_owner: true }]);
      expect(drafts).toEqual([{ command: 'salary.run', status: 'executed' }]);
    } else {
      expect([decided, drafts]).toEqual([[], []]);
    }
  }
});

it('both showcase sites are verified, each by its own approved site_verify change, and the public reads them as verified', async () => {
  expect(s.verifications).toHaveLength(2);
  for (const t of [s.elite, s.prabhave]) {
    expect(await tx(db.as('munshi_public'), {}, (c) => siteVerified(c, t.tenantId))).toBe(true);
    const { rows } = await db.admin.query(
      `select ch.kind, ch.verdict, ch.decided_by = $2 as by_seed from platform.change ch join platform.shop_config sc on sc.change_id = ch.id
        where ch.tenant_id = $1 and sc.site_verified`,
      [t.tenantId, s.operatorId],
    );
    expect(rows).toEqual([{ kind: 'site_verify', verdict: 'approved', by_seed: true }]);
  }
});

it('the demo default config is set by the seeded operator’s approved change: a sample shop without a config of its own has AI on, at the demo caps', async () => {
  expect(s.defaultsChangeId).not.toBeNull();
  const { rows } = await db.admin.query(`select kind, verdict, decided_by = $2 as by_seed from platform.change where id = $1`, [s.defaultsChangeId, s.operatorId]);
  expect(rows).toEqual([{ kind: 'default_config', verdict: 'approved', by_seed: true }]);
  // A synthetic demo shop (the kirana's class) made after the seed reads the defaults.
  const sample = (await smallShop(app, 'Sample after the seed')).owner.tenantId;
  const limits = await tx(app, { tenant_id: sample }, (c) => platformLimits(c, sample));
  expect(limits).toMatchObject({ source: 'default', aiEnabled: true, aiDailyCalls: DEMO_DEFAULTS.ai_daily_calls, mediaDailyCalls: DEMO_DEFAULTS.media_daily_calls });
  for (const t of [s.elite, s.prabhave]) {
    const own = await tx(app, { tenant_id: t.tenantId }, (c) => platformLimits(c, t.tenantId));
    expect({ tenant: t.tenantId, ai: own.aiEnabled, site: own.siteVerified }).toEqual({ tenant: t.tenantId, ai: true, site: true });
  }
});
