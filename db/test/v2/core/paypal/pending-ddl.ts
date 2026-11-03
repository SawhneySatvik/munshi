// PayPal's schema has landed (db/schema/24_paypal.sql, its manifest, and the seal's exemption in 90_seal.sql and gate G3);
// 01_ref.sql carries the paypal_clearing account and 15_trade_journal.sql the paypal tender, in place, and core's
// registries spread PAYPAL_COMMANDS and PAYPAL_QUERIES (commands.ts, queries.ts). What is left here: the manifest the
// PayPal gates read (the file itself), and the seal exemption PAYPAL0 reverts to prove the seal still refuses a command
// that writes no books table.
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
