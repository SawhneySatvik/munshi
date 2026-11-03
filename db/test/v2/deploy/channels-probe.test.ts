// The channels' live probe (scripts/channels-probe.ts) over a fetch that answers as Meta would: no test touches the
// network. It only reads (every call a GET: nothing sent, posted or subscribed), checks that each token reaches its own
// account and that the webhooks are subscribed, and prints names and codes only: never a token, a secret, an id or a
// URL. Red-proofs: test/v2/sabotage/live-channels.ts.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { main, type ProbeLine, probeChannels } from '../../../../scripts/channels-probe.ts';

const WA_TOKEN = `EAAG${randomBytes(16).toString('hex')}`;
const WA_SECRET = randomBytes(16).toString('hex');
const IG_TOKEN = `IGAA${randomBytes(16).toString('hex')}`;
const IG_SECRET = randomBytes(16).toString('hex');
const NUMBER = '1000000001';
const ACCOUNT = '17841400000000001';
const APP = '900000000000001';

const env = (over: Record<string, string> = {}) => ({
  MUNSHI_SEND_MODE: 'live',
  MUNSHI_PHONE_ROUTE_SECRET: randomBytes(32).toString('hex'),
  WHATSAPP_ACCESS_TOKEN: WA_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: NUMBER,
  WHATSAPP_APP_SECRET: WA_SECRET,
  WHATSAPP_VERIFY_TOKEN: 'verify-wa',
  INSTAGRAM_ACCOUNT_REF: 'founder_pro',
  INSTAGRAM_BUSINESS_ACCOUNT_ID: ACCOUNT,
  INSTAGRAM_ACCESS_TOKEN: IG_TOKEN,
  INSTAGRAM_APP_SECRET: IG_SECRET,
  INSTAGRAM_VERIFY_TOKEN: 'verify-ig',
  ...over,
});

type Seen = { method: string; url: string; auth: string | null };
// Meta as a fetch: answers by path; `over` replaces an answer (an error, another account).
function meta(over: Record<string, unknown> = {}) {
  const seen: Seen[] = [];
  const answers: Record<string, unknown> = {
    [`/${NUMBER}`]: { id: NUMBER, verified_name: 'Synthetic Shop', quality_rating: 'GREEN' },
    '/debug_token': { data: { app_id: APP, is_valid: true } },
    [`/${APP}/subscriptions`]: { data: [{ object: 'whatsapp_business_account', active: true, fields: [{ name: 'messages', version: 'v26.0' }] }] },
    '/me': { user_id: ACCOUNT, username: 'synthetic_shop' },
    [`/${ACCOUNT}/content_publishing_limit`]: { data: [{ quota_usage: 0 }] },
    [`/${ACCOUNT}/subscribed_apps`]: { data: [{ id: APP, subscribed_fields: ['messages', 'comments'] }] },
    ...over,
  };
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    seen.push({ method: init?.method ?? 'GET', url: String(url), auth: new Headers(init?.headers).get('authorization') });
    const a = answers[u.pathname.replace(/^\/v[0-9.]+/, '')];
    const error = a && typeof a === 'object' && 'error' in a;
    return new Response(JSON.stringify(a ?? { error: { code: 100 } }), { status: a && !error ? 200 : 400 });
  }) as typeof fetch;
  return { f, seen };
}

const text = (lines: ProbeLine[]) => lines.map((l) => `${l.check}: ${l.result}${l.note ? ` (${l.note})` : ''}`).join('\n');

it('PROBE-CH1 the probe only reads: every call is a GET, each token reaches its own account, the webhooks are subscribed, and it prints no token, secret, id or URL', async () => {
  const { f, seen } = meta();
  const lines = await probeChannels(env(), f);
  expect(lines.map((l) => [l.check, l.result])).toEqual([
    ['send mode', 'ok'],
    ['whatsapp token reaches the number', 'ok'],
    ['whatsapp webhook subscribed', 'ok'],
    ['instagram token reaches the account', 'ok'],
    ['instagram publishing allowed', 'ok'],
    ['instagram webhook subscribed', 'ok'],
  ]);
  expect(seen.map((s) => s.method)).toEqual(['GET', 'GET', 'GET', 'GET', 'GET', 'GET']);
  expect(seen.some((s) => /\/(messages|media|media_publish)$/.test(new URL(s.url).pathname))).toBe(false);
  expect(seen.map((s) => new URL(s.url).host)).toEqual(['graph.facebook.com', 'graph.facebook.com', 'graph.facebook.com', 'graph.instagram.com', 'graph.instagram.com', 'graph.instagram.com']);
  const out = text(lines);
  for (const secret of [WA_TOKEN, WA_SECRET, IG_TOKEN, IG_SECRET, NUMBER, ACCOUNT, APP, 'https://', 'graph.']) expect(out).not.toContain(secret);
});

it('PROBE-CH1 a token of another account, a Meta error, a missing subscription and a partial setting each fail by name and code, never by value', async () => {
  const other = await probeChannels(env(), meta({ '/me': { user_id: '17841400000000099' } }).f);
  expect(other.find((l) => l.check === 'instagram token reaches the account')).toEqual({ check: 'instagram token reaches the account', result: 'fail', note: 'the token belongs to another account' });
  const expired = await probeChannels(env(), meta({ [`/${NUMBER}`]: { error: { code: 190, message: `Invalid OAuth access token ${WA_TOKEN}` } } }).f);
  expect(expired.find((l) => l.check === 'whatsapp token reaches the number')).toEqual({ check: 'whatsapp token reaches the number', result: 'fail', note: 'Meta error 190' });
  expect(text(expired)).not.toContain(WA_TOKEN);
  const unsubscribed = await probeChannels(env(), meta({ [`/${APP}/subscriptions`]: { data: [{ object: 'page', active: true, fields: ['feed'] }] } }).f);
  expect(unsubscribed.find((l) => l.check === 'whatsapp webhook subscribed')?.result).toBe('fail');
  const partial = await probeChannels({ INSTAGRAM_ACCESS_TOKEN: IG_TOKEN }, meta().f);
  expect(partial).toEqual([
    { check: 'send mode', result: 'unset', note: 'recorded: nothing is sent until MUNSHI_SEND_MODE=live' },
    { check: 'settings', result: 'fail', note: 'config_missing: INSTAGRAM_ACCOUNT_REF, INSTAGRAM_BUSINESS_ACCOUNT_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_VERIFY_TOKEN' },
  ]);
  expect(text(partial)).not.toContain(IG_TOKEN);
  // Nothing set: one line, nothing called.
  const none = meta();
  expect(await probeChannels({}, none.f)).toEqual([{ check: 'channels', result: 'unset', note: 'no WhatsApp or Instagram setting: nothing to probe' }]);
  expect(none.seen).toEqual([]);
});

// The CLI: its main (what the sabotages reach) answers the exit code and writes the lines; then the script itself, run as
// the founder runs it but with --no-env-file (no repo .env, so no test ever reaches Meta) and a bare environment, exits
// with that code. Nothing set is one plain line and exit 0; a partial set is a failure, exit 1, never a value printed.
it('PROBE-CH1 the CLI exits 0 with one plain line when nothing is set, and 1 when a check fails, printing names only', async () => {
  const out: string[] = [];
  expect(await main({}, (l) => out.push(l), meta().f)).toBe(0);
  expect(out).toEqual(['channels: unset (no WhatsApp or Instagram setting: nothing to probe)\n']);
  out.length = 0;
  expect(await main({ INSTAGRAM_ACCESS_TOKEN: IG_TOKEN }, (l) => out.push(l), meta().f)).toBe(1);
  expect(out.join('')).toContain('settings: fail (config_missing: INSTAGRAM_ACCOUNT_REF');
  expect(out.join('')).not.toContain(IG_TOKEN);
  const script = new URL('../../../../scripts/channels-probe.ts', import.meta.url).pathname;
  const run = (extra: Record<string, string>) =>
    spawnSync(process.execPath, [script, '--no-env-file'], { env: { PATH: process.env.PATH ?? '', ...extra }, encoding: 'utf8', timeout: 30_000 });
  const none = run({});
  expect([none.status, none.stdout]).toEqual([0, 'channels: unset (no WhatsApp or Instagram setting: nothing to probe)\n']);
  const partial = run({ INSTAGRAM_ACCESS_TOKEN: IG_TOKEN });
  expect(partial.status).toBe(1);
  expect(`${partial.stdout}${partial.stderr}`).not.toContain(IG_TOKEN);
});
