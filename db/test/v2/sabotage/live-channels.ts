// Red-proofs of the channels' live path (platform design §5, D-080; lane L-CH): the sweep's per-tenant class gate and
// its unwired channels, one post per approved draft, no token in a log, nothing sent before approval
// (test/v2/core/messaging/ch1.test.ts); WhatsApp's template outside the window, every Meta call's timeout, Instagram's
// card address and webhook read, and each channel's state (adapters.test.ts); the live probe
// (test/v2/deploy/channels-probe.test.ts); and the two webhook routes (apps/web/test/webhook*.test.ts). Each breaks one
// protection, and its named test must then fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const CH1 = 'test/v2/core/messaging/ch1.test.ts';
const ADAPTERS = 'test/v2/core/messaging/adapters.test.ts';
const PROBE = 'test/v2/deploy/channels-probe.test.ts';
const OUTBOX = 'packages/core/src/outbox.ts';
const COMMANDS = 'packages/core/src/commands.ts';
const STATE = 'packages/core/src/channel-state.ts';
const WHATSAPP = 'packages/adapters/channels/whatsapp.ts';
const INSTAGRAM = 'packages/adapters/channels/instagram.ts';

const LIVE1 =
  'LIVE1 nothing is sent before approval: a proposed post has no delivery and reaches no adapter, the command run directly is refused; the approval posts it once';
const LIVE2 = 'LIVE2 a sample shop never sends for real, with the credentials wired, both grants and a listed recipient: the database derives its deliveries recorded, no adapter called';
const LIVE3 =
  'LIVE3 a channel without its sender (no credential, or a recorded send mode) reaches no adapter: the post waits queued and lapses at its deadline; one still inside its window goes, once, when a sender is wired; the shop’s state says why';
const LIVE7 =
  'LIVE7 at most once across a crash: a failure after Meta answered but before the outcome commits leaves the post sending, and no later sweep posts it again';
const LIVE8 = 'LIVE8 a send whose answer never came stays sending, unconfirmed: never marked failed, never sent again';
const LIVE9 = 'LIVE9 a grant withdrawn, or a recipient unlisted, between approval and the sweep stops the send: blocked, the adapter never called';
const LIVE10 =
  'LIVE10 Instagram is granted through a real platform change: a seventeen-digit account id cannot be an account_ref, its INSTAGRAM_ACCOUNT_REF alias is, and the shop then reads live (with a card address) or waiting only on the card';
const TEMPLATE1 =
  'TEMPLATE1 the words go as a template only when its approved text is known and they fit it unchanged: one line, no long run of spaces, the whole at most 1024 characters';
const PROBE_CLI = 'PROBE-CH1 the CLI exits 0 with one plain line when nothing is set, and 1 when a check fails, printing names only';
const IGHOOK_CAP = 'a body over the cap is refused unread: a Content-Length past it, or a stream that runs past it, is a 404 even when signed';
const WAHOOK_CAP = 'a body over the cap is refused unread: a Content-Length past it is a 404 even when signed, and stores nothing';
const BODY = 'apps/web/lib/server/webhook-body.ts';
const IG_ROUTE = 'apps/web/app/api/webhooks/instagram/route.ts';
const LIVE4 = 'LIVE4 one approved post is posted once: two sweeps at once and a third after make one container and one publish, and the draft cannot be approved again';
const LIVE5 = 'LIVE5 no token reaches a log line or a delivery row, even when Meta answers an error that quotes it';
const LIVE6 = 'LIVE6 outside the 24-hour window a listed customer’s campaign goes once, as the approved template the deploy holds';
const TEMPLATE ='WhatsApp outside the 24-hour window sends only its purpose’s approved template, the words as its one parameter; with none it sends nothing';
const TIMEOUT = 'every Meta call gives up after its timeout: a hung WhatsApp or Instagram call fails, it never holds the sweep';
const IG_HTTPS = 'Instagram posts through the host its login names, and never with a card that is not a public HTTPS address';
const IG_READ =
  'Instagram’s webhook is read into direct messages and comments by the person’s scoped id; the shop’s own, deleted and malformed items are skipped, usernames dropped';
const LABEL1 =
  'LABEL1 a channel is live only for a real shop on a live send mode with its credential and the grant (Instagram’s naming the account held, with a public card address); else recorded with the first reason';
const PROBE_READS =
  'PROBE-CH1 the probe only reads: every call is a GET, each token reaches its own account, the webhooks are subscribed, and it prints no token, secret, id or URL';
const PROBE_FAILS = 'PROBE-CH1 a token of another account, a Meta error, a missing subscription and a partial setting each fail by name and code, never by value';
const IGHOOK_SIG =
  'a POST is read only with its own signature under the Instagram app secret: a missing, malformed, forged, other-body or other-secret one is a 404';
const IGHOOK_OFF = 'without Instagram configured every request is a 404, and no answer carries a token or a secret';
const LABEL2 = "the shop's settings show WhatsApp and Instagram as recorded, not sent, with the reason, in both languages";
const LABEL3 =
  "the grant page says each channel's state now: a sample shop's channels are recorded, with the reason, even with credentials set and the send mode live";
const WAHOOK_OFF = "without WhatsApp configured, or without the route key, every request is a 404; a demo deployment holding them answers Meta's check";

const db = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const web = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file,
  test,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
});

export const LIVE_CHANNELS_CASES: Case[] = [
  // every layer that keeps campaign.post a draft-only command removed at once (core's runCommand, the book guard's
  // draft_only, outbound_derive's "a direct command sends only a fixed template"): the direct run then posts
  {
    sabotage: 'v2-live1-draft-only',
    file: CH1,
    test: LIVE1,
    config: V2,
    sql: `set session_replication_role = replica; update ref.command set draft_only = false where command = 'campaign.post'; set session_replication_role = origin;
${mutate('books.outbound_derive()', 'if new.decision_id is null and (new.template_code is null or not exists (', 'if false and (new.template_code is null or not exists (')}`,
    ts: { file: COMMANDS, from: "  if (d.draftOnly) return Promise.reject(new CoreError('refused', { fields: ['command'] }));\n", to: '' },
  },
  // the sweep's class gate gone: a sample shop's pending delivery reaches the real adapter
  // The derivation ignores the tenant's class: a sample shop's deliveries go `pending` (the sweep's own class gate then
  // blocks them, but they are never recorded).
  { sabotage: 'v2-live2-sample-class', file: CH1, test: LIVE2, config: V2,
    sql: mutate('ops.delivery_derive()', "real := exists (select 1 from ops.tenant t where t.tenant_id = new.tenant_id and t.data_class = 'live')", 'real := true') },
  // a pending delivery of a channel with no sender left queued, to go out once a sender appears
  db('v2-live3-unwired', CH1, LIVE3, OUTBOX, "if (d.mode === 'pending' && !real.includes(d.channel)) {", 'if (false) {'),
  // a waiting delivery never lapses: it would go out after the window its approval gave
  db('v2-live3-lapse', CH1, LIVE3, OUTBOX, "      if (d.lapsed) count(await endUnclaimed(c, d.id, 'expired'));\n", ''),
  // the claim committed only with the outcome: a crash after the send requeues it, and it goes again
  db('v2-live7-claim-commit', CH1, LIVE7, OUTBOX, '  await checkpoint(); // the claim is committed: from here on, this delivery is never sent again\n', ''),
  // an unanswered send recorded as a plain failure
  db('v2-live8-unconfirmed', CH1, LIVE8, OUTBOX, "  if (!r.ok && r.unconfirmed) return 'unconfirmed';\n", ''),
  // the recheck ignores a withdrawn grant, or an unlisted recipient
  db('v2-live9-grant', CH1, LIVE9, OUTBOX, 'if (!r.granted || !r.listed) return', 'if (!r.listed) return'),
  db('v2-live9-listed', CH1, LIVE9, OUTBOX, 'if (!r.granted || !r.listed) return', 'if (!r.granted) return'),
  // the screens judge Instagram's grant against the business account id, which no grant can name
  db(
    'v2-live10-alias',
    CH1,
    LIVE10,
    STATE,
    'instagramAccount: s.instagram?.accountRef ?? null',
    'instagramAccount: (s.instagram as { businessAccountId?: string } | undefined)?.businessAccountId ?? null',
  ),
  // a template carrying words that are not one line, or too long for Meta's body
  db('v2-live-template-lines', ADAPTERS, TEMPLATE1, OUTBOX, '!/[\\n\\t]| {5}/.test(words) && ', ''),
  db('v2-live-template-length', ADAPTERS, TEMPLATE1, OUTBOX, "text.replace('{{1}}', words).length <= 1024", 'true'),
  // the claim's answer ignored: the sweep that lost the claim posts again
  db('v2-live4-claim', CH1, LIVE4, OUTBOX, 'if (claimed.rowCount !== 1) return null; // another sweep holds it', ''),
  // the recheck holds every send outside the window, a template held or not
  db('v2-live6-template-held', CH1, LIVE6, OUTBOX, '!r.window && !templated)', '!r.window)'),
  // the adapter writes the token to the console when Meta refuses
  db(
    'v2-live5-token-logged',
    CH1,
    LIVE5,
    INSTAGRAM,
    "if (typeof container.id !== 'string' || container.error) return { ok: false, errorCode: numericCode(container.error?.code) };",
    "if (typeof container.id !== 'string' || container.error) { console.error('instagram refused', account.token); return { ok: false, errorCode: null }; }",
  ),
  // free-form text whatever the window
  db('v2-live-template-window', ADAPTERS, TEMPLATE, WHATSAPP, '  if (m.window) return {', '  if (true) return {'),
  // WhatsApp's call without its timeout: a hung call holds forever
  db('v2-live-timeout', ADAPTERS, TIMEOUT, WHATSAPP, '        signal: AbortSignal.timeout(cfg.timeoutMs ?? META_TIMEOUT_MS),\n', ''),
  // any card address taken, plain http included
  db('v2-live-ig-https', ADAPTERS, IG_HTTPS, INSTAGRAM, "if (!imageUrl?.startsWith('https://')) return", 'if (!imageUrl) return'),
  // the shop's own echo read as a customer's message
  db('v2-live-ig-echo', ADAPTERS, IG_READ, INSTAGRAM, ' || from === accountId || m.is_echo === true', ''),
  // a sample shop's channel shown live
  db('v2-live-label-sample', ADAPTERS, LABEL1, STATE, "  if (dataClass !== 'live') return recorded('sample_shop');\n", ''),
  // Instagram shown live with no public address for its card
  db('v2-live-label-card', ADAPTERS, LABEL1, STATE, "  if (channel === 'instagram' && !deploy.instagramCard) return recorded('no_card');\n", ''),
  // the probe changes what it reads
  db('v2-live-probe-post', PROBE, PROBE_READS, 'scripts/channels-probe.ts', "{ method: 'GET',", "{ method: 'POST',"),
  // the probe's failure notes carry Meta's words (which quote the token)
  db(
    'v2-live-probe-words',
    PROBE,
    PROBE_FAILS,
    'scripts/channels-probe.ts',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of channels-probe.ts, not a template
    "note: a.code ? `Meta error ${a.code}` : 'no answer' });",
    "note: JSON.stringify(a.body) });",
  ),
  // the Instagram webhook reads a body without checking its signature
  web(
    'v2-live-ighook-signature',
    'test/webhook-instagram.test.ts',
    IGHOOK_SIG,
    'apps/web/app/api/webhooks/instagram/route.ts',
    ' || !verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), ig.appSecret)',
    '',
  ),
  // the Instagram webhook answers with Instagram unconfigured
  web('v2-live-ighook-off', 'test/webhook-instagram.test.ts', IGHOOK_OFF, 'apps/web/app/api/webhooks/instagram/route.ts', 'if (!ig) return notFound();\n  const q', 'const q'),
  // the shop's settings show the state without its reason
  web('v2-live-label-settings', 'test/inbox-campaigns-settings.test.tsx', LABEL2, 'apps/web/components/app/SettingsView.tsx', 'sub={CHANNEL_REASON[ch.reason]?.[lang]}', 'sub={null}'),
  // the console judges a shop as real whatever its class
  web('v2-live-label-console', 'test/console.test.tsx', LABEL3, 'apps/web/app/platform/(console)/shops/[id]/page.tsx', 'channelState(channel, shop.dataClass, g ?', 'channelState(channel, "live", g ?'),
  // a webhook body read whatever its Content-Length claims, or past the cap as it streams
  web('v2-live-ighook-length', 'test/webhook-instagram.test.ts', IGHOOK_CAP, BODY, 'if (length !== null && (!/^[0-9]{1,15}$/.test(length) || Number(length) > max)) return null;', ''),
  web('v2-live-ighook-stream', 'test/webhook-instagram.test.ts', IGHOOK_CAP, BODY, '    if (size > max) {', '    if (false) {'),
  web('v2-live-wahook-length', 'test/webhook.test.ts', WAHOOK_CAP, BODY, 'if (length !== null && (!/^[0-9]{1,15}$/.test(length) || Number(length) > max)) return null;', ''),
  // the Instagram webhook answers a signed, stored event as a failure: Meta redelivers it for a day and a half, and may
  // switch off a webhook that keeps failing
  web('v2-live-ighook-200', 'test/webhook-instagram.test.ts', IGHOOK_SIG, IG_ROUTE, 'return Response.json({ received: messages.length, stored });', 'return Response.json({ received: messages.length, stored }, { status: 503 });'),
  // the probe CLI exits 0 whatever failed, or prints its per-channel lines when nothing is set
  db('v2-live-probe-exit', PROBE, PROBE_CLI, 'scripts/channels-probe.ts', "return lines.some((l) => l.result === 'fail') ? 1 : 0;", 'return 0;'),
  db(
    'v2-live-probe-one-line',
    PROBE,
    PROBE_CLI,
    'scripts/channels-probe.ts',
    "  if (!channels.whatsapp && !channels.instagram) return [{ check: 'channels', result: 'unset', note: 'no WhatsApp or Instagram setting: nothing to probe' }];\n",
    '',
  ),
  // the WhatsApp webhook answers without WhatsApp configured
  web(
    'v2-live-wahook-off',
    'test/webhook.test.ts',
    WAHOOK_OFF,
    'apps/web/app/api/webhooks/whatsapp/route.ts',
    'if (!c.whatsapp || !c.phoneRouteSecret || !c.publicDatabaseUrl) return null;',
    'if (!c.publicDatabaseUrl) return null;',
  ),
];
