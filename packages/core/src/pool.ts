// The app pool, connected as munshi_app: the only pool that can write. packages/agent never imports it (a gate); the
// agent holds its own pool as the read-only munshi_agent role.
import pg from 'pg';

export function createAppPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max, application_name: 'munshi_app' });
}
