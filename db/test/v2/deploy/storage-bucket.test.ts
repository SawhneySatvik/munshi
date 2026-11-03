// BUCKET1 (deploy/storage-bucket.ts): the private Storage bucket for uploaded pictures, against a recorded stand-in for
// Storage's REST API (no network). Absent, it is created private; present and private, it is left alone; present and
// public, it is refused and nothing is sent; the key never appears in an error.
// Red-proofs: test/v2/sabotage/deploy-prep.ts.
import { expect, it } from 'vitest';
import { type BucketFetch, ensureBucket } from '../../../../deploy/storage-bucket.ts';

const URL = 'https://abcd.supabase.co';
const KEY = `sb_secret_${'s'.repeat(32)}`;
type Call = { method: string; url: string; headers: Record<string, string>; body?: unknown };

/** A stand-in Storage: `bucket` is what the GET finds (null: none), `create` the POST's status. */
function storage(bucket: { public: boolean } | null, create = 200) {
  const calls: Call[] = [];
  const fetch: BucketFetch = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    if (init.method === 'GET') {
      return bucket ? { ok: true, status: 200, json: async () => ({ id: 'munshi-media', name: 'munshi-media', ...bucket }) } : { ok: false, status: 400, json: async () => ({ error: 'Bucket not found' }) };
    }
    return { ok: create < 300, status: create, json: async () => ({ name: 'munshi-media' }) };
  };
  return { calls, fetch };
}

const refusal = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
};

it('BUCKET1 an absent bucket is created private; a private one is left alone; a public one is refused and nothing is sent', async () => {
  const absent = storage(null);
  expect(await ensureBucket({ url: URL, secretKey: KEY, bucket: 'munshi-media', fetch: absent.fetch })).toBe('created');
  expect(absent.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${URL}/storage/v1/bucket/munshi-media`, `POST ${URL}/storage/v1/bucket`]);
  expect(absent.calls[1]?.body).toEqual({ id: 'munshi-media', name: 'munshi-media', public: false });
  for (const c of absent.calls) expect(c.headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}` });

  const kept = storage({ public: false });
  expect(await ensureBucket({ url: `${URL}/`, secretKey: KEY, bucket: 'munshi-media', fetch: kept.fetch })).toBe('exists');
  expect(kept.calls.map((c) => c.method)).toEqual(['GET']);

  const open = storage({ public: true });
  expect(await refusal(() => ensureBucket({ url: URL, secretKey: KEY, bucket: 'munshi-media', fetch: open.fetch }))).toBe(
    'storage-bucket: bucket munshi-media exists and is not private; make it private in the dashboard, or choose another name',
  );
  expect(open.calls.map((c) => c.method)).toEqual(['GET']);
});

it('BUCKET1 a failed call, a bad name, URL or key is refused, and no error carries the key', async () => {
  const failed = storage(null, 403);
  const message = await refusal(() => ensureBucket({ url: URL, secretKey: KEY, bucket: 'munshi-media', fetch: failed.fetch }));
  expect(message).toBe('storage-bucket: creating bucket munshi-media failed (HTTP 403)');
  const none = storage(null);
  for (const [opts, error] of [
    [{ url: URL, secretKey: KEY, bucket: 'Has Spaces' }, 'SUPABASE_STORAGE_BUCKET is not a valid bucket name'],
    [{ url: 'http://abcd.supabase.co', secretKey: KEY, bucket: 'munshi-media' }, 'SUPABASE_URL must be the project’s https origin'],
    [{ url: URL, secretKey: '', bucket: 'munshi-media' }, 'SUPABASE_SECRET_KEY is missing or malformed'],
  ] as const) {
    const m = await refusal(() => ensureBucket({ ...opts, fetch: none.fetch }));
    expect(m).toBe(`storage-bucket: ${error}`);
    expect(m).not.toContain(KEY);
  }
  expect(none.calls).toEqual([]);
});
