// GET /api/health (BLUEPRINT §4.5, §5.1): ok, the deployment, the schema sha's first 12 hex characters, its source, the
// region and the modes, uncached; never a secret, a URL or a count. Red-proofs: test/v2/sabotage/core-boot.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GET } from '../../../../../apps/web/app/api/health/route.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { goodEnv, restoreEnv, SCHEMA_SHA256, setEnv } from './lib.ts';

let db: TestDb;
beforeAll(async () => {
  db = await openTestDb();
  await db.sabotage();
});
afterAll(async () => {
  restoreEnv();
  await db?.close();
});

it("HEALTH1 /api/health reports ok, the deployment, the schema sha's first 12 hex characters and the modes; never a secret or a count", async () => {
  for (const [extra, region] of [[{}, null], [{ MUNSHI_AI: 'off', MUNSHI_SEND_MODE: 'live', VERCEL_REGION: 'bom1' }, 'bom1']] as const) {
    const env = { ...goodEnv(db), ...extra };
    setEnv(env);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deployment: 'demo',
      schema: SCHEMA_SHA256.slice(0, 12),
      source: 'schema',
      region,
      modelMode: 'recorded',
      sendMode: 'MUNSHI_SEND_MODE' in extra ? 'live' : 'recorded',
      ai: 'MUNSHI_AI' in extra ? 'off' : 'on',
    });
    expect(text).not.toMatch(/\d+\s*[,}]/); // no number anywhere
    for (const v of Object.values(env).filter((v) => v.length >= 8)) expect(text).not.toContain(v); // URLs, secret
    expect(text).not.toContain(SCHEMA_SHA256.slice(0, 13));
  }
});
