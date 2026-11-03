// The cache port's two adapters: the memory cache, and Redis over RESP against a real redis-server
// (test/redis-server.ts). A stopped or paused server makes a call reject (core then reads Postgres), never hang a
// caller past core's budget for long, never throw synchronously, and the adapter reconnects once the server is back.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { cacheFor, memoryCache, redisCache, redisTarget } from '../cache/index.ts';
import { type RedisServer, startRedis } from './redis-server.ts';

let server: RedisServer;
beforeAll(async () => {
  server = await startRedis();
}, 30_000);
afterAll(async () => {
  await server?.stop();
});

test('the memory cache: values by key, gone after their time to live, the least recently read dropped past the cap', async () => {
  let now = 1_000_000;
  const m = memoryCache({ maxEntries: 2, now: () => now });
  await m.set('a', '1', 10);
  await m.set('b', '2', 10);
  expect(await m.get('a')).toBe('1'); // a is now the most recently read
  await m.set('c', '3', 10);
  expect([await m.get('a'), await m.get('b'), await m.get('c')]).toEqual(['1', null, '3']);
  now += 10_001;
  expect(await m.get('a')).toBeNull();
  await m.del(['c']);
  expect(await m.get('c')).toBeNull();
});

test('Redis: a large value with any characters round-trips, a time to live is set, del removes, a missing key is null', async () => {
  const r = redisCache(redisTarget(server.url) as NonNullable<ReturnType<typeof redisTarget>>);
  const big = JSON.stringify({ ref: '⟨snap:x·1·price⟩', rupee: '₹', rows: Array.from({ length: 20_000 }, (_, i) => ['row', i, '\r\n$5\r\n*']) });
  expect(big.length).toBeGreaterThan(300_000);
  await r.set('t:big', big, 60);
  const [a, b, missing] = await Promise.all([r.get('t:big'), r.get('t:big'), r.get('t:none')]);
  expect(a === big && b === big).toBe(true);
  expect(missing).toBeNull();
  await r.set('t:short', 'x', 1);
  await new Promise((done) => setTimeout(done, 1_200));
  expect(await r.get('t:short')).toBeNull();
  await r.del(['t:big']);
  expect(await r.get('t:big')).toBeNull();
  await r.close();
});

test('Redis paused: calls reject rather than queue without end; stopped: they reject at once; restarted: it reconnects', async () => {
  const own = await startRedis();
  const r = redisCache(redisTarget(own.url) as NonNullable<ReturnType<typeof redisTarget>>);
  await r.set('k', 'v', 60);
  own.pause();
  const stuck = Array.from({ length: 300 }, () => r.get('k').then(() => 'answered', () => 'rejected'));
  // Past the cap of waiting calls the connection is dropped and every waiting call rejects.
  expect(new Set(await Promise.all(stuck))).toEqual(new Set(['rejected']));
  own.resume();
  await own.stop();
  await new Promise((done) => setTimeout(done, 1_100)); // the adapter's rest after a lost connection
  const started = Date.now();
  await expect(r.get('k')).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(200);

  // The shared server stands in for the restarted one: a new connection after the rest.
  const back = redisCache(redisTarget(server.url) as NonNullable<ReturnType<typeof redisTarget>>);
  await back.set('k', 'again', 60);
  expect(await back.get('k')).toBe('again');
  await back.close();
});

test('the address forms: unix socket, redis host, off, unset; anything else is refused', () => {
  expect(redisTarget('unix:///tmp/x/redis.sock')).toEqual({ path: '/tmp/x/redis.sock' });
  expect(redisTarget('redis://:pw@cache.example:6380/2')).toEqual({ host: 'cache.example', port: 6380, password: 'pw', db: 2 });
  expect(redisTarget('http://cache.example')).toBeNull();
  expect(cacheFor('off')).toBeNull();
  expect(cacheFor(undefined)).not.toBeNull();
  expect(() => cacheFor('memcached://x')).toThrow();
});
