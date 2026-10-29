// `pnpm identity:reset` as the real process (db/src/identity-reset.ts): the answers come on stdin, the identity's
// sessions end, the outcome is one line, and the password appears in nothing it prints; a refused password exits 1,
// a stray argument or a missing setting exits 2. Red-proofs: test/v2/sabotage/core-auth.ts.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { resumeSession } from '../../../../../packages/core/src/session.ts';
import type { TestDb } from '../../db.ts';
import { ctx, emailFor, IDENTITY_SECRET, join, liveDb, liveShop, portOf } from './fixture.ts';

let db: TestDb;

beforeAll(async () => {
  db = await liveDb();
  await db.sabotage();
});
afterAll(() => db?.close());

const SCRIPT = path.join(import.meta.dirname, '../../../../src/identity-reset.ts');

it('RESET1 the identity:reset process takes its answers on stdin, ends the identity’s sessions and prints no password; a refused password exits 1, a stray argument or a missing setting 2', async () => {
  const port = portOf(db);
  const shop = await liveShop(db);
  const email = emailFor('cli-owner');
  const opened = await join(db, port, shop, shop.owner, email);
  const env = {
    PATH: process.env.PATH ?? '',
    MIGRATOR_DATABASE_URL: `postgres://munshi_migrator:munshi_migrator@127.0.0.1:${inject('pg17Port')}/${db.name}`,
    MUNSHI_IDENTITY_SECRET: IDENTITY_SECRET,
  };
  const run = (input: string, args: string[] = [], extra = env) => spawnSync(process.execPath, [SCRIPT, ...args], { env: extra, input, encoding: 'utf8' });
  const password = 'the process set this one';
  const done = run(`${email}\n${password}\n${password}\n`);
  expect([done.status, done.stderr]).toEqual([0, '']);
  expect(done.stdout).toMatch(/reset identity [0-9a-f-]{36}; 1 sessions ended\n$/);
  expect(done.stdout).not.toContain(password);
  const claim = { tenantId: opened.session.tenantId, memberId: opened.session.memberId, sessionId: opened.session.sessionId as string, via: 'real' as const };
  expect(await resumeSession(db.as('munshi_app'), claim)).toBeNull();
  expect(await port.signIn({ email, password }, ctx())).not.toBeNull();
  const short = run(`${email}\nshort\nshort\n`);
  expect([short.status, short.stdout.trim().split('\n').at(-1)]).toEqual([1, 'Email: New password (not shown): The new password again: not reset: a password is 10 to 128 characters, and not the email']);
  const stray = run('', ['--now']);
  expect([stray.status, stray.stderr.trim()]).toEqual([2, 'identity:reset takes no arguments, not --now']);
  const unset = run('', [], { PATH: env.PATH, MIGRATOR_DATABASE_URL: env.MIGRATOR_DATABASE_URL, MUNSHI_IDENTITY_SECRET: '' });
  expect([unset.status, unset.stderr.trim()]).toEqual([2, 'MIGRATOR_DATABASE_URL and MUNSHI_IDENTITY_SECRET must be set']);
});
