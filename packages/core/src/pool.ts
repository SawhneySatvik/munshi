// The app pool, connected as munshi_app: the only pool that can write. packages/agent never imports it (a gate); the
// agent holds its own pool as the read-only munshi_agent role.
import pg from 'pg';

export function createAppPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: 'munshi_app' });
}

export type DatabaseTls = { ca: string; rejectUnauthorized: true };

/**
 * The database's TLS trust from MUNSHI_DB_CA: a hosted Postgres whose certificate chains to its provider's own root
 * (Supabase's "Supabase Root 2021 CA") is verified against that root, never by turning verification off. The value is
 * the PEM, or the PEM in base64 (one line, for .env files). Unset: undefined. The error names the setting, never a value.
 */
export function databaseTls(raw: string | undefined): DatabaseTls | undefined {
  if (!raw) return undefined;
  const pem = raw.includes('-----BEGIN CERTIFICATE-----') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('config: not valid: MUNSHI_DB_CA');
  return { ca: pem, rejectUnauthorized: true };
}

/**
 * Every pool and client this process opens afterwards verifies the server against `ssl.ca` (pg's defaults apply to any
 * connection string that names no sslmode, so hosted URLs carry none). Called once at boot; undefined changes nothing.
 */
export function applyDatabaseTls(ssl: DatabaseTls | undefined): void {
  if (ssl) pg.defaults.ssl = ssl;
}
