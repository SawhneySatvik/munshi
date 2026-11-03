// Makes the private Supabase Storage bucket the app keeps uploaded pictures in (deploy/supabase.md, step 9), through
// Storage's REST API with the project's secret key. Safe to run again: a private bucket of that name is left as it is;
// a public one is refused, never changed. Prints the bucket's name and what happened, never the key.
//
//   node --env-file=<file with SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET> deploy/storage-bucket.ts
//
// The key goes in `apikey` and as the bearer, as packages/adapters/media sends it.
import { fileURLToPath } from 'node:url';

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
export type BucketFetch = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<Reply>;

/** Creates the bucket unless it exists; 'exists' only for a private one. Throws on a public bucket or a failed call. */
export async function ensureBucket(opts: { url: string; secretKey: string; bucket: string; fetch?: BucketFetch }): Promise<'created' | 'exists'> {
  // The same rules boot applies to these settings (packages/config's media settings).
  if (!/^https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?\/?$/.test(opts.url)) throw new Error('storage-bucket: SUPABASE_URL must be the project’s https origin');
  if (!/^[a-z0-9][a-z0-9_.-]{2,62}$/.test(opts.bucket)) throw new Error('storage-bucket: SUPABASE_STORAGE_BUCKET is not a valid bucket name');
  if (!/^[A-Za-z0-9._-]{20,1000}$/.test(opts.secretKey)) throw new Error('storage-bucket: SUPABASE_SECRET_KEY is missing or malformed');
  const send = opts.fetch ?? (globalThis.fetch as unknown as BucketFetch);
  const base = `${opts.url.replace(/\/+$/, '')}/storage/v1/bucket`;
  const headers = { apikey: opts.secretKey, authorization: `Bearer ${opts.secretKey}` };

  const found = await send(`${base}/${encodeURIComponent(opts.bucket)}`, { method: 'GET', headers });
  if (found.ok) {
    const bucket = (await found.json()) as { public?: unknown };
    if (bucket.public !== false) throw new Error(`storage-bucket: bucket ${opts.bucket} exists and is not private; make it private in the dashboard, or choose another name`);
    return 'exists';
  }
  // Storage answers a missing bucket with 400 or 404 (UNVERIFIED which); anything else is not "absent".
  if (found.status !== 400 && found.status !== 404) throw new Error(`storage-bucket: reading bucket ${opts.bucket} failed (HTTP ${found.status})`);
  const made = await send(base, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ id: opts.bucket, name: opts.bucket, public: false }),
  });
  if (!made.ok) throw new Error(`storage-bucket: creating bucket ${opts.bucket} failed (HTTP ${made.status})`);
  return 'created';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('storage-bucket takes no arguments; its settings come from --env-file');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? '';
  const result = await ensureBucket({ url: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY ?? '', bucket });
  console.log(`storage-bucket: ${bucket} ${result === 'created' ? 'created, private' : 'already exists, private'}`);
}
