// PayPal's schema has landed (db/schema/24_paypal.sql, its manifest, and the seal's exemption in 90_seal.sql and gate G3);
// 01_ref.sql carries the paypal_clearing account and 15_trade_journal.sql the paypal tender, in place. What is left
// here: the manifest the PayPal gates read (the file itself), the seal exemption PAYPAL0 reverts to prove the seal still
// refuses a command that writes no books table, and the registry lines held for the orchestrator to wire.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { COMMANDS } from '../../../../../packages/core/src/commands.ts';
import { PAYPAL_COMMANDS } from '../../../../../packages/core/src/commands-paypal.ts';
import { QUERIES } from '../../../../../packages/core/src/queries.ts';
import { PAYPAL_QUERIES } from '../../../../../packages/core/src/queries-paypal.ts';

/** db/schema/24_paypal.manifest.json, as landed. */
export const PAYPAL_MANIFEST = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', '..', '..', '..', 'schema', '24_paypal.manifest.json'), 'utf8'),
) as {
  tables: string[];
  globalTables: string[];
  appendOnly: string[];
  functions: string[];
  indexes: Record<string, string>;
  grants: Record<string, Record<string, string>>;
  policies: Record<string, string[]>;
  uuidv7Ids: string[];
};

/** The exemption command totality carries, in 90_seal.sql and in gate G3 (02-books-guard.test.ts), both: the two PayPal
 * commands write no books table (their effect is the ops outbox row). `from` is the seal without it. */
export const SEAL_EXEMPTION = {
  from: 'case when not exists (select 1 from ref.command_table t where t.command = c.command) then',
  to: "case when c.command not in ('paypal.request', 'paypal.cancel') and not exists (select 1 from ref.command_table t where t.command = c.command) then",
  whereFrom: '     where not exists (select 1 from ref.command_table t where t.command = c.command)\n        or',
  whereTo: "     where (c.command not in ('paypal.request', 'paypal.cancel') and not exists (select 1 from ref.command_table t where t.command = c.command))\n        or",
};

/**
 * The registry lines that land with the DDL (commands.ts spreads PAYPAL_COMMANDS, queries.ts PAYPAL_QUERIES): held out
 * of the registries until the migrator lands the tables and ref rows, since CAP1 requires every registered command to
 * have its ref.command_capability rows. Registered here for this test file only, as hooks.test.ts registers a command.
 */
export function registerPendingPaypal(): void {
  const commands = COMMANDS as Map<string, (typeof PAYPAL_COMMANDS)[number][1]>;
  for (const [name, def] of PAYPAL_COMMANDS) if (!commands.has(name)) commands.set(name, def);
  const queries = QUERIES as Map<string, (typeof PAYPAL_QUERIES)[number][1]>;
  for (const [name, q] of PAYPAL_QUERIES) if (!queries.has(name)) queries.set(name, q);
}

/** The schema has the PayPal tables: nothing is applied (kept so the PayPal gates' setup reads as before). */
export async function applyPendingPaypalDdl(migrator: () => Promise<pg.Client>): Promise<'present'> {
  const m = await migrator();
  try {
    const { rows } = await m.query<{ present: boolean }>(
      `select exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ops' and c.relname = 'paypal_link') as present`,
    );
    if (!rows[0]?.present) throw new Error('db/schema lacks ops.paypal_link: 24_paypal.sql did not build');
    return 'present';
  } finally {
    await m.end();
  }
}
