// MS-13: scripts/deploy-check.ts refuses wrong logins. Run against a real migrated database with the real roles
// (the owner, a superuser and a nobody stand in for the wrong ones).
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { deployCheck } from '../src/deploy-check.ts';
import { openTestDb, type TestDb } from './db.ts';

let db: TestDb;
let url: (user: string, password: string) => string;
beforeAll(async () => {
  db = await openTestDb();
  const port = inject('pgPort');
  url = (user, password) => `postgres://${user}:${password}@127.0.0.1:${port}/${db.name}`;
  await db.admin.query(`alter role munshi_migrator password 'munshi_migrator'`);
});
afterAll(() => db.close());

const good = () => ({ DATABASE_URL: url('munshi_app', 'munshi_app'), MIGRATOR_DATABASE_URL: url('munshi_migrator', 'munshi_migrator'), AGENT_DATABASE_URL: url('munshi_agent', 'munshi_agent') });

it('MS-13 deploy-check passes the intended logins', async () => {
  expect(await deployCheck(good())).toEqual([]);
});

it('MS-13 deploy-check refuses a superuser app login', async () => {
  const problems = await deployCheck({ ...good(), DATABASE_URL: url('postgres', 'postgres') });
  expect(problems).toContain('DATABASE_URL: connects as the wrong login, expected munshi_app');
  expect(problems).toContain('DATABASE_URL: the login is a superuser');
});

it('MS-13 deploy-check refuses the migrator as the app login (owner role power) and the app as the migrator', async () => {
  const migrator = url('munshi_migrator', 'munshi_migrator');
  const asApp = await deployCheck({ ...good(), DATABASE_URL: migrator });
  expect(asApp).toContain('DATABASE_URL: connects as the wrong login, expected munshi_app');
  expect(asApp).toContain('DATABASE_URL: the login is a member of munshi_owner');
  const asMigrator = await deployCheck({ ...good(), MIGRATOR_DATABASE_URL: url('munshi_app', 'munshi_app') });
  expect(asMigrator).toContain('MIGRATOR_DATABASE_URL: connects as the wrong login, expected munshi_migrator');
});

it('MS-13 deploy-check refuses one URL for both, a missing URL, and a wrong password without printing any URL', async () => {
  const same = url('munshi_app', 'munshi_app');
  expect(await deployCheck({ ...good(), MIGRATOR_DATABASE_URL: same })).toContain(
    'DATABASE_URL and MIGRATOR_DATABASE_URL are the same URL: the app must not hold the migrator login',
  );
  expect(await deployCheck({ DATABASE_URL: same })).toEqual(['MIGRATOR_DATABASE_URL is not set']);
  const wrong = await deployCheck({ ...good(), DATABASE_URL: url('munshi_app', 'hunter2-not-the-password') });
  expect(wrong).toEqual(['DATABASE_URL: cannot connect (28P01)']);
  expect(wrong.join()).not.toContain('hunter2');
});
