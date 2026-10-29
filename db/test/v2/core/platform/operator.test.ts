// F4's operator rule and the operator's own lifecycle through core and `pnpm platform:operator` (BLUEPRINT §2.10.15,
// §3.2, §6.5): an operator identity is never bound to a shop and a member's identity never becomes an operator; the first
// operator is seeded only while none exists, later ones only by an approved change with a fresh code; the last active
// operator is never deactivated. Red-proofs: test/v2/sabotage/core-platform.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  approveChange,
  changeDiff,
  openOperatorSession,
  proposeChange,
  signInOperator,
  withOperator,
} from '../../../../../packages/core/src/platform.ts';
import { seedOperator } from '../../../../src/platform-operator.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { bindLogin, invite, signUp } from '../../gates/fixture.ts';
import { refused } from '../../gates/lib.ts';
import { addOperator, codeOf, failure, firstOperator, identity, type Operator, proposeAndApprove, rewind, SECRETS, signIn } from './fixture.ts';

let db: TestDb;
let a: Operator;

beforeAll(async () => {
  db = await openTestDb();
  a = await firstOperator(db, 'Asha');
  await db.sabotage();
});
afterAll(() => db?.close());

const platform = () => db.as('munshi_platform');

it('F4 an operator identity is never bound to a shop, and a member identity never becomes an operator', async () => {
  const shop = await signUp(db, 'plat-operator-shop');
  const inv = await invite(db, shop, shop.owner, shop.staff);
  const bind = await refused(bindLogin(db, shop, shop.staff, inv.id, a.subject));
  expect([bind.code, bind.message]).toEqual(['MS007', 'login refused: an operator identity is never bound to a shop']);
  // A manager's identity, bound to the shop first, is refused as an operator at the approval.
  const memberInvite = await invite(db, shop, shop.owner, shop.manager);
  const member = await identity(db);
  await bindLogin(db, shop, shop.manager, memberInvite.id, member);
  const err = await failure(proposeAndApprove(db, a, { kind: 'operator', set: { subject: member, display_name: 'Manager' } }));
  expect([err.code, err.sqlstate]).toEqual(['refused', 'MS007']);
  const { rows } = await db.admin.query('select count(*)::int as n from platform.operator where subject = $1', [member]);
  expect(rows).toEqual([{ n: 0 }]);
});

it('PLAT1 the first operator is seeded only while none exists; another is added only by an approved change with a fresh code; the last active operator is never deactivated', async () => {
  const c = await db.migrator();
  const second = await seedOperator(c, { email: 'second@example.invalid', password: 'a long test password', displayName: 'Second' }, SECRETS)
    .then(() => 'seeded')
    .catch((e: Error) => e.message)
    .finally(() => c.end());
  expect(second).toMatch(/an operator exists/);
  expect((await db.admin.query('select count(*)::int as n from platform.operator')).rows).toEqual([{ n: 1 }]);
  const first = await db.admin.query("select action, operator_id, entity_id from platform.audit_log where entity = 'platform.operator' order by seq limit 1");
  expect(first.rows).toEqual([{ action: 'operator.seed', operator_id: a.operatorId, entity_id: a.operatorId }]);

  // An operator change approved through a re-opened session, with no fresh code: refused.
  const subject = await identity(db);
  const s = await signIn(db, a);
  const { id } = await withOperator(platform(), s, (c) => proposeChange(c, { kind: 'operator', set: { subject, display_name: 'Bharat' } }));
  const cookie = await openOperatorSession(platform(), s.sessionId);
  if (!cookie) throw new Error('the session did not re-open');
  const diff = await withOperator(platform(), cookie, (c) => changeDiff(c, id));
  const stale = await failure(withOperator(platform(), cookie, (c) => approveChange(c, id, { digest: diff.digest, platformSecret: SECRETS.platformSecret })));
  expect([stale.code, stale.sqlstate]).toEqual(['refused', 'MS017']);
  const added = await withOperator(platform(), cookie, (c) =>
    approveChange(c, id, { digest: diff.digest, code: codeOf(a, 1), platformSecret: SECRETS.platformSecret }),
  );
  expect(added.enrolment?.otpauthUri).toMatch(/^otpauth:\/\/totp\/Munshi:Bharat\?secret=[A-Z2-7]{32}&issuer=Munshi&algorithm=SHA1&digits=6&period=30$/);
  const summary = await db.admin.query('select is_operator, memberships from ops.subject_summary where subject = $1', [subject]);
  expect(summary.rows).toEqual([{ is_operator: true, memberships: 0 }]);
  const chained = await db.admin.query<{ action: string }>('select action from platform.audit_log where change_id = $1 order by seq', [id]);
  expect(chained.rows.map((r) => r.action)).toEqual(['change.propose', 'change.approve', 'operator.add']);

  // Chitra, added by Asha, deactivates Asha (who can then no longer sign in) and Bharat; Chitra, the last, stays.
  const chitra = await addOperator(db, a, 'Chitra');
  await proposeAndApprove(db, chitra, { kind: 'operator', set: { id: a.operatorId, active: false } });
  await rewind(db, a);
  expect(await signInOperator(platform(), a.subject, codeOf(a), SECRETS.platformSecret)).toBeNull();
  const bharat = (await db.admin.query<{ id: string }>('select id from platform.operator where subject = $1', [subject])).rows[0]?.id as string;
  await proposeAndApprove(db, chitra, { kind: 'operator', set: { id: bharat, active: false } });
  const last = await failure(proposeAndApprove(db, chitra, { kind: 'operator', set: { id: chitra.operatorId, active: false } }));
  expect(last.code).toBe('refused');
  expect((await db.admin.query('select count(*)::int as n from platform.operator where active')).rows).toEqual([{ n: 1 }]);

  // Each operator entry is labelled by what changed, with ids only: the seed is the insert with no change, an add the
  // insert under one, a deactivation active going false under its change, and every other update a sign-in's TOTP step.
  const entries = async (id: string) =>
    (
      await db.admin.query<{ action: string; by_change: boolean; payload: unknown }>(
        "select action, change_id is not null as by_change, payload from platform.audit_log where entity = 'platform.operator' and entity_id = $1 order by seq",
        [id],
      )
    ).rows;
  const seed = { action: 'operator.seed', by_change: false, payload: {} };
  const add = { action: 'operator.add', by_change: true, payload: {} };
  const signedIn = { action: 'operator.sign_in', by_change: false, payload: {} };
  const deactivated = { action: 'operator.deactivate', by_change: true, payload: {} };
  const asha = await entries(a.operatorId);
  expect([asha[0], asha.at(-1)]).toEqual([seed, deactivated]);
  expect(asha.length).toBeGreaterThan(2);
  expect(asha.slice(1, -1)).toEqual(asha.slice(1, -1).map(() => signedIn));
  expect(await entries(bharat)).toEqual([add, deactivated]);
  const chitraEntries = await entries(chitra.operatorId);
  expect(chitraEntries.length).toBeGreaterThan(1);
  expect(chitraEntries).toEqual([add, ...chitraEntries.slice(1).map(() => signedIn)]);
});
