// ROBOTS1: the superadmin console shares the site but asks not to be indexed. The request hook (apps/web/proxy.ts) sets
// `X-Robots-Tag: noindex, nofollow` on /platform and every path under it, whether boot passes or refuses, and on no other
// path. robots.txt is not the way: listing /platform there would advertise it (UNLINKED1 scans that nothing names it).
// Red-proofs: test/v2/sabotage/operator.ts.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { goodEnv, loadNext, type Next, restoreEnv, setEnv, signInKeys } from './lib.ts';

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

const CONSOLE = ['/platform', '/platform/', '/platform/sign-in', '/platform/changes/0198a0b0-0000-7000-8000-000000000001', '/platform/operators?x=1'];
const ELSEWHERE = ['/', '/app', '/demo', '/developers', '/sign-in', '/s/elite', '/platformx', '/app/platform', '/api/health'];

it('ROBOTS1 /platform and every path under it carry X-Robots-Tag noindex, nofollow, served or refused at boot; no other path does', async () => {
  const tags = async () => {
    const out: Record<string, string | null> = {};
    for (const at of [...CONSOLE, ...ELSEWHERE]) out[at] = (await next.proxy(next.request(`http://localhost${at}`))).headers.get('x-robots-tag');
    return out;
  };
  const expected = Object.fromEntries([...CONSOLE.map((p) => [p, 'noindex, nofollow']), ...ELSEWHERE.map((p) => [p, null])]);
  setEnv(goodEnv(db));
  expect(await tags()).toEqual(expected);
  // Boot refused (a live config on a demo database): every route answers 503, and the console's still carry the tag.
  setEnv({ ...goodEnv(db), ...signInKeys(), MUNSHI_DEPLOYMENT: 'live' });
  expect((await next.proxy(next.request('http://localhost/platform/sign-in'))).status).toBe(503);
  expect(await tags()).toEqual(expected);
});
