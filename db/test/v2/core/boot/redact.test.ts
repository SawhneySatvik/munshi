// Secrets never reach an error or a log line (BLUEPRINT §4.3, §4.5): a planted secret, set as each kind of setting or
// passed into every log field, is scanned for in every rendering of each error, in the refusal the request hook and
// health answer, and in every line written. Red-proofs: test/v2/sabotage/core-boot.ts.
import { randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { GET as health } from '../../../../../apps/web/app/api/health/route.ts';
import { boot } from '../../../../../apps/web/lib/server/db.ts';
import { withRequest } from '../../../../../packages/core/src/context.ts';
import { type LogFields, log } from '../../../../../packages/core/src/log.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { goodEnv, loadNext, type Next, restoreEnv, roleUrl, setEnv } from './lib.ts';

let db: TestDb;
let next: Next;
beforeAll(async () => {
  next = await loadNext();
  db = await openTestDb();
  await db.sabotage();
});
afterAll(async () => {
  restoreEnv();
  await db?.close();
});

const refusal = (p: Promise<unknown>) => p.then(() => new Error('boot accepted'), (err: unknown) => err as Error);
const renderings = (err: Error) => [err.message, err.stack ?? '', String(err), inspect(err), JSON.stringify(err)];

async function capture<T>(fn: () => Promise<T> | T): Promise<{ out: T; lines: string[] }> {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    }),
  );
  try {
    return { out: await fn(), lines };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

it('REDACT1 a planted secret never reaches an error of config or boot, the refusal the hook or health answers, or a log line', async () => {
  const secret = randomBytes(32).toString('hex'); // shaped like the session secret
  const password = randomBytes(32).toString('base64url'); // shaped like a hosted database password
  const planted = [secret, password];
  const env = goodEnv(db);
  const cases: [string, Record<string, string | undefined>][] = [
    ['a missing setting beside the secret', { ...env, MUNSHI_SESSION_SECRET: secret, MUNSHI_DEMO_TENANT_ID: undefined }],
    ['a session secret that is not 32 bytes of hex', { ...env, MUNSHI_SESSION_SECRET: `${secret}-${password}` }],
    ['a database URL with no host', { ...env, DATABASE_URL: `postgres://munshi_app:${password}@` }],
    ['a database URL that is not a URL', { ...env, JOBS_DATABASE_URL: `munshi_jobs:${password}` }],
    ['a wrong password', { ...env, AGENT_DATABASE_URL: roleUrl(db, 'munshi_agent', password) }],
    ['a server that does not answer', { ...env, PLATFORM_DATABASE_URL: `postgres://munshi_platform:${password}@127.0.0.1:1/${db.name}` }],
  ];
  const { lines } = await capture(async () => {
    for (const [label, e] of cases) {
      setEnv(e);
      const err = await refusal(boot());
      expect(err.message, label).toMatch(/^(config|boot): /);
      for (const text of renderings(err)) for (const p of planted) expect(text, label).not.toContain(p);
      const hook = await next.proxy(next.request('http://localhost/counter'));
      const healthBody = await (await health()).text();
      expect(hook.status, label).toBe(503);
      for (const text of [await hook.text(), healthBody, JSON.stringify([...hook.headers])]) {
        for (const p of planted) expect(text, label).not.toContain(p);
      }
    }
  });
  // Every refusal was logged (one line per request the hook refused), by code.
  expect(lines).toHaveLength(cases.length);
  for (const line of lines) {
    expect(JSON.parse(line)).toMatchObject({ level: 'error', event: 'boot.refused', code: expect.stringMatching(/^[a-z_]+$/) });
    for (const p of planted) expect(line).not.toContain(p);
  }
});

it('REDACT1 a log line carries only its fixed fields: a planted secret in any of them is dropped, never written', async () => {
  const secret = randomBytes(32).toString('hex');
  const tenantId = randomUUID();
  const good: LogFields = { route: '/bills/[id]', code: 'wrong_role', sqlstate: '42501', pool: 'jobs', names: ['DATABASE_URL'], status: 503, durationMs: 12 };
  const { lines } = await capture(() =>
    withRequest({ requestId: 'req-1', tenantId }, () => {
      log('boot.refused', good, 'error');
      log('boot.refused', {
        route: `/x/${secret}`,
        tenantId: secret,
        code: secret,
        sqlstate: secret,
        pool: secret,
        names: ['DATABASE_URL', secret],
        status: Number(`1${secret.replace(/\D/g, '').slice(0, 20)}`),
        durationMs: -1,
      });
      log(secret, {});
      log('request.done', { body: secret, phone: secret } as unknown as LogFields);
    }),
  );
  expect(lines).toHaveLength(4);
  const [first, second, third, fourth] = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(first).toEqual({ time: expect.any(String), level: 'error', event: 'boot.refused', requestId: 'req-1', tenantId, ...good });
  expect(new Date(first!.time as string).toISOString()).toBe(first!.time);
  expect(second).toEqual({
    time: expect.any(String),
    level: 'info',
    event: 'boot.refused',
    requestId: 'req-1',
    tenantId,
    dropped: ['route', 'tenantId', 'code', 'sqlstate', 'pool', 'names', 'status', 'durationMs'],
  });
  expect(third).toMatchObject({ event: 'unlabelled', dropped: ['event'] });
  expect(Object.keys(fourth!).sort()).toEqual(['event', 'level', 'requestId', 'tenantId', 'time']);
  for (const line of lines) expect(line).not.toContain(secret);
});
