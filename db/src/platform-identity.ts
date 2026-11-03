// pnpm platform:identity — a password identity for a new operator (BLUEPRINT §6.5): the step before an `operator` change,
// which names an identity by its subject. Once the first operator exists (the seed's, or `pnpm platform:operator`'s),
// this is how anyone else, the founder included, becomes one: this command makes the identity, an existing operator
// proposes and approves `operator subject=<subject>` with fresh codes (`pnpm platform:propose` / `platform:approve`), and
// the approval mints the TOTP secret and writes the new operator's authenticator URI to its own 0600 file. The identity
// alone signs in nowhere: it is in no shop, and the console takes only an active operator's code.
// Written as the owner role (identity_guard stamps it 'seed', the operator path's stamp), with the identity adapter's
// password rule. The email, display name and password come from the terminal (the password twice, never echoed); the
// email, display name and subject go to a new file (default .run/platform-identity.json, mode 0600), never to the
// terminal, and an existing file is never overwritten. No route does this.
//   node db/src/platform-identity.ts [--out <file>]
// Env: MIGRATOR_DATABASE_URL (munshi_migrator, which may SET ROLE munshi_owner) and MUNSHI_IDENTITY_SECRET, never
// printed. Exit 0 made; 1 refused (the email has an identity, a rule, the passwords differ); 2 an argument or a setting.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applyDatabaseTls, databaseTls } from '@munshi/core';
import pg from 'pg';
import { checkPerson, insertIdentity } from './platform-operator.ts';

export type Io = { out: (line: string) => void; ask: (prompt: string, hidden?: boolean) => Promise<string | null> };

class Usage extends Error {}

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_OUT = path.join(ROOT, '.run', 'platform-identity.json');

export async function main(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  let out = DEFAULT_OUT;
  if (argv.length === 2 && argv[0] === '--out' && argv[1]) out = path.resolve(argv[1]);
  else if (argv.length === 1 && argv[0]?.startsWith('--out=') && argv[0].length > 6) out = path.resolve(argv[0].slice(6));
  else if (argv.length > 0) throw new Usage(`platform:identity takes only --out <file>, not ${argv.join(' ')}`);
  const url = env.MIGRATOR_DATABASE_URL;
  const secret = env.MUNSHI_IDENTITY_SECRET;
  if (!url || !secret) throw new Usage('MIGRATOR_DATABASE_URL and MUNSHI_IDENTITY_SECRET must be set');
  if (secret.length < 32) throw new Usage('MUNSHI_IDENTITY_SECRET is at least 32 characters');
  if (existsSync(out)) {
    io.out(`not made: ${out} exists; move it away first (it may hold another identity's subject)`);
    return 1;
  }
  const email = (await io.ask('Email: ')) ?? '';
  const displayName = (await io.ask('Display name: ')) ?? '';
  const password = (await io.ask('Password (not shown): ', true)) ?? '';
  if ((await io.ask('The password again: ', true)) !== password) {
    io.out('not made: the passwords differ');
    return 1;
  }
  let folded: string;
  try {
    folded = checkPerson({ email, password, displayName }, 'platform:identity');
  } catch (err) {
    io.out(`not made: ${(err as Error).message.replace(/^platform:identity: /, '')}`);
    return 1;
  }
  const client = new pg.Client({ connectionString: url, application_name: 'munshi_platform_identity' });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role munshi_owner');
    const subject = await insertIdentity(client, folded, password, secret);
    // Written before the commit, so a file that cannot be written leaves no identity behind it.
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
    writeFileSync(out, `${JSON.stringify({ email: folded, displayName, subject }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(out, 0o600); // the umask may have narrowed the create mode; never wider than 0600
    await client.query('commit');
    io.out(`made a password identity for an operator; its subject is in ${path.relative(process.cwd(), out) || out} (0600)`);
    io.out('next: an existing operator proposes it: pnpm platform:propose operator subject=<subject> display_name=<name> --subject <their subject> --code <code>');
    return 0;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    if ((err as { code?: string }).code === '23505') {
      io.out('not made: that email already has an identity');
      return 1;
    }
    if (err instanceof Error && 'syscall' in err) throw err; // the file, not the database: nothing was committed
    throw new Error('platform:identity: the database refused the identity');
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root (deploy/supabase.md)
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const io: Io = {
    out: (line) => console.log(line),
    // The line iterator buffers, so piped answers are not lost between prompts; the echo is off for a password.
    ask: async (prompt, hidden = false) => {
      const tty = hidden && process.stdin.isTTY;
      process.stdout.write(prompt);
      if (tty) spawnSync('stty', ['-echo'], { stdio: 'inherit' });
      try {
        const next = await lines.next();
        return next.done ? null : next.value.trim();
      } finally {
        if (tty) {
          spawnSync('stty', ['echo'], { stdio: 'inherit' });
          process.stdout.write('\n');
        }
      }
    },
  };
  try {
    process.exitCode = await main(process.argv.slice(2), process.env, io);
  } catch (err) {
    if (!(err instanceof Usage)) throw err;
    console.error(err.message);
    process.exitCode = 2;
  } finally {
    rl.close();
  }
}
