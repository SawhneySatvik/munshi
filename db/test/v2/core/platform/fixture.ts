// Shared by the platform core suites (test/v2/core/platform): the first operator, seeded by `pnpm platform:operator`'s own
// function; codes minted from an operator's secret; sign-in through core; and a second operator added through an approved
// `operator` change. Never mock the database: the platform guard, the change guard and the chain are under test.
import { randomBytes, randomUUID } from 'node:crypto';
import type { CoreError } from '../../../../../packages/core/src/errors.ts';
import {
  approveChange,
  changeDiff,
  type OperatorSession,
  proposeChange,
  signInOperator,
  withOperator,
} from '../../../../../packages/core/src/platform.ts';
import { hotp, stepAt } from '../../../../../packages/core/src/platform-totp.ts';
import { seedOperator } from '../../../../src/platform-operator.ts';
import type { TestDb } from '../../db.ts';
import { sha } from '../../gates/fixture.ts';
import { asOwner, plant } from '../../gates/lib.ts';

export const SECRETS = {
  identitySecret: 'identity-secret-for-the-v2-tests-only-0001',
  platformSecret: 'platform-secret-for-the-v2-tests-only-0001',
};
export type Operator = { operatorId: string; subject: string; secret: Buffer };

export async function firstOperator(db: TestDb, name = 'Asha'): Promise<Operator> {
  const c = await db.migrator();
  try {
    const seeded = await seedOperator(c, { email: `${name.toLowerCase()}@example.invalid`, password: 'a long test password', displayName: name }, SECRETS);
    return { operatorId: seeded.operatorId, subject: seeded.subject, secret: seeded.totpSecret };
  } finally {
    await c.end();
  }
}

// The code of the current 30-second step, or of a step `offset` away.
export const codeOf = (op: Operator, offset = 0) => hotp(op.secret, stepAt(Date.now()) + offset);

// Only three steps are open at a time and each counts once, so the fixture first rewinds the operator's last used step:
// as the superuser with triggers off, setting up a past, never the write under test.
export async function rewind(db: TestDb, op: Operator): Promise<void> {
  await plant(db.admin, 'update platform.operator set totp_last_step = 0 where id = $1', [op.operatorId]);
}

export async function signIn(db: TestDb, op: Operator): Promise<OperatorSession> {
  await rewind(db, op);
  const s = await signInOperator(db.as('munshi_platform'), op.subject, codeOf(op), SECRETS.platformSecret);
  if (!s) throw new Error('fixture: the sign-in was refused');
  return s;
}

// Proposed in one sign-in's transaction, approved in a later one by `approver` (the proposer by default), the diff as shown.
export async function proposeAndApprove(db: TestDb, by: Operator, input: Parameters<typeof proposeChange>[1], approver: Operator = by) {
  const platform = db.as('munshi_platform');
  const { id } = await withOperator(platform, await signIn(db, by), (c) => proposeChange(c, input));
  const s = await signIn(db, approver);
  const diff = await withOperator(platform, s, (c) => changeDiff(c, id));
  const approval = await withOperator(platform, s, (c) => approveChange(c, id, { digest: diff.digest, platformSecret: SECRETS.platformSecret }));
  return { id, diff, approval };
}

// An identity made as the owner, as the identity adapter does from an invite (no production path for a second
// operator's identity exists before it).
export async function identity(db: TestDb): Promise<string> {
  const subject = randomUUID();
  await asOwner(db.admin, [
    `insert into idp.identity (subject, email_hmac, password_hash, salt, params, verified_at)
     values ('${subject}', '\\x${sha(subject).toString('hex')}', '\\x${randomBytes(64).toString('hex')}', '\\x${randomBytes(16).toString('hex')}', '{}', now())`,
  ]);
  return subject;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function unbase32(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s) {
    value = ((value << 5) | B32.indexOf(ch)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The TOTP secret an authenticator URI carries. */
export const secretOfUri = (uri: string) => unbase32(new URL(uri).searchParams.get('secret') ?? '');

// A second operator through an approved `operator` change: the enrolment URI the approval returns carries its secret.
export async function addOperator(db: TestDb, by: Operator, name: string): Promise<Operator> {
  const subject = await identity(db);
  const { approval } = await proposeAndApprove(db, by, { kind: 'operator', set: { subject, display_name: name } });
  const secret = secretOfUri(approval.enrolment?.otpauthUri ?? '');
  const { rows } = await db.admin.query<{ id: string }>('select id from platform.operator where subject = $1', [subject]);
  return { operatorId: rows[0]?.id as string, subject, secret };
}

// The CoreError a call raised; a call that succeeds fails the test.
export async function failure(p: Promise<unknown>): Promise<CoreError> {
  try {
    await p;
  } catch (e) {
    if ((e as Error).name !== 'CoreError') throw e;
    return e as CoreError;
  }
  throw new Error('expected a refusal, but the call succeeded');
}
