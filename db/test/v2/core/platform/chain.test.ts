// PLAT1's chain half through core: every proposal, decision and executed write a core path
// makes is an entry of the one global platform chain, naming the acting operator; the chain verifies, and an entry edited
// afterwards breaks it at that entry's seq. Red-proofs: test/v2/sabotage/core-platform.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { proposeChange, rejectChange, verifyPlatformChain, withOperator } from '../../../../../packages/core/src/platform.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { firstOperator, type Operator, proposeAndApprove, signIn } from './fixture.ts';

let db: TestDb;
let op: Operator;
let t: Tenant;

beforeAll(async () => {
  db = await openTestDb();
  op = await firstOperator(db);
  t = await signUp(db, 'plat-chain');
  await db.sabotage();
});
afterAll(() => db?.close());

it('every proposal, decision and executed write through core is in the platform chain, naming its operator; the chain verifies, and an edited entry breaks it at its seq', async () => {
  const platform = db.as('munshi_platform');
  const entries = async (changeId: string) =>
    (await db.admin.query<{ action: string; operator_id: string }>('select action, operator_id from platform.audit_log where change_id = $1 order by seq', [changeId])).rows;
  const approved = await proposeAndApprove(db, op, { kind: 'shop_config', tenantId: t.tenant, set: { ai_enabled: true, ai_daily_calls: 5 } });
  const slug = await proposeAndApprove(db, op, { kind: 'reserved_slug', set: { slug: 'cobalt-store', note: 'held for a partner' } });
  const s = await signIn(db, op);
  const { id: rejected } = await withOperator(platform, s, (c) => proposeChange(c, { kind: 'site_verify', tenantId: t.tenant, set: { site_verified: true } }));
  await withOperator(platform, s, (c) => rejectChange(c, rejected));
  const by = (action: string) => ({ action, operator_id: op.operatorId });
  expect(await entries(approved.id)).toEqual([by('change.propose'), by('change.approve'), by('shop_config.insert')]);
  expect(await entries(slug.id)).toEqual([by('change.propose'), by('change.approve'), by('reserved_slug.insert')]);
  expect(await entries(rejected)).toEqual([by('change.propose'), by('change.reject')]);

  expect(await withOperator(platform, s, (c) => verifyPlatformChain(c))).toBeNull();
  const { rows } = await db.admin.query<{ seq: string }>("select seq::text from platform.audit_log where change_id = $1 and action = 'shop_config.insert'", [approved.id]);
  const seq = rows[0]?.seq as string;
  await db.admin.query(`update platform.audit_log set payload = '{"change_id": "edited"}' where seq = $1`, [seq]);
  expect(await withOperator(platform, s, (c) => verifyPlatformChain(c))).toBe(seq);
});
