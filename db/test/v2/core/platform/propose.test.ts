// PLAT1 and TOTP1 through core (BLUEPRINT §6.5, §2.13): a platform change executes only when approved in a later
// transaction than its proposal, by an operator signed in with a code that counts once; the diff an operator approves is
// the change executed, and an approval of a diff that has gone stale is refused. Red-proofs:
// test/v2/sabotage/core-platform.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  approveChange,
  changeDiff,
  openOperatorSession,
  platformLimits,
  proposeChange,
  rejectChange,
  signInOperator,
  withOperator,
} from '../../../../../packages/core/src/platform.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { signUp, type Tenant } from '../../gates/fixture.ts';
import { addOperator, codeOf, failure, firstOperator, type Operator, proposeAndApprove, rewind, SECRETS, signIn } from './fixture.ts';

let db: TestDb;
let t: Tenant;
let a: Operator;
let b: Operator;

beforeAll(async () => {
  db = await openTestDb();
  t = await signUp(db, 'plat-propose');
  a = await firstOperator(db, 'Asha');
  b = await addOperator(db, a, 'Bharat');
  await db.sabotage();
});
afterAll(() => db?.close());

const platform = () => db.as('munshi_platform');
const limits = () => tx(db.as('munshi_app'), { tenant_id: t.tenant }, (c) => platformLimits(c, t.tenant));
const shopRows = async () => (await db.admin.query<{ n: number }>('select count(*)::int as n from platform.shop_config')).rows[0]?.n;
const GRANT = { channel: 'whatsapp', granted: true, max_test_recipients: 2, account_ref: null };

it('PLAT1 a change executes only when approved in a later transaction than its proposal: proposed and approved in one transaction it is refused, and nothing is written', async () => {
  const before = await limits();
  const rows = await shopRows();
  const s = await signIn(db, a);
  const err = await failure(
    withOperator(platform(), s, async (c) => {
      const { id } = await proposeChange(c, { kind: 'shop_config', tenantId: t.tenant, set: { ai_enabled: true, ai_daily_calls: 50 } });
      const diff = await changeDiff(c, id);
      return approveChange(c, id, { digest: diff.digest });
    }),
  );
  expect(err.code).toBe('refused');
  expect(err.sqlstate).toBe('MS017');
  expect(await shopRows()).toBe(rows);
  expect(await limits()).toEqual(before);
});

it('PLAT1 a proposal is approved in a later transaction by another operator, or by its proposer, both named; the diff shown is the row written and the next read, and a diff gone stale is refused', async () => {
  // Proposed by Asha, nothing changes until it is approved.
  const before = await limits();
  const sa = await signIn(db, a);
  const { id } = await withOperator(platform(), sa, (c) =>
    proposeChange(c, { kind: 'shop_config', tenantId: t.tenant, set: { ai_enabled: true, ai_daily_calls: 40, media_daily_calls: 10 } }),
  );
  expect(await limits()).toEqual(before);
  // Approved by Bharat, from the diff he was shown.
  const sb = await signIn(db, b);
  const diff = await withOperator(platform(), sb, (c) => changeDiff(c, id));
  expect(diff.fields).toEqual([
    { key: 'ai_enabled', before: before.aiEnabled, after: true },
    { key: 'ai_daily_calls', before: before.aiDailyCalls, after: 40 },
    { key: 'media_daily_calls', before: before.mediaDailyCalls, after: 10 },
    { key: 'site_verified', before: false, after: false },
  ]);
  await withOperator(platform(), sb, (c) => approveChange(c, id, { digest: diff.digest }));
  const { rows } = await db.admin.query('select proposed_by, decided_by, verdict from platform.change where id = $1', [id]);
  expect(rows).toEqual([{ proposed_by: a.operatorId, decided_by: b.operatorId, verdict: 'approved' }]);
  const written = await db.admin.query('select ai_enabled, ai_daily_calls, media_daily_calls, site_verified from platform.shop_config where change_id = $1', [id]);
  expect(written.rows).toEqual([Object.fromEntries(diff.fields.map((f) => [f.key, f.after]))]);
  const after = await limits();
  expect([after.aiEnabled, after.aiDailyCalls, after.mediaDailyCalls, after.siteVerified]).toEqual(diff.fields.map((f) => f.after));
  expect(after.source).toBe('shop');
  expect(after.from?.changeId).toBe(id);
  // A decided change is decided once.
  expect((await failure(withOperator(platform(), sb, (c) => approveChange(c, id, { digest: diff.digest })))).code).toBe('not_proposed');

  // Asha approves her own proposal, a transaction later; both steps carry her name.
  const { id: own } = await withOperator(platform(), sa, (c) => proposeChange(c, { kind: 'shop_config', tenantId: t.tenant, set: { ai_daily_calls: 30 } }));
  // Shown, then the shop's config moves before the approval: the diff she saw is stale, and approving it is refused.
  const shown = await withOperator(platform(), sa, (c) => changeDiff(c, own));
  await proposeAndApprove(db, b, { kind: 'shop_config', tenantId: t.tenant, set: { media_daily_calls: 12 } });
  const stale = await failure(withOperator(platform(), sa, (c) => approveChange(c, own, { digest: shown.digest })));
  expect(stale.code).toBe('conflict');
  expect((await limits()).aiDailyCalls).toBe(40);
  const fresh = await withOperator(platform(), sa, (c) => changeDiff(c, own));
  expect(fresh.fields.find((f) => f.key === 'media_daily_calls')).toEqual({ key: 'media_daily_calls', before: 12, after: 10 });
  await withOperator(platform(), sa, (c) => approveChange(c, own, { digest: fresh.digest }));
  const self = await db.admin.query('select proposed_by, decided_by from platform.change where id = $1', [own]);
  expect(self.rows).toEqual([{ proposed_by: a.operatorId, decided_by: a.operatorId }]);
  expect((await limits()).aiDailyCalls).toBe(30);

  // A rejected change writes nothing, and is never approved afterwards.
  const rows0 = await shopRows();
  const { id: no } = await withOperator(platform(), sa, (c) => proposeChange(c, { kind: 'shop_config', tenantId: t.tenant, set: { ai_enabled: false } }));
  await withOperator(platform(), sb, (c) => rejectChange(c, no));
  const late = await withOperator(platform(), sb, (c) => changeDiff(c, no));
  expect((await failure(withOperator(platform(), sb, (c) => approveChange(c, no, { digest: late.digest })))).code).toBe('not_proposed');
  expect(await shopRows()).toBe(rows0);
});

it('TOTP1 an operator signs in only with a valid, unused code: a replayed code, an older code after a newer one, a wrong code and an unknown operator are refused', async () => {
  await rewind(db, a);
  const sessions = async () => (await db.admin.query<{ n: number }>('select count(*)::int as n from platform.operator_session where operator_id = $1', [a.operatorId])).rows[0]?.n ?? 0;
  const n = await sessions();
  const signIn1 = (code: string, subject = a.subject) => signInOperator(platform(), subject, code, SECRETS.platformSecret);
  // Minted together, so a step boundary passing mid-test cannot turn a refusal into an acceptance.
  const [code, next, prev] = [codeOf(a), codeOf(a, 1), codeOf(a, -1)];
  expect(await signIn1(code)).not.toBeNull();
  expect(await signIn1(code)).toBeNull(); // the same code again
  expect(await signIn1(next)).not.toBeNull(); // the next step, within the drift
  expect(await signIn1(prev)).toBeNull(); // an older step, after a newer one
  expect(await signIn1(next)).toBeNull();
  await rewind(db, a);
  const wrong = String((Number(codeOf(a)) + 1) % 1_000_000).padStart(6, '0');
  expect(await signIn1(wrong)).toBeNull();
  expect(await signIn1(codeOf(a), b.subject)).toBeNull(); // Asha's code is not Bharat's
  expect(await signIn1(codeOf(a), '00000000-0000-4000-8000-000000000000')).toBeNull();
  expect(await sessions()).toBe(n + 2);
});

it('TOTP1 a channel grant is approved only with a code verified in the last 5 minutes: a re-opened session needs a fresh code, and a replayed code is refused', async () => {
  const s = await signIn(db, a);
  const real = await signUp(db, 'plat-propose-real', { dataClass: 'live' }); // a channel is a real shop's alone (D-080)
  const { id } = await withOperator(platform(), s, (c) => proposeChange(c, { kind: 'channel_grant', tenantId: real.tenant, set: GRANT }));
  // The console's next request re-opens the session from its cookie: that proves no fresh code.
  await rewind(db, a);
  const used = codeOf(a);
  const fresh = await signInOperator(platform(), a.subject, used, SECRETS.platformSecret);
  const cookie = await openOperatorSession(platform(), fresh?.sessionId ?? '');
  if (!cookie) throw new Error('the session did not re-open');
  const diff = await withOperator(platform(), cookie, (c) => changeDiff(c, id));
  const approve = (code?: string) =>
    withOperator(platform(), cookie, (c) => approveChange(c, id, { digest: diff.digest, platformSecret: SECRETS.platformSecret, ...(code ? { code } : {}) }));
  const noCode = await failure(approve());
  expect([noCode.code, noCode.sqlstate]).toEqual(['refused', 'MS017']);
  expect((await failure(approve(used))).code).toBe('refused'); // the sign-in's own code, replayed
  const grants = async () => (await db.admin.query('select granted, max_test_recipients from platform.channel_grant where change_id = $1', [id])).rows;
  expect(await grants()).toEqual([]);
  await approve(codeOf(a, 1));
  expect(await grants()).toEqual([{ granted: true, max_test_recipients: 2 }]);
  const { rows } = await db.admin.query('select decided_by, decided_totp_at is not null as totp from platform.change where id = $1', [id]);
  expect(rows).toEqual([{ decided_by: a.operatorId, totp: true }]);
});
