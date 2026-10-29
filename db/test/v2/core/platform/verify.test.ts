// VERIFY1's database and core half (BLUEPRINT §5.1, §2.10.15; the public routes are BP-API-1's): a shop's site is
// verified only by an approved site_verify change, read by the public role from the latest platform.shop_config row; a
// direct write, under any role or under a change not yet approved, leaves it hidden. A site_verify change moves only
// site_verified and a shop_config change never moves it, so a stale one is refused rather than reverting the other.
// Red-proofs: test/v2/sabotage/core-platform.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  approveChange,
  changeDiff,
  platformLimits,
  proposeChange,
  siteVerified,
  verifySite,
  withOperator,
} from '../../../../../packages/core/src/platform.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { refused } from '../../gates/lib.ts';
import { failure, firstOperator, type Operator, proposeAndApprove, signIn } from './fixture.ts';

let db: TestDb;
let op: Operator;
let t: Tenant;

beforeAll(async () => {
  db = await openTestDb();
  op = await firstOperator(db);
  t = await signUp(db, 'plat-verify');
  await db.sabotage();
});
afterAll(() => db?.close());

const platform = () => db.as('munshi_platform');
const visible = (tenant = t) => tx(db.as('munshi_public'), {}, (c) => siteVerified(c, tenant.tenant));
const ROW = `insert into platform.shop_config (tenant_id, ai_enabled, ai_daily_calls, media_daily_calls, site_verified, change_id)
             values ($1, false, 0, 0, true, $2)`;

it('VERIFY1 a site is verified only by an approved site_verify change: written directly, under any role or an unapproved change, it stays hidden; approved, the next public read sees it', async () => {
  expect(await visible()).toBe(false);
  const s = await signIn(db, op);
  const { id } = await withOperator(platform(), s, (c) => verifySite(c, t.tenant));
  expect(await visible()).toBe(false); // proposed is not approved
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_public']) {
    expect((await refused(tx(db.as(role), { tenant_id: t.tenant }, (c) => c.query(ROW, [t.tenant, id])))).code, role).toBe('42501');
  }
  const asPlatform = (ctx: Record<string, string>) => refused(tx(platform(), { operator_id: op.operatorId, ...ctx }, (c) => c.query(ROW, [t.tenant, id])));
  expect((await asPlatform({})).code).toBe('MS017');
  expect((await asPlatform({ platform_change_id: id })).code).toBe('MS017'); // the change exists, but is not approved
  expect(await visible()).toBe(false);
  expect((await db.admin.query('select count(*)::int as n from platform.shop_config where tenant_id = $1', [t.tenant])).rows).toEqual([{ n: 0 }]);

  const diff = await withOperator(platform(), s, (c) => changeDiff(c, id));
  expect(diff.fields.filter((f) => f.before !== f.after)).toEqual([{ key: 'site_verified', before: false, after: true }]);
  await withOperator(platform(), s, (c) => approveChange(c, id, { digest: diff.digest }));
  expect(await visible()).toBe(true);
  expect((await tx(db.as('munshi_app'), { tenant_id: t.tenant }, (c) => platformLimits(c, t.tenant))).siteVerified).toBe(true);
});

it('VERIFY1 a site_verify change moves only site_verified and a shop_config change never moves it: a stale one is refused, not applied', async () => {
  const shop = await signUp(db, 'plat-verify-stale');
  const s = await signIn(db, op);
  const bad = (kind: 'shop_config' | 'site_verify', set: Record<string, unknown>) =>
    failure(withOperator(platform(), s, (c) => proposeChange(c, { kind, tenantId: shop.tenant, set })));
  expect((await bad('shop_config', { site_verified: true })).code).toBe('invalid');
  expect((await bad('site_verify', { ai_enabled: true })).code).toBe('invalid');

  // A verification proposed while AI was off, then AI turned on: approving the verification would turn AI off again.
  const { id: verify } = await withOperator(platform(), s, (c) => verifySite(c, shop.tenant));
  const { id: caps } = await withOperator(platform(), s, (c) => proposeChange(c, { kind: 'shop_config', tenantId: shop.tenant, set: { ai_enabled: true } }));
  await proposeAndApprove(db, op, { kind: 'shop_config', tenantId: shop.tenant, set: { ai_enabled: true, ai_daily_calls: 25 } });
  const s2 = await signIn(db, op);
  const approve = async (id: string) => {
    const diff = await withOperator(platform(), s2, (c) => changeDiff(c, id));
    return withOperator(platform(), s2, (c) => approveChange(c, id, { digest: diff.digest }));
  };
  expect((await failure(approve(verify))).code).toBe('conflict');
  const limits = () => tx(db.as('munshi_app'), { tenant_id: shop.tenant }, (c) => platformLimits(c, shop.tenant));
  expect([(await limits()).aiEnabled, (await limits()).aiDailyCalls, await visible(shop)]).toEqual([true, 25, false]);

  // Proposed again, it carries the shop's settings as they are: approved, the site shows and AI stays on.
  const { id: again } = await withOperator(platform(), s2, (c) => verifySite(c, shop.tenant));
  await approve(again);
  expect([(await limits()).aiEnabled, (await limits()).aiDailyCalls, await visible(shop)]).toEqual([true, 25, true]);
  // A cap change proposed before the verification, approved after it, would hide the site again: refused.
  expect((await failure(approve(caps))).code).toBe('conflict');
  expect(await visible(shop)).toBe(true);
});
