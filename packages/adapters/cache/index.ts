// The cache port (BLUEPRINT §4.8, decision 19): strings by key with a time to live, and two adapters, `memory` (one
// process: tests and a deploy with no Redis) and `redis` (RESP over node:net, no client library: a Unix socket locally,
// a TCP address deployed). Only core's cache-keys.ts calls a port, with keys core's cacheKey built; what is cached
// (pinned releases and snapshots, the slug lookup) and the 50 ms budget are core's. An adapter never throws at its
// caller for Redis being down or slow: a call rejects, and core reads Postgres instead.
import { connect, type Socket } from 'node:net';

export type CachePort = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<void>;
  close(): Promise<void>;
};

/** One process's cache: at most `maxEntries`, the least recently read dropped first. */
export function memoryCache(opts: { maxEntries?: number; now?: () => number } = {}): CachePort {
  const max = opts.maxEntries ?? 5000;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, { value: string; expires: number }>();
  return {
    async get(key) {
      const e = entries.get(key);
      if (!e) return null;
      entries.delete(key);
      if (e.expires <= now()) return null;
      entries.set(key, e);
      return e.value;
    },
    async set(key, value, ttlSeconds) {
      entries.delete(key);
      entries.set(key, { value, expires: now() + ttlSeconds * 1000 });
      while (entries.size > max) entries.delete(entries.keys().next().value as string);
    },
    async del(keys) {
      for (const k of keys) entries.delete(k);
    },
    async close() {
      entries.clear();
    },
  };
}

// ---- Redis, as RESP2 over one connection ----

class RespError extends Error {}
type Reply = string | number | null | RespError | Reply[];

const CRLF = Buffer.from('\r\n');

function encode(args: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(a, 'utf8');
    parts.push(Buffer.from(`$${b.length}\r\n`), b, CRLF);
  }
  return Buffer.concat(parts);
}

// One reply from `buf` at `at`, and where the next begins; null while it has not all arrived.
function parse(buf: Buffer, at: number): [Reply, number] | null {
  if (at >= buf.length) return null;
  const eol = buf.indexOf(CRLF, at);
  if (eol < 0) return null;
  const line = buf.toString('utf8', at + 1, eol);
  const next = eol + 2;
  switch (buf[at]) {
    case 0x2b: // +
      return [line, next];
    case 0x2d: // -
      return [new RespError(line), next];
    case 0x3a: // :
      return [Number(line), next];
    case 0x24: {
      // $
      const n = Number(line);
      if (n < 0) return [null, next];
      if (buf.length < next + n + 2) return null;
      return [buf.toString('utf8', next, next + n), next + n + 2];
    }
    case 0x2a: {
      // *
      const n = Number(line);
      if (n < 0) return [null, next];
      const items: Reply[] = [];
      let p = next;
      for (let i = 0; i < n; i++) {
        const r = parse(buf, p);
        if (!r) return null;
        items.push(r[0]);
        p = r[1];
      }
      return [items, p];
    }
    default:
      throw new RespError('unexpected reply');
  }
}

export type RedisTarget = { path: string } | { host: string; port: number; password?: string; db?: number };

/** `unix:///abs/path.sock` or `redis://[:password@]host:port[/db]`; anything else is null. */
export function redisTarget(url: string): RedisTarget | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol === 'unix:') return u.pathname.startsWith('/') && !u.host ? { path: decodeURIComponent(u.pathname) } : null;
  if (u.protocol !== 'redis:' || !u.hostname) return null;
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined;
  if (db !== undefined && !(Number.isInteger(db) && db >= 0 && db < 16)) return null;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(db !== undefined ? { db } : {}),
  };
}

const MAX_PENDING = 256;
const REST_MS = 1000;

/** Redis over one lazily opened connection; after a lost connection it rests a second before trying again. */
export function redisCache(target: RedisTarget): CachePort {
  let socket: Socket | null = null;
  let buf: Buffer = Buffer.alloc(0);
  let pending: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];
  let restUntil = 0;

  const fail = (s: Socket) => {
    if (socket !== s) return;
    socket = null;
    buf = Buffer.alloc(0);
    const waiting = pending;
    pending = [];
    restUntil = Date.now() + REST_MS;
    for (const p of waiting) p.reject(new Error('cache: connection lost'));
  };

  const open = (): Socket => {
    const s = 'path' in target ? connect({ path: target.path }) : connect({ host: target.host, port: target.port });
    s.setNoDelay(true);
    s.unref(); // a cache connection never keeps a process alive
    s.on('data', (chunk: Buffer) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      try {
        for (let r = parse(buf, 0); r; r = parse(buf, 0)) {
          buf = buf.subarray(r[1]);
          const p = pending.shift();
          if (r[0] instanceof RespError) p?.reject(r[0]);
          else p?.resolve(r[0]);
        }
      } catch {
        s.destroy();
        fail(s);
      }
    });
    s.on('error', () => fail(s));
    s.on('close', () => fail(s));
    return s;
  };

  const send = (args: string[]): Promise<Reply> => {
    if (Date.now() < restUntil) return Promise.reject(new Error('cache: resting'));
    // Replies that never come (a stopped server) must not pile up: past the cap the connection is dropped.
    if (pending.length >= MAX_PENDING && socket) {
      socket.destroy();
      fail(socket);
      return Promise.reject(new Error('cache: not answering'));
    }
    if (!socket) {
      socket = open();
      if ('host' in target && target.password) void sendOn(socket, ['AUTH', target.password]).catch(() => {});
      if ('host' in target && target.db !== undefined) void sendOn(socket, ['SELECT', String(target.db)]).catch(() => {});
    }
    return sendOn(socket, args);
  };

  const sendOn = (s: Socket, args: string[]) =>
    new Promise<Reply>((resolve, reject) => {
      pending.push({ resolve, reject });
      s.write(encode(args));
    });

  return {
    async get(key) {
      const r = await send(['GET', key]);
      return typeof r === 'string' ? r : null;
    },
    async set(key, value, ttlSeconds) {
      await send(['SET', key, value, 'EX', String(Math.max(1, Math.round(ttlSeconds)))]);
    },
    async del(keys) {
      if (keys.length) await send(['DEL', ...keys]);
    },
    async close() {
      const s = socket;
      socket = null;
      s?.end();
    },
  };
}

/**
 * The adapter MUNSHI_CACHE_URL names (packages/config checks its form): unset or empty, the memory cache; `off`, none;
 * else Redis at that address.
 */
export function cacheFor(url: string | undefined): CachePort | null {
  if (!url) return memoryCache();
  if (url === 'off') return null;
  const target = redisTarget(url);
  if (!target) throw new Error('cache: MUNSHI_CACHE_URL is not a redis:// or unix:// address');
  return redisCache(target);
}
