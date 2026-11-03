// The channels' live probe, for the founder to run once Meta's tokens are set: does each token reach its account, and
// is the webhook subscribed? Read-only: every call is a GET, so nothing is sent to anyone, nothing is posted and no
// subscription is changed. Prints names, ok or a numeric code, never a token, a secret, an id or a URL.
//
//   node scripts/channels-probe.ts [--no-env-file]   (settings from the repo's .env, unless --no-env-file, and the
//   shell; exit 1 if a check fails; nothing set prints one line and exits 0)
//
// Calls (Meta's docs, read 3 Nov 2026; GRAPH_VERSION as the senders use):
// - WhatsApp: GET graph.facebook.com/<phone-number-id>?fields=id,verified_name,quality_rating (the number the token
//   reaches); GET /debug_token?input_token=<token> (UNVERIFIED that a system-user token may inspect itself: an app token
//   or an app developer's token is what the reference asks for), then GET /<app-id>/subscriptions with the app token
//   (<app-id>|<app secret>; UNVERIFIED that an app token is taken as an Authorization Bearer header, as every call
//   here sends its token, rather than only as access_token): is `whatsapp_business_account` subscribed, active, with
//   `messages`. A failure there reads as a fail with Meta's code, so check the App Dashboard before trusting it.
// - Instagram, Instagram Login (graph.instagram.com): GET /me?fields=user_id,username, whose user_id must be the
//   configured business account; Facebook Login (graph.facebook.com): GET /<ig-id>?fields=id,username. Then
//   GET /<ig-id>/content_publishing_limit (the publishing quota) and GET /<ig-id>/subscribed_apps (UNVERIFIED that GET
//   lists what POST subscribes; the setup guide shows only POST).
import { fileURLToPath } from 'node:url';
import { GRAPH_VERSION } from '../packages/adapters/channels/index.ts';
import { channelSettings, ConfigError, type Env, loadEnvFiles } from '../packages/config/src/index.ts';

type Fetch = typeof globalThis.fetch;
export type ProbeLine = { check: string; result: 'ok' | 'fail' | 'unchecked' | 'unset'; note?: string };

type Answer = { ok: boolean; body: Record<string, unknown>; code: string | null };

async function get(f: Fetch, url: string, token: string): Promise<Answer> {
  try {
    const res = await f(url, { method: 'GET', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = body.error as { code?: unknown } | undefined;
    const code = error && /^[0-9]{1,8}$/.test(String(error.code)) ? String(error.code) : null;
    return { ok: res.ok && !error, body, code };
  } catch {
    return { ok: false, body: {}, code: null };
  }
}

const failed = (check: string, a: Answer): ProbeLine => ({ check, result: 'fail', note: a.code ? `Meta error ${a.code}` : 'no answer' });
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);

export async function probeChannels(env: Env, f: Fetch = fetch): Promise<ProbeLine[]> {
  const lines: ProbeLine[] = [];
  lines.push({ check: 'send mode', result: env.MUNSHI_SEND_MODE === 'live' ? 'ok' : 'unset', note: env.MUNSHI_SEND_MODE === 'live' ? 'live' : 'recorded: nothing is sent until MUNSHI_SEND_MODE=live' });
  let channels: ReturnType<typeof channelSettings>;
  try {
    channels = channelSettings(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    return [...lines, { check: 'settings', result: 'fail', note: `${err.code}: ${err.names.join(', ')}` }];
  }
  if (!channels.whatsapp && !channels.instagram) return [{ check: 'channels', result: 'unset', note: 'no WhatsApp or Instagram setting: nothing to probe' }];
  const fb = `https://graph.facebook.com/${GRAPH_VERSION}`;

  const wa = channels.whatsapp;
  if (!wa) lines.push({ check: 'whatsapp', result: 'unset' });
  else {
    const number = await get(f, `${fb}/${wa.phoneNumberId}?fields=id,verified_name,quality_rating`, wa.accessToken);
    lines.push(number.ok && number.body.id === wa.phoneNumberId ? { check: 'whatsapp token reaches the number', result: 'ok' } : failed('whatsapp token reaches the number', number));
    if (!env.MUNSHI_PHONE_ROUTE_SECRET) lines.push({ check: 'whatsapp route key', result: 'fail', note: 'MUNSHI_PHONE_ROUTE_SECRET is unset' });
    const debug = await get(f, `${fb}/debug_token?input_token=${encodeURIComponent(wa.accessToken)}`, wa.accessToken);
    const data = (debug.body.data ?? {}) as { app_id?: unknown; is_valid?: unknown };
    const appId = typeof data.app_id === 'string' && /^[0-9]{1,30}$/.test(data.app_id) ? data.app_id : null;
    if (!debug.ok || !appId) lines.push({ check: 'whatsapp webhook subscribed', result: 'unchecked', note: 'the token could not name its app; check the App Dashboard' });
    else {
      if (data.is_valid === false) lines.push({ check: 'whatsapp token valid', result: 'fail', note: 'Meta says the token is not valid' });
      const subs = await get(f, `${fb}/${appId}/subscriptions`, `${appId}|${wa.appSecret}`);
      const sub = list(subs.body.data).find((s) => s.object === 'whatsapp_business_account');
      const fields = list(sub?.fields).map((x) => (typeof x === 'string' ? x : x.name));
      if (!subs.ok) lines.push(failed('whatsapp webhook subscribed', subs));
      else if (sub?.active === true && fields.includes('messages')) lines.push({ check: 'whatsapp webhook subscribed', result: 'ok' });
      else lines.push({ check: 'whatsapp webhook subscribed', result: 'fail', note: 'no active whatsapp_business_account subscription with messages' });
    }
  }

  const ig = channels.instagram;
  if (!ig) lines.push({ check: 'instagram', result: 'unset' });
  else {
    const host = `https://${ig.graphHost}/${GRAPH_VERSION}`;
    const viaInstagram = ig.graphHost === 'graph.instagram.com';
    const me = await get(f, viaInstagram ? `${host}/me?fields=user_id,username` : `${host}/${ig.businessAccountId}?fields=id,username`, ig.accessToken);
    const id = viaInstagram ? me.body.user_id : me.body.id;
    if (!me.ok) lines.push(failed('instagram token reaches the account', me));
    else if (String(id) !== ig.businessAccountId) lines.push({ check: 'instagram token reaches the account', result: 'fail', note: 'the token belongs to another account' });
    else lines.push({ check: 'instagram token reaches the account', result: 'ok' });
    const quota = await get(f, `${host}/${ig.businessAccountId}/content_publishing_limit`, ig.accessToken);
    lines.push(quota.ok ? { check: 'instagram publishing allowed', result: 'ok' } : failed('instagram publishing allowed', quota));
    if (!viaInstagram) lines.push({ check: 'instagram webhook subscribed', result: 'unchecked', note: 'Facebook Login subscribes the Page; check the App Dashboard' });
    else {
      const apps = await get(f, `${host}/${ig.businessAccountId}/subscribed_apps`, ig.accessToken);
      const fields = list(apps.body.data).flatMap((a) => list(a.subscribed_fields).map(String));
      if (!apps.ok) lines.push({ check: 'instagram webhook subscribed', result: 'unchecked', note: apps.code ? `Meta error ${apps.code}` : 'no answer' });
      else lines.push(fields.includes('messages') || fields.includes('comments') ? { check: 'instagram webhook subscribed', result: 'ok' } : { check: 'instagram webhook subscribed', result: 'fail', note: 'no messages or comments field' });
    }
  }
  return lines;
}

/** The CLI: prints each line and answers the exit code, 1 if any check failed. */
export async function main(env: Env, write: (line: string) => void, f: Fetch = fetch): Promise<number> {
  const lines = await probeChannels(env, f);
  for (const l of lines) write(`${l.check}: ${l.result}${l.note ? ` (${l.note})` : ''}\n`);
  return lines.some((l) => l.result === 'fail') ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--no-env-file')) loadEnvFiles([new URL('../.env', import.meta.url)]);
  process.exitCode = await main(process.env, (line) => process.stdout.write(line));
}
