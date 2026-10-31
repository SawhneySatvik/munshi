// pnpm platform:* — the superadmin's changes from the command line until the console exists (BLUEPRINT §6.5, D-049):
// the same core paths and the same approved drafts. Every write first signs the operator in with a TOTP code; the
// password half is the identity adapter's (BP-AUTH-1), and this tool holds only the platform role's connection. `approve`
// prints the exact diff, then asks; only "yes" approves, and core refuses the approval if the diff changed since it was
// printed. `list` reads without a code, and exits 1 if the platform chain does not verify.
//   node db/src/platform-cli.ts list [--pending]
//   node db/src/platform-cli.ts propose <kind> [--tenant <slug>] key=value … --subject <operator subject> --code <totp>
//   node db/src/platform-cli.ts approve <change-id> --subject <operator subject> --code <totp>
//   node db/src/platform-cli.ts reject <change-id> --subject <operator subject> --code <totp>
// Env: PLATFORM_DATABASE_URL (munshi_platform) and MUNSHI_PLATFORM_SECRET, never printed. A code counts once, so two
// commands by one operator take codes from two different 30-second steps.
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  CoreError,
  approveChange,
  type ChangeKind,
  changeDiff,
  type PlatformDiff,
  listChanges,
  proposeChange,
  rejectChange,
  signInOperator,
  type PlatformValue,
  verifyPlatformChain,
  withOperator,
  databaseTls,
  applyDatabaseTls,
} from '@munshi/core';

export type Io = { out: (line: string) => void; ask: (prompt: string) => Promise<string | null> };

const VERBS: Record<string, string[]> = { list: ['pending'], propose: ['tenant', 'subject', 'code'], approve: ['subject', 'code'], reject: ['subject', 'code'] };
const FLAGS_WITHOUT_VALUE = ['pending'];

class Usage extends Error {}

// `--flag value` and `--flag=value` both; an unknown flag is refused, never ignored.
function parse(argv: string[]): { verb: string; args: string[]; flags: Record<string, string> } {
  const [verb = '', ...rest] = argv;
  const known = VERBS[verb];
  if (!known) throw new Usage(`usage: platform-cli.ts ${Object.keys(VERBS).join('|')} … (see the head of db/src/platform-cli.ts)`);
  const args: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith('--')) {
      args.push(arg);
      continue;
    }
    const [name = '', inline] = arg.slice(2).split(/=(.*)/s);
    if (!known.includes(name)) throw new Usage(`unknown option ${arg}`);
    if (name in flags) throw new Usage(`--${name} is given twice`);
    if (FLAGS_WITHOUT_VALUE.includes(name) && inline !== undefined) throw new Usage(`--${name} takes no value`);
    const value = FLAGS_WITHOUT_VALUE.includes(name) ? 'true' : (inline ?? rest[++i]);
    if (value === undefined || value === '') throw new Usage(`--${name} needs a value`);
    flags[name] = value;
  }
  return { verb, args, flags };
}

// key=value: true, false, null and whole numbers as themselves; anything else as text.
function setting(arg: string): [string, PlatformValue] {
  const m = /^([a-z_]+)=(.*)$/s.exec(arg);
  if (!m) throw new Usage(`expected key=value, not ${arg}`);
  const raw = m[2] as string;
  const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : /^[0-9]{1,9}$/.test(raw) ? Number(raw) : raw;
  return [m[1] as string, value];
}

const shown = (v: PlatformValue) => (v === null ? 'none' : String(v));

function printDiff(io: Io, d: PlatformDiff, slug: string | null): void {
  io.out(`change ${d.changeId} · ${d.kind} · ${d.tenantId ? `tenant ${d.tenantId}${slug ? ` (${slug})` : ''}` : 'global'} · ${d.verdict ?? 'pending'}`);
  const width = Math.max(...d.fields.map((f) => f.key.length)) + 1;
  for (const f of d.fields) {
    io.out(`  ${f.key.padEnd(width)} ${f.before === f.after ? `${shown(f.before)} (unchanged)` : `${shown(f.before)} → ${shown(f.after)}`}`);
  }
  const from = d.from ? `${d.from.table} ${d.from.id}${d.from.changeId ? ` (change ${d.from.changeId})` : ''}` : 'no row';
  io.out(`  before: ${from}; each after is in the change payload`);
}

async function slugOf(c: pg.ClientBase, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  const { rows } = await c.query<{ slug: string }>('select slug from ops.tenant_directory where tenant_id = $1', [tenantId]);
  return rows[0]?.slug ?? null;
}

export async function main(argv: string[], env: Record<string, string | undefined>, io: Io): Promise<number> {
  const { verb, args, flags } = parse(argv);
  const url = env.PLATFORM_DATABASE_URL;
  if (!url) throw new Usage('PLATFORM_DATABASE_URL (the munshi_platform connection) is not set');
  const pool = new pg.Pool({ connectionString: url, max: 2, application_name: 'munshi_platform_cli' });
  try {
    if (verb === 'list') {
      const c = await pool.connect();
      try {
        for (const ch of await listChanges(c, { pending: flags.pending === 'true' })) {
          const decided = ch.verdict ? `${ch.verdict} by ${ch.decidedBy}` : 'pending';
          io.out(`${ch.id}  ${ch.kind}  ${ch.tenantId ?? 'global'}  proposed ${ch.proposedAt} by ${ch.proposedBy}  ${decided}`);
        }
        const broken = await verifyPlatformChain(c);
        io.out(broken ? `platform chain BROKEN at seq ${broken}` : 'platform chain verifies');
        return broken ? 1 : 0;
      } finally {
        c.release();
      }
    }
    const secret = env.MUNSHI_PLATFORM_SECRET;
    if (!secret) throw new Usage('MUNSHI_PLATFORM_SECRET is not set');
    if (!flags.subject || !flags.code) throw new Usage(`${verb} needs --subject and --code`);
    const session = await signInOperator(pool, flags.subject, flags.code, secret);
    if (!session) {
      io.out('sign-in refused: the operator, or the code (a code counts once)');
      return 1;
    }
    if (verb === 'propose') {
      const [kind, ...settings] = args;
      if (!kind) throw new Usage('propose needs a kind');
      const set = Object.fromEntries(settings.map(setting));
      const diff = await withOperator(pool, session, async (c) => {
        let tenantId: string | null = null;
        if (flags.tenant) {
          const { rows } = await c.query<{ tenant_id: string }>('select tenant_id from ops.tenant_directory where slug = $1', [flags.tenant]);
          tenantId = rows[0]?.tenant_id ?? null;
          if (!tenantId) throw new CoreError('not_found');
        }
        const { id } = await proposeChange(c, { kind: kind as ChangeKind, tenantId, set });
        return { diff: await changeDiff(c, id), slug: flags.tenant ?? null };
      });
      io.out(`proposed ${diff.diff.changeId}`);
      printDiff(io, diff.diff, diff.slug);
      return 0;
    }
    const [changeId] = args;
    if (!changeId || args.length > 1) throw new Usage(`${verb} takes one change id`);
    if (verb === 'reject') {
      await withOperator(pool, session, (c) => rejectChange(c, changeId));
      io.out(`rejected ${changeId}`);
      return 0;
    }
    const { diff, slug } = await withOperator(pool, session, async (c) => {
      const d = await changeDiff(c, changeId);
      return { diff: d, slug: await slugOf(c, d.tenantId) };
    });
    printDiff(io, diff, slug);
    io.out(`  digest ${diff.digest}`);
    const answer = await io.ask('Approve exactly this change? Type yes to approve: ');
    if (answer?.trim() !== 'yes') {
      io.out('not approved: nothing was written');
      return 1;
    }
    const approval = await withOperator(pool, session, (c) => approveChange(c, changeId, { digest: diff.digest, platformSecret: secret }));
    if (approval.enrolment) {
      io.out('The new operator adds this to an authenticator app now. It is shown once and cannot be shown again:');
      io.out(approval.enrolment.otpauthUri);
    }
    io.out(`approved ${changeId}`);
    return 0;
  } catch (err) {
    if (!(err instanceof CoreError)) throw err;
    io.out(`refused: ${err.message} (${err.code}${err.sqlstate ? ` ${err.sqlstate}` : ''})`);
    return 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root (deploy/supabase.md)
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const io: Io = {
    out: (line) => console.log(line),
    ask: async (prompt) => {
      process.stdout.write(prompt);
      const next = await lines.next();
      return next.done ? null : next.value;
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
