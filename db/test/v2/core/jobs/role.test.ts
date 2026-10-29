// J1 at the runner (BLUEPRINT §4.4, §11.1): the pool createJobsPool builds holds no write on any books table and every
// write it attempts is refused; runDueJobs runs only on a munshi_jobs connection (its purges lean on that role's
// restrictive policies); and no jobs*.ts file imports a command runner or anything that reaches one. Red-proofs:
// test/v2/sabotage/core-jobs.ts.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { MANIFEST, privileges, refused } from '../../gates/lib.ts';
import { PROBE_TABLES, plantProbeBooks } from '../../gates/probe.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from './lib.ts';

let db: TestDb;
let t: Tenant;
let pool: pg.Pool;

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeBooks(db);
  t = await signUp(db, 'role-jobs-shop');
  pool = createJobsPool(jobsUrl(db));
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

it('J1 the jobs pool holds no write grant on any books table, and every write it attempts is refused', async () => {
  const who = await pool.query<{ role: string }>('select current_user as role');
  expect(who.rows).toEqual([{ role: 'munshi_jobs' }]);
  const books = Object.keys({ ...MANIFEST.bookTables, ...PROBE_TABLES }).sort();
  const catalog = await db.admin.query<{ rel: string }>(
    `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'books' and c.relkind in ('r', 'p') order by 1`,
  );
  expect(catalog.rows.map((r) => r.rel)).toEqual(books);
  expect(books.length).toBeGreaterThan(0);
  for (const rel of books) {
    expect((await privileges(db.admin, 'munshi_jobs', rel)).filter((p) => !p.startsWith('SELECT')), rel).toEqual([]);
    // Given every chance: a tenant, an actor and a command the guard would admit for that actor.
    for (const sql of [`insert into ${rel} default values`, `update ${rel} set tenant_id = tenant_id`, `delete from ${rel}`]) {
      const r = await refused(tx(pool, { tenant_id: t.tenant, actor_id: t.owner, command: 'probe.record' }, (c) => c.query(sql)));
      expect(['42501', 'MS001'], `${sql}: ${r.message}`).toContain(r.code);
    }
  }
});

it('J1 runDueJobs runs only on a munshi_jobs connection: the app and the superuser are refused before any claim', async () => {
  for (const other of [db.as('munshi_app'), db.admin]) {
    await expect(runDueJobs(other)).rejects.toThrow('jobs: the runner connects as munshi_jobs');
  }
  const { rows } = await db.admin.query<{ n: number }>('select count(*)::int as n from ops.job_claim');
  expect(rows[0]?.n).toBe(0);
  expect((await runDueJobs(pool)).length).toBeGreaterThan(0);
});

// What a jobs file may never reach: a command runner (commands*.ts, and approvals.ts, whose decide() executes them), the
// acting-member context (session.ts), the app pool (pool.ts), core's entry point (index.ts, which re-exports all of
// them), and any @munshi/* package. Followed through every relative import, so a helper cannot launder one in.
const SRC = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'packages', 'core', 'src');
const FORBIDDEN = /^(commands(-[a-z]+)?|approvals|session|pool|index)\.ts$/;

function valueImports(text: string): string[] {
  const forms = [
    /\bimport\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*()['"]([^'"]+)['"]\s*\)/g,
  ];
  return forms.flatMap((re) => [...text.matchAll(re)].filter((m) => !m[1]).map((m) => m[2] as string));
}

it('J1 no jobs*.ts file imports a command runner, the acting-member context or the app pool, directly or through another file', () => {
  const roots = readdirSync(SRC).filter((f) => /^jobs(-[a-z]+)?\.ts$/.test(f));
  const read = (file: string) => {
    const text = readFileSync(path.join(SRC, file), 'utf8');
    return sabotageIs('v2-jobs-scan-command') && file === 'jobs-core.ts' ? `import { runCommand } from './commands.ts';\n${text}` : text;
  };
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const queue = [...roots]; queue.length; ) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (/\bimport\s*\(\s*(?!['"])|\brequire\s*\(/.test(text)) violations.push(`${file}: a computed import or a require`);
    for (const spec of valueImports(text)) {
      if (spec.startsWith('@munshi/')) violations.push(`${file}: imports ${spec}`);
      if (!spec.startsWith('.')) continue;
      const target = path.relative(SRC, path.join(SRC, path.dirname(file), spec));
      if (target.startsWith('..') || target.includes(path.sep) || FORBIDDEN.test(target)) violations.push(`${file}: imports ${spec}`);
      else queue.push(target);
    }
  }
  console.log(`J1 scanned ${seen.size} files from ${roots.length} jobs*.ts roots`);
  expect(roots).toEqual(expect.arrayContaining(['jobs.ts', 'jobs-core.ts']));
  expect(violations).toEqual([]);
});
