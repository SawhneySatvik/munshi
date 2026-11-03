// The media store: where a document's bytes live, by its storage key (ops.document.storage_key, always
// `t-<tenant id>/...`, the database's rule). The database keeps the id, the sha256 and the size; whoever serves bytes
// checks them against that sha256, so a store is trusted to hold bytes, never to vouch for them.
// Two stores: a folder on this machine (pnpm dev's .run/media, and the tests), and Supabase Storage over its REST API
// (one private bucket, the service-side secret key; nothing here is ever sent to a browser). A key that is not a
// tenant's path is refused before any file or request, so no key can climb out of the folder or the bucket.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Reads bytes by key; null when the store holds none (or cannot say). */
export type MediaReader = { read(storageKey: string): Promise<Buffer | null> };
/** And writes them: `put` resolves once the bytes are stored, and throws (naming no key, no secret) when they are not. */
export type MediaStore = MediaReader & { put(storageKey: string, bytes: Buffer, mime: string): Promise<void> };

const KEY = /^t-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9_-]{1,40}(\/[a-z0-9_-]{1,80})*(\.[a-z0-9]{2,5})?$/;

/** A storage key a store accepts: the tenant's prefix, lower-case segments, at most one extension, nothing that climbs. */
export const storableKey = (key: string): boolean => KEY.test(key) && key.length <= 300;

export class MediaError extends Error {
  readonly code: 'bad_key' | 'not_stored';
  constructor(code: 'bad_key' | 'not_stored') {
    super(`media: ${code}`);
    this.name = 'MediaError';
    this.code = code;
  }
}

/** A folder on this machine. Each write lands whole (a temp file renamed into place). */
export function localMediaStore(dir: string): MediaStore {
  const root = path.resolve(dir);
  const fileOf = (key: string) => (storableKey(key) ? path.join(root, ...key.split('/')) : null);
  return {
    read: async (key) => {
      const file = fileOf(key);
      if (!file) return null;
      try {
        return await readFile(file);
      } catch {
        return null;
      }
    },
    put: async (key, bytes) => {
      const file = fileOf(key);
      if (!file) throw new MediaError('bad_key');
      try {
        await mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.part`;
        await writeFile(temp, bytes, { mode: 0o600 });
        await rename(temp, file);
      } catch {
        throw new MediaError('not_stored');
      }
    },
  };
}

type Reply = { ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> };
export type StorageFetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: Uint8Array; signal: AbortSignal }) => Promise<Reply>;

/**
 * Supabase Storage (REST): POST /storage/v1/object/<bucket>/<key> stores the bytes (no upsert: a key is written once),
 * GET /storage/v1/object/<bucket>/<key> reads them back through the secret key (the bucket stays private; Meta fetches
 * a card through the app's own card route, never from Storage). The key goes in `apikey` and as the bearer, as
 * Supabase's own clients send it.
 */
export function supabaseMediaStore(opts: { url: string; secretKey: string; bucket: string; fetch?: StorageFetch; timeoutMs?: number }): MediaStore {
  const base = `${opts.url.replace(/\/+$/, '')}/storage/v1/object/${encodeURIComponent(opts.bucket)}`;
  const send = opts.fetch ?? (globalThis.fetch as unknown as StorageFetch);
  const headers = { apikey: opts.secretKey, authorization: `Bearer ${opts.secretKey}` };
  const signal = () => AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  return {
    read: async (key) => {
      if (!storableKey(key)) return null;
      try {
        const r = await send(`${base}/${key}`, { method: 'GET', headers, signal: signal() });
        return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      } catch {
        return null;
      }
    },
    put: async (key, bytes, mime) => {
      if (!storableKey(key)) throw new MediaError('bad_key');
      let r: Reply;
      try {
        r = await send(`${base}/${key}`, {
          method: 'POST',
          headers: { ...headers, 'content-type': mime, 'x-upsert': 'false', 'cache-control': 'no-store' },
          body: new Uint8Array(bytes),
          signal: signal(),
        });
      } catch {
        throw new MediaError('not_stored');
      }
      if (!r.ok) throw new MediaError('not_stored');
    },
  };
}
