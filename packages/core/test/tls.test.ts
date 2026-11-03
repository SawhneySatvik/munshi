import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterEach, describe, expect, test } from 'vitest';
import { applyDatabaseTls, databaseTls } from '../src/pool.ts';

// A hosted database is verified against its provider's root (deploy/supabase-root-2021.crt, Supabase's public
// "Supabase Root 2021 CA"), never by switching verification off; the setting's value never reaches an error.
const PEM = readFileSync(new URL('../../../deploy/supabase-root-2021.crt', import.meta.url), 'utf8');

describe('the database TLS root', () => {
  afterEach(() => {
    pg.defaults.ssl = undefined as unknown as typeof pg.defaults.ssl;
  });

  test('unset changes nothing: a local connection keeps no TLS', () => {
    expect(databaseTls(undefined)).toBeUndefined();
    applyDatabaseTls(databaseTls(undefined));
    const c = new pg.Client({ connectionString: 'postgresql://u:p@127.0.0.1:5432/x' });
    expect((c as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl).toBeFalsy();
  });

  test('the PEM and its base64 both verify against the root, with verification on', () => {
    for (const raw of [PEM, Buffer.from(PEM).toString('base64')]) {
      expect(databaseTls(raw)).toEqual({ ca: PEM, rejectUnauthorized: true });
    }
  });

  test('after apply, a connection string with no sslmode carries the root and verifies', () => {
    applyDatabaseTls(databaseTls(Buffer.from(PEM).toString('base64')));
    const c = new pg.Client({ connectionString: 'postgresql://u:p@db.example.test:6543/postgres' });
    expect((c as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  test('a value that is no certificate is refused, naming the setting and never echoing the value', () => {
    const planted = 'not-a-certificate-5d1f2c';
    expect(() => databaseTls(planted)).toThrow('config: not valid: MUNSHI_DB_CA');
    try {
      databaseTls(planted);
    } catch (err) {
      expect(String(err)).not.toContain(planted);
    }
  });
});
