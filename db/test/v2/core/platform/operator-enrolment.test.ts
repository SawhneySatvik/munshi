// ENROL1: a new operator on a hosted demo, end to end through the commands deploy/supabase.md runs. The
// seed's first operator ("Demo operator", its sign-in and identity subject in a 0600 file, as db/seed/hosted.ts writes
// it) exists; `pnpm platform:identity` makes the newcomer's password identity (its subject to a 0600 file, never the
// terminal); the Demo operator proposes and approves `operator subject=<newcomer>` with fresh codes through the platform
// CLI, whose approval writes the new authenticator URI to a 0600 file, never the terminal; the newcomer then signs in as
// the console does (the identity adapter's password, then core's TOTP sign-in). And the refusals: a subject with a shop
// membership, a code from outside the window, a code used twice. Never a mocked database.
// Red-proofs: test/v2/sabotage/operator.ts.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { passwordIdentity } from '../../../../../packages/adapters/identity/password.ts';
import { signInOperator } from '../../../../../packages/core/src/platform.ts';
import { hotp, stepAt } from '../../../../../packages/core/src/platform-totp.ts';
import { hostedOperator } from '../../../../seed/hosted.ts';
import { seedDevOperator } from '../../../../src/dev.ts';
import { main as cliMain } from '../../../../src/platform-cli.ts';
import { main as identityMain } from '../../../../src/platform-identity.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { bindLogin, invite, signUp } from '../../gates/fixture.ts';
import { builder } from '../../global-setup.ts';
import { codeOf, type Operator, rewind, SECRETS, secretOfUri } from './fixture.ts';

let db: TestDb;
let dir: string;
let env: Record<string, string>;
let demo: Operator;

const url = (user: string, password: string) => `postgres://${user}:${password}@127.0.0.1:${inject('pg17Port')}/${db.name}`;
const mode = (file: string) => (statSync(file).mode & 0o777).toString(8);
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

beforeAll(async () => {
  db = await openTestDb();
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-enrol-'));
  const m = builder();
  env = {
    PLATFORM_DATABASE_URL: url('munshi_platform', 'munshi_platform'),
    MUNSHI_PLATFORM_SECRET: SECRETS.platformSecret,
    MIGRATOR_DATABASE_URL: url(m.user, m.password),
    MUNSHI_IDENTITY_SECRET: SECRETS.identitySecret,
  };
  await db.sabotage();
}, 120_000);

// The hosted seed's operator, as db/seed/hosted.ts enrols it: its own options, through reseed's own step, without the
// shops. Seeded once, on first use inside a test, so a seed that throws fails the test rather than the file's setup.
let seeding: Promise<void> | undefined;
const demoSeeded = () =>
  (seeding ??= (async () => {
    const owner = await db.migrator();
    try {
      await seedDevOperator(owner, db.as('munshi_platform'), hostedOperator(SECRETS, path.join(dir, 'hosted-operator.json')), []);
    } finally {
      await owner.end();
    }
    const signIn = json(path.join(dir, 'hosted-operator.json'));
    const { rows } = await db.admin.query<{ id: string }>('select id from platform.operator where subject = $1', [signIn.subject ?? null]);
    demo = { operatorId: rows[0]?.id as string, subject: signIn.subject, secret: secretOfUri(signIn.otpauth) };
  })());
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db?.close();
});

// One run of a CLI's main(): what it printed and asked, in order, and its exit code; `answers` in the order asked.
async function run(main: typeof cliMain, args: string[], answers: string[] = []) {
  const said: string[] = [];
  const exit = await main(args, env, {
    out: (line) => said.push(line),
    ask: async (prompt) => {
      said.push(`ASK ${prompt}`);
      return answers.shift() ?? null;
    },
  });
  return { exit, said, text: said.join('\n') };
}
// The Demo operator's --subject and a code of a step its last sign-in did not use.
const asDemo = async () => {
  await rewind(db, demo);
  return ['--subject', demo.subject, '--code', codeOf(demo)];
};
async function makeIdentity(name: string, email: string, password: string) {
  const out = path.join(dir, `${name}-identity.json`);
  const made = await run(identityMain, ['--out', out], [email, name, password, password]);
  return { made, out, subject: made.exit === 0 ? (json(out).subject as string) : '' };
}
async function propose(subject: string, name: string): Promise<string> {
  const proposed = await run(cliMain, ['propose', 'operator', `subject=${subject}`, `display_name=${name}`, ...(await asDemo())]);
  expect(proposed.exit, proposed.text).toBe(0);
  return /^proposed ([0-9a-f-]{36})$/.exec(proposed.said[0] ?? '')?.[1] as string;
}
const operators = async (subject: string) => (await db.admin.query('select count(*)::int as n from platform.operator where subject = $1', [subject])).rows[0].n as number;

it('a new operator is enrolled through the CLI: an identity, a proposal and an approval by the seed’s operator with fresh codes, each secret only in a 0600 file; then signs in with password and code', async () => {
  // The seed's operator: named "Demo operator", its file 0600 and holding the subject the CLI's --subject takes.
  await demoSeeded();
  const seeded = path.join(dir, 'hosted-operator.json');
  expect(mode(seeded)).toBe('600');
  expect(json(seeded)).toMatchObject({ email: 'operator@example.invalid', displayName: 'Demo operator', subject: demo.subject, operatorId: demo.operatorId });
  expect(demo.operatorId).toMatch(/^[0-9a-f-]{36}$/);

  // The newcomer's identity: the subject to a 0600 file, never to the terminal; an existing file is never overwritten.
  const password = 'the newcomer’s own long password';
  const newcomer = await makeIdentity('Newcomer', 'Newcomer@Example.Invalid', password);
  expect(newcomer.made.exit, newcomer.made.text).toBe(0);
  expect(mode(newcomer.out)).toBe('600');
  expect(json(newcomer.out)).toEqual({ email: 'newcomer@example.invalid', displayName: 'Newcomer', subject: newcomer.subject });
  expect(newcomer.made.text).not.toContain(newcomer.subject);
  expect(newcomer.made.text).not.toContain(password);
  const again = await run(identityMain, ['--out', newcomer.out], ['other@example.invalid', 'Other', password, password]);
  expect([again.exit, again.said.at(-1)]).toEqual([1, `not made: ${newcomer.out} exists; move it away first (it may hold another identity's subject)`]);
  const twice = await makeIdentity('Twice', 'newcomer@example.invalid', password);
  expect([twice.made.exit, twice.made.said.at(-1)]).toEqual([1, 'not made: that email already has an identity']);
  // The identity alone is no operator: no code opens a console session for it.
  expect(await signInOperator(db.as('munshi_platform'), newcomer.subject, '123456', SECRETS.platformSecret)).toBeNull();

  // Proposed, then approved in a later command with a fresh code: the URI goes to its 0600 file, never the terminal.
  const id = await propose(newcomer.subject, 'Newcomer');
  expect(await operators(newcomer.subject)).toBe(0);
  const enrolment = path.join(dir, 'newcomer-enrolment.json');
  const approved = await run(cliMain, ['approve', id, ...(await asDemo()), '--out', enrolment], ['yes']);
  expect(approved.exit, approved.text).toBe(0);
  expect(approved.said.at(-1)).toBe(`approved ${id}`);
  expect(approved.text).not.toMatch(/otpauth|secret=/);
  expect(mode(enrolment)).toBe('600');
  const enrolled = json(enrolment);
  expect(enrolled).toMatchObject({ subject: newcomer.subject, changeId: id });
  expect(enrolled.otpauth).toMatch(/^otpauth:\/\/totp\/Munshi:Newcomer\?secret=[A-Z2-7]{32}&/);
  expect(await operators(newcomer.subject)).toBe(1);

  // The console's sign-in, its two halves: the identity adapter's password check, then a code from the new secret.
  const port = passwordIdentity({ pool: db.as('munshi_idp'), identitySecret: SECRETS.identitySecret });
  const ctx = { ipHash: randomBytes(32), botCheck: true };
  expect(await port.signIn({ email: 'newcomer@example.invalid', password: 'not the password at all' }, ctx)).toBeNull();
  const who = await port.signIn({ email: 'newcomer@example.invalid', password }, ctx);
  expect(who).toEqual({ provider: 'password', subject: newcomer.subject });
  const code = hotp(secretOfUri(enrolled.otpauth), stepAt(Date.now()));
  const session = await signInOperator(db.as('munshi_platform'), who?.subject as string, code, SECRETS.platformSecret);
  expect(session?.operatorId).toMatch(/^[0-9a-f-]{36}$/);
  const { rows } = await db.admin.query('select display_name, active from platform.operator where id = $1', [session?.operatorId]);
  expect(rows).toEqual([{ display_name: 'Newcomer', active: true }]);
});

it('refused: a subject with a shop membership at the approval, a code from outside the window, and a code used twice; nothing is enrolled and no file is written', async () => {
  await demoSeeded();
  // A shop's manager: the change is proposed, and refused at the approval by the platform guard.
  const shop = await signUp(db, 'enrol-member');
  const inv = await invite(db, shop, shop.owner, shop.manager);
  const member = await makeIdentity('Manager', 'manager@example.invalid', 'a long manager password');
  expect(member.made.exit, member.made.text).toBe(0);
  await bindLogin(db, shop, shop.manager, inv.id, member.subject);
  const memberChange = await propose(member.subject, 'Manager');
  const memberOut = path.join(dir, 'manager-enrolment.json');
  const refused = await run(cliMain, ['approve', memberChange, ...(await asDemo()), '--out', memberOut], ['yes']);
  expect([refused.exit, refused.said.at(-1)]).toEqual([1, 'refused: Not allowed. (refused MS007)']);
  expect(await operators(member.subject)).toBe(0);
  expect(() => statSync(memberOut)).toThrow();

  // A clean identity, proposed; its approval tried with a stale code and a used one.
  const later = await makeIdentity('Later', 'later@example.invalid', 'a long later password');
  const id = await propose(later.subject, 'Later');
  const out = path.join(dir, 'later-enrolment.json');
  const signInRefused = 'sign-in refused: the operator, or the code (a code counts once)';
  await rewind(db, demo);
  const stale = await run(cliMain, ['approve', id, '--subject', demo.subject, '--code', codeOf(demo, -2), '--out', out], ['yes']);
  expect([stale.exit, stale.said.at(-1)]).toEqual([1, signInRefused]);
  const used = await asDemo();
  const first = await run(cliMain, ['propose', 'reserved_slug', 'slug=enrol-once', ...used]);
  expect(first.exit, first.text).toBe(0);
  const replay = await run(cliMain, ['approve', id, ...used, '--out', out], ['yes']);
  expect([replay.exit, replay.said.at(-1)]).toEqual([1, signInRefused]);
  expect(await operators(later.subject)).toBe(0);
  expect(() => statSync(out)).toThrow();
  const { rows } = await db.admin.query('select verdict from platform.change where id = $1', [id]);
  expect(rows).toEqual([{ verdict: null }]);
});
