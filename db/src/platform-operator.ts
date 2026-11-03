// pnpm platform:operator — the first superadmin (BLUEPRINT §3.2, §6.5): an identity (a scrypt hash; the email only as
// its HMAC), a platform.operator row and its TOTP secret, sealed under MUNSHI_PLATFORM_SECRET. Written as the owner role
// while no operator exists, the platform guard's one exception (chained as operator.seed); refused once one exists,
// since later operators come only through an approved `operator` change. No route does this. The authenticator URI is
// printed once (a QR code would need a dependency) and the plaintext secret is never stored.
// CLI: MIGRATOR_DATABASE_URL (munshi_migrator, which may SET ROLE munshi_owner), MUNSHI_IDENTITY_SECRET and
// MUNSHI_PLATFORM_SECRET from the environment, never printed; the email, name and password from the terminal.
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { newTotpSecret, otpauthUri, sealSecret, databaseTls, applyDatabaseTls } from '@munshi/core';

// BLUEPRINT §6.2's parameters, stored on the row so the identity adapter can verify and later raise them. 128·N·r bytes
// is 128 MiB, above node's 32 MiB default, hence maxmem.
export const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };

export type Seeded = { operatorId: string; subject: string; totpSecret: Buffer; otpauthUri: string };

export type Person = { email: string; password: string; displayName: string };

// The password identity adapter's policy (packages/adapters/identity/password.ts: foldEmail, passwordAllowed) and the
// change payload's display name (no run of seven digits). `who` names the command in the message. Returns the folded email.
export function checkPerson(person: Person, who: string): string {
  const email = person.email.normalize('NFKC').toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 254) throw new Error(`${who}: that is not an email address`);
  if (person.password.length < 10 || person.password.length > 128 || person.password.normalize('NFKC').toLowerCase().trim() === email) {
    throw new Error(`${who}: a password is 10 to 128 characters, and not the email`);
  }
  if (!/^[A-Za-z0-9 _.:-]{1,40}$/.test(person.displayName) || /[0-9]{7}/.test(person.displayName)) {
    throw new Error(`${who}: a display name is 1 to 40 letters, digits, spaces or _.:-`);
  }
  return email;
}

// One password identity, inside the caller's transaction as the owner role (identity_guard stamps it 'seed'): a scrypt
// hash with a fresh salt, the email only as its HMAC. Returns its subject.
export async function insertIdentity(client: pg.ClientBase, email: string, password: string, identitySecret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024 });
  const emailHmac = createHmac('sha256', identitySecret).update(email).digest();
  const identity = await client.query<{ subject: string }>(
    'insert into idp.identity (email_hmac, password_hash, salt, params, verified_at) values ($1, $2, $3, $4, now()) returning subject::text',
    [emailHmac, hash, salt, JSON.stringify(SCRYPT)],
  );
  return identity.rows[0]?.subject as string;
}

export async function seedOperator(client: pg.ClientBase, person: Person, secrets: { identitySecret: string; platformSecret: string }): Promise<Seeded> {
  const email = checkPerson(person, 'platform:operator');
  if (secrets.identitySecret.length < 32 || secrets.platformSecret.length < 32) throw new Error('platform:operator: each secret is at least 32 characters');
  const secret = newTotpSecret();
  await client.query('begin');
  try {
    await client.query('set local role munshi_owner');
    const subject = await insertIdentity(client, email, person.password, secrets.identitySecret);
    const op = await client.query<{ id: string }>('insert into platform.operator (subject, display_name, totp_secret_enc) values ($1, $2, $3) returning id', [
      subject,
      person.displayName,
      sealSecret(secret, subject, secrets.platformSecret),
    ]);
    await client.query('commit');
    return { operatorId: op.rows[0]?.id as string, subject, totpSecret: secret, otpauthUri: otpauthUri(secret, person.displayName) };
  } catch (err) {
    await client.query('rollback');
    const code = (err as { code?: string }).code;
    // As the owner, the platform guard refuses an operator only while one already exists.
    if (code === 'MS017') throw new Error('platform:operator: an operator exists; add another through an approved operator change (pnpm platform:identity, then platform:propose operator)');
    if (code === '23505') throw new Error('platform:operator: that email already has an identity');
    throw err;
  }
}

// One answer from the terminal, its echo off for a password. The line iterator buffers, so piped answers are not lost
// between prompts as readline's question() would lose them.
async function ask(lines: AsyncIterator<string>, prompt: string, hidden = false): Promise<string> {
  const tty = hidden && process.stdin.isTTY;
  process.stdout.write(prompt);
  if (tty) spawnSync('stty', ['-echo'], { stdio: 'inherit' });
  try {
    const next = await lines.next();
    return next.done ? '' : next.value.trim();
  } finally {
    if (tty) {
      spawnSync('stty', ['echo'], { stdio: 'inherit' });
      process.stdout.write('\n');
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root (deploy/supabase.md)
  if (process.argv.length > 2) throw new Error(`platform:operator takes no arguments, not ${process.argv.slice(2).join(' ')}`);
  const url = process.env.MIGRATOR_DATABASE_URL;
  const identitySecret = process.env.MUNSHI_IDENTITY_SECRET;
  const platformSecret = process.env.MUNSHI_PLATFORM_SECRET;
  if (!url || !identitySecret || !platformSecret) throw new Error('MIGRATOR_DATABASE_URL, MUNSHI_IDENTITY_SECRET and MUNSHI_PLATFORM_SECRET must be set');
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const email = await ask(lines, 'Email: ');
  const displayName = await ask(lines, 'Display name: ');
  const password = await ask(lines, 'Password (not shown): ', true);
  if ((await ask(lines, 'The password again: ', true)) !== password) throw new Error('platform:operator: the passwords differ');
  rl.close();
  const client = new pg.Client({ connectionString: url, application_name: 'munshi_platform_operator' });
  await client.connect();
  try {
    const seeded = await seedOperator(client, { email, password, displayName }, { identitySecret, platformSecret });
    console.log(`operator ${seeded.operatorId}, identity ${seeded.subject}`);
    console.log('Add this to an authenticator app now. It is shown once and cannot be shown again:');
    console.log(seeded.otpauthUri);
  } finally {
    await client.end();
  }
}
