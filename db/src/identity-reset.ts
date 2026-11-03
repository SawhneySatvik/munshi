// pnpm identity:reset — the operator's password reset for an identity no in-app reset reaches (an in-app reset is only
// downward and only for a one-shop identity): an owner's, one that belongs to two shops, an operator's. A terminal
// command and no route: the operator checks the person out of band first. The email and the new password come from the
// terminal (the password twice, never echoed and never printed); the new password gets a fresh salt, and every session
// of the identity, in each shop and the console, ends (core's resetIdentityAsOperator), all in one transaction as the
// owner role.
// Env: MIGRATOR_DATABASE_URL (munshi_migrator, which may SET ROLE munshi_owner) and MUNSHI_IDENTITY_SECRET, never
// printed. Exit 0 done; 1 no such identity, the passwords differ or one is refused; 2 an argument or a setting.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { CoreError, resetIdentityAsOperator, databaseTls, applyDatabaseTls } from '@munshi/core';
import pg from 'pg';

export type Io = { out: (line: string) => void; ask: (prompt: string, hidden?: boolean) => Promise<string | null> };

class Usage extends Error {}

export async function main(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  if (argv.length > 0) throw new Usage(`identity:reset takes no arguments, not ${argv.join(' ')}`);
  const url = env.MIGRATOR_DATABASE_URL;
  const secret = env.MUNSHI_IDENTITY_SECRET;
  if (!url || !secret) throw new Usage('MIGRATOR_DATABASE_URL and MUNSHI_IDENTITY_SECRET must be set');
  const email = (await io.ask('Email: ')) ?? '';
  const password = (await io.ask('New password (not shown): ', true)) ?? '';
  if ((await io.ask('The new password again: ', true)) !== password) {
    io.out('not reset: the passwords differ');
    return 1;
  }
  const client = new pg.Client({ connectionString: url, application_name: 'munshi_identity_reset' });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local role munshi_owner');
    const done = await resetIdentityAsOperator(client, { email, password }, secret);
    await client.query(done ? 'commit' : 'rollback');
    io.out(done ? `reset identity ${done.subject}; ${done.sessionsEnded} sessions ended` : 'not reset: no identity has that email');
    return done ? 0 : 1;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    if (!(err instanceof CoreError)) throw new Error('identity:reset: the database refused the reset');
    io.out('not reset: a password is 10 to 128 characters, and not the email');
    return 1;
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
