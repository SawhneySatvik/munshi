// LIMITS1, what allow() reads: platformLimits gives a shop's AI on/off and caps
// from its latest platform.shop_config row, else, for the demo's sample shops (synthetic and showcase, sandboxes
// included), from the latest platform.default_config, else off; a change approved now is what the next call returns;
// the caller's transaction must be under that tenant's own context. Red-proofs: test/v2/sabotage/core-platform.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { platformLimits } from '../../../../../packages/core/src/platform.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { failure, firstOperator, type Operator, proposeAndApprove } from './fixture.ts';

let db: TestDb;
let op: Operator;
let synthetic: Tenant;
let showcase: Tenant;
let sandbox: Tenant;

beforeAll(async () => {
  db = await openTestDb();
  op = await firstOperator(db);
  synthetic = await signUp(db, 'plat-config-synthetic');
  showcase = await signUp(db, 'plat-config-showcase', { dataClass: 'showcase' });
  sandbox = await signUp(db, 'plat-config-sandbox', { sandbox: true });
  await db.sabotage();
});
afterAll(() => db?.close());

// Each read in its own transaction, as each allow() is, by the app and by the jobs role.
const limits = (t: Tenant, role = 'munshi_app') => tx(db.as(role), { tenant_id: t.tenant }, (c) => platformLimits(c, t.tenant));
const caps = (l: Awaited<ReturnType<typeof limits>>) => [l.source, l.aiEnabled, l.aiDailyCalls, l.mediaDailyCalls, l.siteVerified, l.sandboxMediaDailyCallsTotal];

it('a shop runs on its latest shop_config, else a sample shop on the demo default, else off; an approved change is the next call’s answer, under the tenant’s own context only', async () => {
  // Nothing approved yet: every shop is off and hidden.
  expect(caps(await limits(synthetic))).toEqual(['none', false, 0, 0, false, null]);
  expect(caps(await limits(sandbox))).toEqual(['none', false, 0, 0, false, 0]);

  const dflt = await proposeAndApprove(db, op, {
    kind: 'default_config',
    set: { ai_enabled: true, ai_daily_calls: 60, media_daily_calls: 20, sandbox_media_daily_calls_total: 200 },
  });
  for (const role of ['munshi_app', 'munshi_jobs']) {
    expect(caps(await limits(synthetic, role)), role).toEqual(['default', true, 60, 20, false, null]);
  }
  expect(caps(await limits(showcase))).toEqual(['default', true, 60, 20, false, null]);
  expect(caps(await limits(sandbox))).toEqual(['default', true, 60, 20, false, 200]);
  expect((await limits(synthetic)).from).toEqual({ table: 'platform.default_config', id: expect.any(String), changeId: dflt.id });

  // The shop's own row wins outright, for that shop only.
  const own = await proposeAndApprove(db, op, { kind: 'shop_config', tenantId: synthetic.tenant, set: { ai_daily_calls: 15 } });
  expect(caps(await limits(synthetic))).toEqual(['shop', true, 15, 20, false, null]);
  expect((await limits(synthetic)).from).toEqual({ table: 'platform.shop_config', id: expect.any(String), changeId: own.id });
  expect(caps(await limits(showcase))).toEqual(['default', true, 60, 20, false, null]);
  await proposeAndApprove(db, op, { kind: 'default_config', set: { ai_enabled: false } });
  expect(caps(await limits(synthetic))).toEqual(['shop', true, 15, 20, false, null]);
  expect(caps(await limits(showcase))).toEqual(['default', false, 60, 20, false, null]);

  // Under another tenant's context, or none, the tenant row is unreadable: refused, never a silent "off".
  const other = await failure(tx(db.as('munshi_app'), { tenant_id: showcase.tenant }, (c) => platformLimits(c, synthetic.tenant)));
  expect(other.code).toBe('refused');
  expect((await failure(tx(db.as('munshi_jobs'), {}, (c) => platformLimits(c, synthetic.tenant)))).code).toBe('refused');
});
