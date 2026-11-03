// Supabase Auth's email (identity/supabase-email.ts) with no network: a scripted fetch that answers as Supabase Auth's
// REST API does (POST /auth/v1/otp, POST /auth/v1/verify with type email). The link is asked for with the publishable
// key and a redirect; the token hash is spent once, and only a confirmed email comes back; every failure is false or
// null, never a throw carrying the email, the key or the hash.
import { expect, test } from 'vitest';
import { type FetchLike, supabaseEmail } from '../identity/supabase-email.ts';

const URL_ = 'https://abcdefghijklmnop.supabase.co';
const KEY = 'sb_publishable_test_key_0123456789abcdef';
const HASH = 'pkce_0123456789abcdef0123456789abcdef';

type Call = { url: string; headers: Record<string, string>; body: unknown };
function scripted(answers: ({ status: number; body: unknown } | 'throw')[]) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const a = answers.shift();
    if (!a || a === 'throw') throw new Error(`network down for ${url} ${init.body}`);
    return { ok: a.status >= 200 && a.status < 300, json: async () => a.body };
  };
  return { calls, fetch };
}

test('sendLink asks Supabase for a one-time link to the redirect, with the publishable key; any failure is false', async () => {
  const s = scripted([{ status: 200, body: {} }, { status: 429, body: { msg: 'rate limited' } }, 'throw']);
  const email = supabaseEmail({ url: `${URL_}/`, publishableKey: KEY, fetch: s.fetch });
  expect(await email.sendLink('owner@example.invalid', 'https://munshi.example/sign-up/confirm')).toBe(true);
  expect(s.calls[0]).toEqual({
    url: `${URL_}/auth/v1/otp?redirect_to=${encodeURIComponent('https://munshi.example/sign-up/confirm')}`,
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: { email: 'owner@example.invalid', create_user: true },
  });
  expect(await email.sendLink('owner@example.invalid', 'https://munshi.example/sign-up/confirm')).toBe(false);
  expect(await email.sendLink('owner@example.invalid', 'https://munshi.example/sign-up/confirm')).toBe(false);
});

test('verify spends the token hash and returns only a confirmed email; a refused, unconfirmed or malformed one is null', async () => {
  const s = scripted([
    { status: 200, body: { access_token: 'jwt', user: { email: 'owner@example.invalid', email_confirmed_at: '2026-11-03T05:00:00Z' } } },
    { status: 403, body: { error_code: 'otp_expired' } },
    { status: 200, body: { user: { email: 'owner@example.invalid', email_confirmed_at: null } } },
    'throw',
  ]);
  const email = supabaseEmail({ url: URL_, publishableKey: KEY, fetch: s.fetch });
  expect(await email.verify(HASH)).toBe('owner@example.invalid');
  expect(s.calls[0]).toEqual({ url: `${URL_}/auth/v1/verify`, headers: { apikey: KEY, 'content-type': 'application/json' }, body: { type: 'email', token_hash: HASH } });
  expect(await email.verify(HASH)).toBeNull();
  expect(await email.verify(HASH)).toBeNull();
  expect(await email.verify(HASH)).toBeNull();
  // A malformed hash never leaves the machine.
  const before = s.calls.length;
  expect(await email.verify('not a hash; drop table')).toBeNull();
  expect(s.calls.length).toBe(before);
});
