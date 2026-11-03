// The media store (media/index.ts): a folder on this machine, and Supabase Storage over its REST API, here a real HTTP
// server on localhost that answers as Storage does (POST and GET /storage/v1/object/<bucket>/<key>). Bytes go in and
// come back whole by key; a key that is not a tenant's path never reaches a file or a request; a failure names no key
// and no secret.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { localMediaStore, MediaError, supabaseMediaStore } from '../media/index.ts';

const TENANT = randomUUID();
const key = () => `t-${TENANT}/card/${randomUUID()}.jpg`;
const BAD = ['../etc/passwd', `t-${TENANT}/../t-${randomUUID()}/x.jpg`, `t-${TENANT}`, `t-not-a-tenant/card/a.jpg`, `T-${TENANT}/card/a.jpg`, `t-${TENANT}/card/a b.jpg`];

it('MEDIA1 the local store writes bytes under the key and reads them back whole; an unknown key reads null; a key outside a tenant path is refused before any file', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-media-'));
  // The store one level down, so a key that climbs (when the check is broken) still lands in this temp folder.
  const store = localMediaStore(path.join(dir, 'store'));
  const [k, bytes] = [key(), randomBytes(500)];
  await store.put(k, bytes, 'image/jpeg');
  expect((await store.read(k))?.equals(bytes)).toBe(true);
  expect(await store.read(key())).toBeNull();
  for (const bad of BAD) {
    await expect(store.put(bad, bytes, 'image/jpeg'), bad).rejects.toThrow(MediaError);
    expect(await store.read(bad), bad).toBeNull();
  }
  rmSync(dir, { recursive: true, force: true });
});

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer };
let server: Server;
let base: string;
const seen: Seen[] = [];
const objects = new Map<string, Buffer>();
let failNext = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const authed = req.headers.apikey === SECRET && req.headers.authorization === `Bearer ${SECRET}`;
      const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(req.url ?? '');
      if (!authed || !m || m[1] !== 'munshi-media' || failNext) {
        failNext = false;
        res.writeHead(authed ? 500 : 400, { 'content-type': 'application/json' }).end('{"error":"nope"}');
        return;
      }
      const name = m[2] as string;
      if (req.method === 'POST') {
        if (objects.has(name)) return void res.writeHead(409).end('{"error":"Duplicate"}');
        objects.set(name, body);
        return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ Key: `munshi-media/${name}` }));
      }
      const held = objects.get(name);
      if (!held) return void res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"not_found","statusCode":"404"}');
      res.writeHead(200, { 'content-type': 'image/jpeg' }).end(held);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const SECRET = `sb_secret_${randomBytes(16).toString('hex')}`;

it("MEDIA2 Supabase Storage: a put is one POST to the bucket's object path with the secret key, the type and no upsert; a read GETs the same bytes back; a missing object, a failure and a key outside a tenant path are null or refused, naming no key and no secret", async () => {
  const store = supabaseMediaStore({ url: `${base}/`, secretKey: SECRET, bucket: 'munshi-media' });
  const [k, bytes] = [key(), randomBytes(700)];
  await store.put(k, bytes, 'image/jpeg');
  expect(seen.map((s) => [s.method, s.url, s.headers['content-type'], s.headers['x-upsert'], s.body.equals(bytes)])).toEqual([
    ['POST', `/storage/v1/object/munshi-media/${k}`, 'image/jpeg', 'false', true],
  ]);
  expect((await store.read(k))?.equals(bytes)).toBe(true);
  expect(seen.at(-1)?.method).toBe('GET');
  expect(await store.read(key())).toBeNull();
  // A key is written once: a second put of it is refused by Storage, and so fails.
  const twice = await store.put(k, bytes, 'image/jpeg').catch((e: unknown) => e);
  failNext = true;
  const failed = await store.put(key(), bytes, 'image/jpeg').catch((e: unknown) => e);
  for (const err of [twice, failed]) {
    expect(err).toBeInstanceOf(MediaError);
    expect((err as MediaError).code).toBe('not_stored');
    for (const text of [String(err), inspect(err), (err as Error).stack ?? '']) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(TENANT);
    }
  }
  // A wrong key reads nothing; a store that cannot be reached reads null and fails a put.
  expect(await supabaseMediaStore({ url: base, secretKey: 'sb_secret_wrong_wrong_wrong', bucket: 'munshi-media' }).read(k)).toBeNull();
  const down = supabaseMediaStore({ url: 'http://127.0.0.1:1', secretKey: SECRET, bucket: 'munshi-media' });
  expect(await down.read(k)).toBeNull();
  await expect(down.put(key(), bytes, 'image/jpeg')).rejects.toThrow(MediaError);
  const before = seen.length;
  for (const bad of BAD) {
    await expect(store.put(bad, bytes, 'image/jpeg'), bad).rejects.toThrow(MediaError);
    expect(await store.read(bad), bad).toBeNull();
  }
  expect(seen.length).toBe(before);
});
