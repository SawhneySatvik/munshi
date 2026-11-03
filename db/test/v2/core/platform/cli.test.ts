// `pnpm platform:*` (db/src/platform-cli.ts), the superadmin's changes until the console exists:
// propose prints the change and its diff; approve prints the exact diff before it asks, writes nothing unless the answer
// is yes, and then writes exactly the values it printed; list shows the change log and refuses a broken chain. The
// in-process runs take the CLI's own main() with its two ends of the terminal swapped for arrays; one run spawns the real
// process. Red-proofs: test/v2/sabotage/core-platform.ts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { main } from '../../../../src/platform-cli.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { codeOf, firstOperator, type Operator, rewind, SECRETS } from './fixture.ts';

let db: TestDb;
let op: Operator;
let t: Tenant;
let env: Record<string, string>;

beforeAll(async () => {
  db = await openTestDb();
  op = await firstOperator(db);
  t = await signUp(db, 'plat-cli');
  env = {
    PLATFORM_DATABASE_URL: `postgres://munshi_platform:munshi_platform@127.0.0.1:${inject('pg17Port')}/${db.name}`,
    MUNSHI_PLATFORM_SECRET: SECRETS.platformSecret,
  };
  await db.sabotage();
});
afterAll(() => db?.close());

// One run of the CLI: what it printed and asked, in order, and its exit code.
async function cli(args: string[], answer: string | null = null) {
  const said: string[] = [];
  const exit = await main(args, env, {
    out: (line) => said.push(line),
    ask: async (prompt) => {
      said.push(`ASK ${prompt}`);
      return answer;
    },
  });
  return { exit, said };
}
const signedIn = async () => {
  await rewind(db, op);
  return ['--subject', op.subject, `--code=${codeOf(op)}`];
};

it('the platform CLI’s propose prints the change and its diff; approve prints the exact diff before it asks, writes nothing but on yes, then writes the printed values', async () => {
  const proposed = await cli(['propose', 'shop_config', '--tenant', 'plat-cli', 'ai_enabled=true', 'ai_daily_calls=60', ...(await signedIn())]);
  expect(proposed.exit).toBe(0);
  const id = /^proposed ([0-9a-f-]{36})$/.exec(proposed.said[0] ?? '')?.[1] as string;
  const DIFF = [
    `change ${id} · shop_config · tenant ${t.tenant} (plat-cli) · pending`,
    '  ai_enabled         false → true',
    '  ai_daily_calls     0 → 60',
    '  media_daily_calls  0 (unchanged)',
    '  site_verified      false (unchanged)',
    '  before: no row; each after is in the change payload',
  ];
  expect(proposed.said.slice(1, 7)).toEqual(DIFF);

  const rows = async () => (await db.admin.query('select ai_enabled, ai_daily_calls, media_daily_calls, site_verified from platform.shop_config where change_id = $1', [id])).rows;
  for (const answer of ['no', 'y', null]) {
    const declined = await cli(['approve', id, ...(await signedIn())], answer);
    expect(declined.exit, String(answer)).toBe(1);
    expect(declined.said.at(-1)).toBe('not approved: nothing was written');
    expect(await rows()).toEqual([]);
  }
  const approved = await cli(['approve', id, ...(await signedIn())], 'yes');
  expect(approved.exit).toBe(0);
  const ask = approved.said.findIndex((l) => l.startsWith('ASK '));
  expect(approved.said.slice(0, 6)).toEqual(DIFF);
  expect(ask).toBe(7); // after the diff and its digest, before anything is written
  expect(approved.said[6]).toMatch(/^ {2}digest [0-9a-f]{64}$/);
  expect(approved.said.at(-1)).toBe(`approved ${id}`);
  expect(await rows()).toEqual([{ ai_enabled: true, ai_daily_calls: 60, media_daily_calls: 0, site_verified: false }]);
  expect((await cli(['approve', id, ...(await signedIn())], 'yes')).said.at(-1)).toBe('refused: This draft has already been decided. (not_proposed)');
});

it('the platform CLI as a real process lists the change log and exits 1 on a broken platform chain; an unknown option or a missing setting exits 2', async () => {
  const run = (args: string[], extra: Record<string, string> = env) =>
    spawnSync(process.execPath, [path.join(import.meta.dirname, '../../../../src/platform-cli.ts'), ...args], {
      env: { PATH: process.env.PATH ?? '', ...extra },
      encoding: 'utf8',
    });
  const proposed = await cli(['propose', 'reserved_slug', 'slug=kirana-one', ...(await signedIn())]);
  expect(proposed.exit).toBe(0);
  const clean = run(['list']);
  expect([clean.status, clean.stderr]).toEqual([0, '']);
  expect(clean.stdout).toMatch(/reserved_slug {2}global {2}proposed .+ pending\n/);
  expect(clean.stdout.trim().split('\n').at(-1)).toBe('platform chain verifies');
  await db.admin.query(`update platform.audit_log set action = 'change.approve' where seq = (select max(seq) from platform.audit_log)`);
  const broken = run(['list', '--pending']);
  expect(broken.status).toBe(1);
  expect(broken.stdout.trim().split('\n').at(-1)).toMatch(/^platform chain BROKEN at seq \d+$/);
  const unknown = run(['list', '--everything']);
  expect([unknown.status, unknown.stderr.trim()]).toEqual([2, 'unknown option --everything']);
  const unset = run(['list'], {});
  expect([unset.status, unset.stderr.trim()]).toEqual([2, 'PLATFORM_DATABASE_URL (the munshi_platform connection) is not set']);
});
